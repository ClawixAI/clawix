import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type { ChatMessage } from '@clawix/shared';

import { MemoryItemRepository } from '../db/memory-item.repository.js';
import { BootstrapFileService } from './bootstrap-file.service.js';
import { SkillLoaderService } from './skill-loader.service.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { UserRepository } from '../db/user.repository.js';
import type { ContextBuildParams, WorkerSummary } from './context-builder.types.js';
import { MEMORY_TOKEN_BUDGET, MEMORY_ITEM_MAX_CHARS } from './context-builder.types.js';

const logger = createLogger('engine:context-builder');

/**
 * Builds enriched message arrays for LLM calls.
 *
 * Assembles:
 *  - Enriched system prompt (agent identity + workspace + systemPrompt + memory)
 *  - History messages (passed through)
 *  - User message with runtime context prepended
 */
@Injectable()
export class ContextBuilderService {
  constructor(
    private readonly memoryItemRepo: MemoryItemRepository,
    private readonly bootstrapFileService: BootstrapFileService,
    private readonly skillLoader: SkillLoaderService,
    private readonly policyRepo: PolicyRepository,
    private readonly userRepo: UserRepository,
  ) {}

  /**
   * Build the complete message array for an LLM call.
   */
  async buildMessages(params: ContextBuildParams): Promise<readonly ChatMessage[]> {
    const { agentDef, history, input, userId, isSubAgent } = params;
    const channel = params.channel ?? 'internal';
    const chatId = params.chatId ?? 'system';
    const userName = params.userName ?? 'System';

    const systemPrompt = await this.buildSystemPrompt(
      agentDef,
      userId,
      params.workspacePath,
      isSubAgent,
      params.workers,
    );
    const userContent = this.buildUserMessage(input, channel, chatId, userName);

    const systemMessage: ChatMessage = { role: 'system', content: systemPrompt };
    const userMessage: ChatMessage = { role: 'user', content: userContent };

    return [systemMessage, ...history, userMessage];
  }

  private async buildSystemPrompt(
    agentDef: ContextBuildParams['agentDef'],
    userId: string,
    workspacePath?: string,
    isSubAgent?: boolean,
    workers?: readonly WorkerSummary[],
  ): Promise<string> {
    const sections: string[] = [];

    if (isSubAgent) {
      // Sub-agent: focused framing, no bootstrap files
      sections.push(this.buildSubAgentIdentitySection(agentDef));
    } else {
      // 1. Agent identity
      sections.push(this.buildIdentitySection(agentDef));

      // 2. Bootstrap files (only for primary agents with a workspace)
      if (workspacePath) {
        const bootstrapSections = await this.bootstrapFileService.loadBootstrapFiles(workspacePath);
        for (const section of bootstrapSections) {
          sections.push(`## ${section.filename}\n\n${section.content}`);
        }
      }
    }

    // 3. Workspace awareness (only when workspace is mounted)
    if (workspacePath) {
      sections.push(this.buildWorkspaceSection());
    }

    // 4. Agent-defined system prompt
    sections.push(agentDef.systemPrompt);

    // 5. Available sub-agents (primary agents only)
    if (!isSubAgent && workers && workers.length > 0) {
      sections.push(this.buildWorkersSection(workers));
    }

    // 6. Skills summary (optional)
    const skillsSummary = await this.skillLoader.buildSkillsSummary(userId);
    if (skillsSummary) {
      sections.push(
        '# Skills\n\n' +
          'Skills are NOT agents — do NOT use the spawn tool for skills.\n' +
          'To use a skill: call read_file on its SKILL.md location, then follow the instructions inside.\n' +
          'To create new skills: write them under /skills/custom/ (writable). /skills/builtin/ is read-only.\n\n' +
          skillsSummary,
      );
    }

    // 7. Cron/scheduling guidance (only if policy allows)
    if (!isSubAgent) {
      const cronSection = await this.buildCronSection(userId);
      if (cronSection) {
        sections.push(cronSection);
      }
    }

    // 8. Memory (optional)
    const memorySection = await this.buildMemorySection(userId);
    if (memorySection) {
      sections.push(memorySection);
    }

    return sections.join('\n\n---\n\n');
  }

  private buildWorkersSection(workers: readonly WorkerSummary[]): string {
    const lines = [
      '# Available Sub-Agents',
      '',
      'You can delegate tasks to these specialized agents using the spawn tool:',
      '',
    ];

    for (const w of workers) {
      if (w.description) {
        lines.push(`- **${w.name}**: ${w.description}`);
      } else {
        lines.push(`- **${w.name}**`);
      }
    }

    lines.push(
      '',
      'To spawn a named agent: spawn(agent_name="<name>", prompt="<task>")',
      'If none of these agents fit your needs, spawn an anonymous agent: spawn(prompt="<task>")',
    );

    return lines.join('\n');
  }

