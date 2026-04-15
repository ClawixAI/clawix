import * as fs from 'fs/promises';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type { ChatMessage } from '@clawix/shared';

import { MemoryItemRepository } from '../db/memory-item.repository.js';
import { BootstrapFileService } from './bootstrap-file.service.js';
import { SkillLoaderService } from './skill-loader.service.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { UserRepository } from '../db/user.repository.js';
import type { ContextBuildParams, WorkerSummary } from './context-builder.types.js';
import {
  MEMORY_FILE_TOKEN_BUDGET,
  DAILY_NOTES_TOKEN_BUDGET,
  DAILY_NOTES_DAYS,
  MEMORY_ITEM_MAX_CHARS,
} from './context-builder.types.js';

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
    const memorySection = await this.buildMemorySection(userId, workspacePath);
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
      '## Container Environment',
      '',
      'You run inside an isolated container with:',
      '- **Python 3.12** (stdlib only — no pip packages pre-installed, no pip install available)',
      '- **git**, **jq** available in shell',
      '- **No direct internet access** — curl, wget, and network commands will fail',
      '',
      'To access the internet, use ONLY the **web_search** and **web_fetch** tools.',
      'Never write scripts that make HTTP requests — use these tools directly instead.',
      'When writing Python scripts, use only the standard library (json, csv, os, re, etc.).',
      'If a user asks for a script requiring external packages, write it but note they must run it outside the container.',
      '',
      '## Projector',
      '',
      'You can create interactive tools for the user as projector items (calculators, converters, editors, visualizers).',
      '**Before any projector task**: read_file("/skills/builtin/projector-creator/SKILL.md") for the workflow and guidelines.',
      'Projectors run in sandboxed iframes with NO network access — fetch data yourself first if needed.',
      '',
      '## Time Limits',
      '',
      'Each agent run has a wall-clock timeout (default 5 minutes).',
      'If a task might take longer, break it into smaller steps or use cron scheduling for recurring work.',
      'Do not attempt more than 3 web_fetch calls in a single run — fetch only the most relevant URLs.',
      '',
      '## Memory',
      '',
      'Your persistent memory is at `/workspace/memory/MEMORY.md`.',
      '- Update it when you learn something worth remembering long-term about the user, their preferences, or ongoing work',
      '- Read it to recall context from previous sessions',
      '- Keep it concise and well-organized — you own this file completely',
      '',
      'For daily activity notes, use `save_memory` with a `daily:YYYY-MM-DD` tag (e.g., `daily:' + new Date().toISOString().slice(0, 10) + '`).',
      '- The last 3 days of daily notes are automatically loaded into your context',
      '- Use `search_memory` to look up older daily notes or tagged memories',
      '',
      'Your available memory tags are listed in the Memory section of your context.',
      'Use `search_memory` with specific tags to retrieve their content.',
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

  private async buildMemorySection(
    userId: string,
    workspacePath?: string,
  ): Promise<string | null> {
    const sections: string[] = [];

    // 1. MEMORY.md — read from workspace
    if (workspacePath) {
      try {
        const memoryFilePath = path.join(workspacePath, 'memory', 'MEMORY.md');
        const content = await fs.readFile(memoryFilePath, 'utf-8');
        if (content.trim()) {
          const truncated = truncate(content.trim(), MEMORY_FILE_TOKEN_BUDGET * 4);
          sections.push(`## Long-term Memory\n\n${truncated}`);
        }
      } catch {
        // File doesn't exist or unreadable — skip
      }
    }

    // 2. Daily notes — last N days
    try {
      const dailyItems = await this.memoryItemRepo.findDailyNotes(userId, DAILY_NOTES_DAYS);
      if (dailyItems.length > 0) {
        const grouped = this.groupDailyNotesByDate(dailyItems);
        let tokenEstimate = 0;
        const dateLines: string[] = [];

        for (const [date, items] of grouped) {
          const dateSectionLines = [`### ${date}`];
          for (const item of items) {
            const text = formatMemoryItem(item.content);
            const tokens = Math.ceil(text.length / 4);
            if (tokenEstimate + tokens > DAILY_NOTES_TOKEN_BUDGET) break;
            dateSectionLines.push(`- ${text}`);
            tokenEstimate += tokens;
          }
          dateLines.push(dateSectionLines.join('\n'));
          if (tokenEstimate >= DAILY_NOTES_TOKEN_BUDGET) break;
        }

        if (dateLines.length > 0) {
          sections.push(`## Recent Activity\n\n${dateLines.join('\n\n')}`);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ userId, error: message }, 'Failed to load daily notes');
    }

    // 3. Tag index
    try {
      const tags = await this.memoryItemRepo.findDistinctTags(userId);
      if (tags.length > 0) {
        sections.push(`## Available Memory Tags\n\n${tags.join(', ')}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ userId, error: message }, 'Failed to load tag index');
    }

    if (sections.length === 0) return null;
    return `# Memory\n\n${sections.join('\n\n')}`;
  }

  private groupDailyNotesByDate(
    items: readonly { content: unknown; tags: readonly string[]; createdAt: Date }[],
  ): Map<string, readonly { content: unknown }[]> {
    const grouped = new Map<string, { content: unknown }[]>();
    for (const item of items) {
      const dailyTag = item.tags.find((t) => t.startsWith('daily:'));
      const date = dailyTag ? dailyTag.slice(6) : item.createdAt.toISOString().slice(0, 10);
      const existing = grouped.get(date) ?? [];
      existing.push(item);
      grouped.set(date, existing);
    }
    return new Map([...grouped.entries()].sort((a, b) => b[0].localeCompare(a[0])));
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
