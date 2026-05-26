import * as path from 'path';

import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type { ChatMessage } from '@clawix/shared';

import { BootstrapFileService } from './bootstrap-file.service.js';
import { SkillLoaderService } from './skill-loader.service.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { SystemSettingsService } from '../system-settings/system-settings.service.js';
import { SessionRepository } from '../db/session.repository.js';
import { WikiPageRepository } from '../db/wiki-page.repository.js';
import { WikiBootstrapService } from './wiki/wiki-bootstrap.service.js';
import { renderWikiContext } from './wiki/render-wiki-context.js';
import { SessionSearchService } from './session-recall/session-search.service.js';
import { renderRecentSessions } from './session-recall/render-recent-sessions.js';
import type {
  ContextBuildParams,
  ContextBuildResult,
  SystemPromptArgs,
  WorkerSummary,
} from './context-builder.types.js';
import type { SkillStalenessMap } from './skill-loader.types.js';

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
    private readonly bootstrapFileService: BootstrapFileService,
    private readonly skillLoader: SkillLoaderService,
    private readonly policyRepo: PolicyRepository,
    private readonly userRepo: UserRepository,
    private readonly systemSettingsService: SystemSettingsService,
    private readonly sessionRepo: SessionRepository,
    private readonly wikiPageRepo: WikiPageRepository,
    private readonly wikiBootstrap: WikiBootstrapService,
    private readonly sessionSearch: SessionSearchService,
  ) {}

  /**
   * Build the complete message array for an LLM call.
   */
  async buildMessages(params: ContextBuildParams): Promise<ContextBuildResult> {
    const { agentDef, history, input, userId, isSubAgent, isScheduledTask } = params;
    const channel = params.channel ?? 'internal';
    const chatId = params.chatId ?? 'system';
    const userName = params.userName ?? 'System';

    const taskId = isScheduledTask && chatId.startsWith('cron:') ? chatId.slice(5) : undefined;

    const { systemPrompt, stalenessMap } = await this.buildSystemPromptWithStaleness({
      agentDef,
      userId,
      workspacePath: params.workspacePath,
      isSubAgent,
      isScheduledTask,
      workers: params.workers,
      taskId,
      session: params.session,
    });
    const userContent = await this.buildUserMessage(
      input,
      channel,
      chatId,
      userName,
      params.replyContext,
    );

    const systemMessage: ChatMessage = { role: 'system', content: systemPrompt };
    const userMessage: ChatMessage = { role: 'user', content: userContent };

    return {
      messages: [systemMessage, ...history, userMessage],
      stalenessMap,
    };
  }

  private async buildSystemPromptWithStaleness(
    args: SystemPromptArgs,
  ): Promise<{ systemPrompt: string; stalenessMap: SkillStalenessMap }> {
    if (args.session !== undefined) {
      if (args.session.cachedSystemPrompt !== null) {
        const customDir = args.workspacePath ? path.join(args.workspacePath, 'skills') : '';
        let stalenessMap: SkillStalenessMap = new Map();
        if (customDir) {
          ({ stalenessMap } = await this.skillLoader.buildSkillsSummary(customDir));
        }
        return { systemPrompt: args.session.cachedSystemPrompt, stalenessMap };
      }
      const rendered = await this.renderSystemPromptWithStaleness(args);
      try {
        await this.sessionRepo.setCachedSystemPrompt(args.session.id, rendered.systemPrompt);
      } catch (err) {
        logger.warn(
          { sessionId: args.session.id, err },
          'Failed to persist cached system prompt — continuing with rendered output',
        );
      }
      return rendered;
    }
    return this.renderSystemPromptWithStaleness(args);
  }

  private async renderSystemPromptWithStaleness(
    args: SystemPromptArgs,
  ): Promise<{ systemPrompt: string; stalenessMap: SkillStalenessMap }> {
    const { agentDef, userId, workspacePath, isSubAgent, isScheduledTask, workers, taskId } = args;
    const sections: string[] = [];
    let stalenessMap: SkillStalenessMap = new Map();

    if (isSubAgent) {
      sections.push(this.buildSubAgentIdentitySection(agentDef));
    } else {
      sections.push(this.buildIdentitySection(agentDef));

      if (workspacePath) {
        const bootstrapSections = await this.bootstrapFileService.loadBootstrapFiles(workspacePath);
        for (const section of bootstrapSections) {
          sections.push(`## ${section.filename}\n\n${section.content}`);
        }
      }
    }

    if (workspacePath) {
      sections.push(this.buildWorkspaceSection());
    }

    sections.push(agentDef.systemPrompt);

    sections.push(this.buildOperatingPrinciplesSection(Boolean(isSubAgent)));

    if (!isSubAgent && workers && workers.length > 0) {
      sections.push(this.buildWorkersSection(workers));
    }

    if (!isSubAgent) {
      const customDir = workspacePath ? path.join(workspacePath, 'skills') : '';
      const { xml: skillsSummary, stalenessMap: skillsMap } =
        await this.skillLoader.buildSkillsSummary(customDir);
      stalenessMap = skillsMap;
      if (skillsSummary) {
        sections.push(
          '# Skills\n\n' +
            'Skills are NOT agents — do NOT use the spawn tool for skills.\n' +
            'To use a skill: call read_file on its SKILL.md location, then follow the instructions inside.\n' +
            'To create new skills: write them under /workspace/skills/ (writable, lives inside your workspace). /skills/builtin/ is read-only.\n\n' +
            skillsSummary +
            '\n\n## Skills Maintenance\n\n' +
            'Skills are living documents — they decay as tools, APIs, and best practices change.\n' +
            'When you use a skill and find it outdated, incomplete, or wrong during use, patch it\n' +
            'with edit_file or write_file. Do not wait to be asked.\n\n' +
            'CRITICAL: When a user corrects your output after you used a skill — whether about\n' +
            'format, style, completeness, approach, or accuracy — that correction is a skill\n' +
            'signal, not just a one-time fix. Ask the user: "Would you like me to update the\n' +
            'skill to incorporate this preference?" If they agree, patch the skill so you get it\n' +
            'right next time. For example, if a skill produces single-source results and the user\n' +
            'wants multi-source, offer to update the skill to require multiple sources.\n\n' +
            'After completing a complex task (5+ tool calls), fixing a tricky error, or discovering\n' +
            'a non-trivial workflow, consider saving the approach as a new skill so you can reuse it.\n\n' +
            'Preference order — prefer the earliest action that fits:\n' +
            '1. PATCH a currently-loaded skill that you just used and found wanting\n' +
            '2. PATCH an existing workspace skill that covers the topic\n' +
            '3. CREATE a new skill only when no existing skill covers what you learned\n\n' +
            'When patching, preserve the YAML frontmatter (--- blocks) and focus on updating\n' +
            'the body content. For new skills, include proper frontmatter with name and description.\n' +
            'Use the skill-creator skill as a template.',
        );
      }
    }

    const executionSection = this.buildExecutionContextSection(Boolean(isScheduledTask), taskId);
    if (executionSection) {
      sections.push(executionSection);
    }

    if (!isSubAgent) {
      const cronSection = await this.buildCronSection(userId);
      if (cronSection) {
        sections.push(cronSection);
      }
    }

    const memorySection = await this.buildMemorySection(userId, workspacePath);
    if (memorySection) {
      sections.push(memorySection);
    }

    if (!isSubAgent) {
      const recentSessionsSection = await this.buildRecentSessionsSection(userId, args.session?.id);
      if (recentSessionsSection) {
        sections.push(recentSessionsSection);
      }
    }

    return { systemPrompt: sections.join('\n\n---\n\n'), stalenessMap };
  }

  private buildOperatingPrinciplesSection(isSubAgent: boolean): string {
    const paragraphs = [
      '# Operating Principles',
      '',
      '**Tool use.** When you say you will do something, execute the tool call in the same response — never end a turn with a promise of future action. Keep working until the task is complete; verify the result before declaring done. Prefer tools over mental computation: arithmetic, current time, file contents, and web facts come from tools, not memory. When a question has an obvious default interpretation, act on it; only clarify when ambiguity genuinely changes which tool you would call.',
    ];

    if (!isSubAgent) {
      paragraphs.push(
        '',
        "**Skills.** Before replying, scan available skills. If any is even partially relevant, load its SKILL.md and follow it — skills encode the user's preferred conventions and quality standards, not just shortcuts. After a complex task (5+ tool calls) or a non-obvious workflow you discovered, offer to save it as a skill so it is reusable next time.",
      );
    }

    return paragraphs.join('\n');
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
      '## Skills',
      '',
      '**ALWAYS use the skill-creator skill when creating or updating skills.**',
      'Before any skill creation task: read_file("/skills/builtin/skill-creator/SKILL.md") for the required format.',
      'Skills MUST have YAML frontmatter with `name` and `description` fields — skills without valid frontmatter will not load.',
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
      'You have two long-term stores. **Each fact belongs in exactly one** — never save the same fact to both, or they will drift.',
      '',
      '- `/workspace/USER.md` — structured user profile **only**: name, timezone, role, preferences, work context. Read at session start; update with `edit_file` when you learn a new structured fact about the user. Keep it concise.',
      '- **Wiki pages** (via `wiki_*` tools) — **everything that is not user profile**: project notes, decisions, references, daily activity, domain knowledge. Cross-link with `[[slug]]` markers.',
      '',
      'When the user introduces themselves or shares a preference, update USER.md — do NOT also call `wiki_write` for the same fact.',
      '',
      'For daily activity notes, call `wiki_write` with a `daily:YYYY-MM-DD` tag (e.g., `daily:' +
        new Date().toISOString().slice(0, 10) +
        '`).',
      'Your recent conversations are listed under "Recent Sessions"; use `session_search` ' +
        'to recall details from any past session.',
      '- Use `wiki_index` to browse the catalog, or `wiki_search` for free-text lookup',
      '',
      'When writing to USER.md or wiki pages, write declarative facts, not instructions: "User prefers concise responses" ✓ — "Always respond concisely" ✗. Imperative phrasing gets re-read as a directive in later sessions and can override the user\'s current request.',
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
      '',
      "If the user references output from a prior scheduled task, use `action:'runs'`",
      "to locate the job and `action:'runDetail'` with the `runId` to retrieve the full",
      'transcript of what was done. Scheduled-task output is not part of this',
      "conversation's history.",
    ].join('\n');
  }

  private buildExecutionContextSection(isScheduledTask: boolean, taskId?: string): string | null {
    if (!isScheduledTask) return null;

    const lines = [
      '# Execution Context',
      '',
      taskId
        ? `You are running as scheduled task \`${taskId}\`. The user is not present and cannot respond.`
        : 'You are running as a scheduled task. The user is not present and cannot respond.',
      'Produce a self-contained result. Do not ask clarifying questions or invite follow-up.',
      "The user's prompt is the deliverable. Saving or reading notes is a side-effect, never a substitute for the requested output. If you only acknowledge a memory operation, you have failed the task.",
    ];

    if (taskId) {
      lines.push(
        '',
        '## Persistent Notes (optional)',
        '',
        `A folder at \`/workspace/memory/cron/${taskId}/\` persists across runs of this task. Use it only when continuity across runs would meaningfully improve your output — for example:`,
        '',
        '- avoiding repetition (e.g. not repeating a joke or example from a prior run)',
        '- tracking progress through a multi-run task',
        "- building on a prior run's findings",
        '',
        "To recall prior notes, `read_file` on a stable filename you've used before (e.g. `notes.md`, `used_jokes.md`). If the file doesn't exist, that means no prior notes for this task — proceed normally; do not treat the error as a problem. To save, `write_file` to a path under the folder above; parent directories are created automatically. Avoid `list_directory` on this folder — it errors when nothing has been saved yet, and the error suffix can derail you. Most one-shot tasks need neither read nor write — ignore the folder when continuity isn't relevant.",
        '',
        'Prefer this folder over `wiki_write` for task-specific breadcrumbs — wiki pages are user-wide and can leak into unrelated conversations. Use `wiki_write` only when the note is genuinely about the user or applies beyond this task.',
      );
    }

    return lines.join('\n');
  }

  private async buildMemorySection(userId: string, workspacePath?: string): Promise<string | null> {
    return this.buildWikiMemorySection(userId, workspacePath);
  }

  /**
   * Wiki-backed memory section.
   *
   * Runs lazy one-shot migration, then pulls WikiPage rows and renders them
   * via renderWikiContext. The legacy MEMORY.md / daily-notes / tag-index
   * paths are completely bypassed. USER.md remains file-based and is
   * injected separately via BootstrapFileService.
   */
  private async buildWikiMemorySection(
    userId: string,
    workspacePath?: string,
  ): Promise<string | null> {
    try {
      // Lazy migration — one-shot per user, idempotent.
      if (workspacePath) {
        await this.wikiBootstrap.ensureMigrated(userId, workspacePath);
      }

      // Pull data.
      const allOwned = await this.wikiPageRepo.listOwnedByUser(userId, { limit: 2000 });
      const ambientPages = allOwned.filter((p) => p.scope === 'AMBIENT' && p.slug !== '_schema');
      const schemaPage = allOwned.find((p) => p.slug === '_schema') ?? null;
      const indexPagesList = await this.wikiPageRepo.findVisibleToUser(userId, { limit: 400 });

      const wikiSection = renderWikiContext({
        now: new Date(),
        ambientPages,
        schemaPage,
        indexPages: indexPagesList,
        budgets: { ambient: 2200, schema: 500, index: 4000 },
      });

      if (!wikiSection) return null;

      const guidance =
        'The information below reflects your wiki at the start of this session. ' +
        'Browse the catalog with `wiki_index`, read a page with `wiki_read`, ' +
        'free-text search with `wiki_search`, and create or update pages with `wiki_write`.\n\n' +
        '**Before writing a new page**, scan the Wiki Index below for related slugs and use ' +
        "`wiki_search` whenever the index is large or the topic isn't obvious. Include ` [[slug]] ` " +
        'markers to every related page you find — cross-linking is what keeps the wiki navigable ' +
        'across sessions. After `wiki_write` returns, inspect its `candidateLinks` field; if any ' +
        'are truly related, follow up with another `wiki_write` to add the missing links (either ' +
        'on this page, on the related page, or both so the connection is bidirectional).';
      return `# Memory\n\n${guidance}\n\n${wikiSection}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { userId, error: message },
        'Failed to build wiki memory section — falling back to empty',
      );
      return null;
    }
  }

  /** Recent Sessions block — the user's last 10 conversations (titles only). */
  private async buildRecentSessionsSection(
    userId: string,
    currentSessionId?: string,
  ): Promise<string | null> {
    try {
      const lines = await this.sessionSearch.recentSessions({
        userId,
        limit: 10,
        ...(currentSessionId ? { excludeSessionId: currentSessionId } : {}),
      });
      const block = renderRecentSessions(lines, new Date(), 350);
      if (!block) return null;
      return block + '\n\nUse `session_search` to recall details from any past conversation.';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ userId, error: message }, 'Failed to build recent sessions section');
      return null;
    }
  }

  private async buildUserMessage(
    input: string,
    channel: string,
    chatId: string,
    userName: string,
    replyContext?: ContextBuildParams['replyContext'],
  ): Promise<string> {
    const now = new Date();
    const { defaultTimezone } = await this.systemSettingsService.get();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: defaultTimezone,
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const dayName = get('weekday');
    const dateStr = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
    const tz = defaultTimezone;

    const runtimeContext = [
      '[Runtime Context]',
      `Server Time: ${dateStr} (${dayName}) (${tz})`,
      `Channel: ${channel}`,
      `Chat ID: ${chatId}`,
      `User: ${userName}`,
    ].join('\n');

    if (!replyContext) {
      return `${runtimeContext}\n\n${input}`;
    }

    const replyContextLines = [
      '[Reply Context]',
      `Original Sender ID: ${replyContext.from?.id ?? 'unknown'}`,
      `Original Sender Is Bot: ${replyContext.from?.isBot ?? false}`,
      `Original Message: ${replyContext.text}`,
    ].join('\n');

    return `${runtimeContext}\n\n${replyContextLines}\n\n${input}`;
  }
}