  private buildSubAgentIdentitySection(agentDef: ContextBuildParams['agentDef']): string {
    const parts = [
      '# Sub-Agent',
      '',
      'You are a sub-agent spawned by the main agent to complete a specific task.',
      'Stay focused on the assigned task. Do not deviate into unrelated work.',
      'Your final response will be reported back to the main agent.',
    ];

    if (agentDef.name) {
      parts.push('', `Agent type: ${agentDef.name}`);
    }
    if (agentDef.description) {
      parts.push(`Role: ${agentDef.description}`);
    }

    return parts.join('\n');
  }

  private buildIdentitySection(agentDef: ContextBuildParams['agentDef']): string {
    const parts = [`# ${agentDef.name}`];
    if (agentDef.description) {
      parts.push(agentDef.description);
    }
    return parts.join('\n\n');
  }

  private buildWorkspaceSection(): string {
    return [
      '## Workspace',
      '',
      'Your workspace is at: /workspace',
      '- Use the read_file, write_file, edit_file, list_directory, and shell tools to interact with files.',
      '- All file paths must be under /workspace.',
      '',
      '## Memory',
      '',
      'You can save and search persistent memories using the save_memory and search_memory tools.',
      '- Memories you save are private by default',
      '- Use tags to organize: preference, project, person, decision, fact',
      '- To share a memory, the user must explicitly ask. Use list_groups then share_memory.',
    ].join('\n');
  }

  private async buildCronSection(userId: string): Promise<string | null> {
    try {
      const user = await this.userRepo.findById(userId);
      const policy = await this.policyRepo.findById(user.policyId);
      if (!policy.cronEnabled) return null;
    } catch {
      return null;
    }

    return [
      '# Scheduled Tasks (Cron)',
      '',
      'You can create, list, and remove scheduled tasks using the **cron** tool.',
      'When a scheduled task triggers, a full agent session starts with your prompt — you will be activated to do the work.',
      'Results are automatically delivered back to the channel where the job was created.',
      '',
      '## Schedule Types',
      '- **Recurring interval**: `{"type":"every","interval":"5m"}` — runs every 5 minutes. Units: s, m, h, d.',
      '- **Cron expression**: `{"type":"cron","expression":"0 9 * * MON-FRI","tz":"America/New_York"}` — standard cron syntax with optional timezone.',
      '- **One-time**: `{"type":"at","time":"2026-04-01T09:00:00Z"}` — runs once at the specified time, then auto-disables.',
      '',
      '## Rules',
      '- The schedule parameter must be a JSON string.',
      '- You can only receive messages from supported channels: Telegram, Slack, WhatsApp, and Web.',
      '- You cannot create, modify, or delete cron jobs while running inside a scheduled task.',
    ].join('\n');
  }

  private async buildMemorySection(userId: string): Promise<string | null> {
    let items: readonly { content: unknown }[];
    try {
      items = await this.memoryItemRepo.findVisibleToUser(userId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { userId, error: message },
        'Failed to load memory items, continuing without memory',
      );
      return null;
    }

    if (items.length === 0) {
      return null;
    }

    const lines: string[] = [];
    let tokenEstimate = 0;

    for (const item of items) {
      const formatted = formatMemoryItem(item.content);
      const itemTokens = Math.ceil(formatted.length / 4);

      if (tokenEstimate + itemTokens > MEMORY_TOKEN_BUDGET) {
        logger.debug(
          { userId, included: lines.length, total: items.length },
          'Memory token budget reached, truncating',
        );
        break;
      }

      lines.push(`- ${formatted}`);
      tokenEstimate += itemTokens;
    }

    if (lines.length === 0) {
      return null;
    }

    return `# Memory\n\n${lines.join('\n')}`;
  }

  private buildUserMessage(
    input: string,
    channel: string,
    chatId: string,
    userName: string,
  ): string {
    const now = new Date();
    const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr = now.toISOString().slice(0, 16).replace('T', ' ');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const runtimeContext = [
      '[Runtime Context]',
      `Server Time: ${dateStr} (${dayName}) (${tz})`,
      `Channel: ${channel}`,
      `Chat ID: ${chatId}`,
      `User: ${userName}`,
    ].join('\n');

    return `${runtimeContext}\n\n${input}`;
  }
}

/**
 * Format a MemoryItem's JSON content as a human-readable string.
 *
 * - string → use directly
 * - object with `text` field → use text
 * - otherwise → JSON.stringify, truncated to MEMORY_ITEM_MAX_CHARS
 */
function formatMemoryItem(content: unknown): string {
  if (typeof content === 'string') {
    return truncate(content, MEMORY_ITEM_MAX_CHARS);
  }

  if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
    const obj = content as Record<string, unknown>;
    if (typeof obj['text'] === 'string') {
      return truncate(obj['text'], MEMORY_ITEM_MAX_CHARS);
    }
  }

  const serialized = JSON.stringify(content);
  return truncate(serialized, MEMORY_ITEM_MAX_CHARS);
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return `${str.slice(0, maxLength)}...`;
}
