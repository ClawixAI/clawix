import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@clawix/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clawix/shared')>();
  return {
    ...actual,
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('fs/promises');

import * as fs from 'fs/promises';
const mockReadFile = vi.mocked(fs.readFile);

import { ContextBuilderService } from '../context-builder.service.js';
import type { BootstrapFileService } from '../bootstrap-file.service.js';
import type { SkillLoaderService } from '../skill-loader.service.js';
import type { PolicyRepository } from '../../db/policy.repository.js';
import type { UserRepository } from '../../db/user.repository.js';
import type { SystemSettingsService } from '../../system-settings/system-settings.service.js';
import type { ContextBuildParams } from '../context-builder.types.js';
import type { SessionRepository } from '../../db/session.repository.js';
import type { WikiPageRepository } from '../../db/wiki-page.repository.js';
import type { WikiBootstrapService } from '../wiki/wiki-bootstrap.service.js';
import type { SessionSearchService } from '../session-recall/session-search.service.js';

// Default mocks for cron section — cronEnabled: false so no section is injected
const noopPolicyRepo = {
  findById: vi.fn().mockResolvedValue({ cronEnabled: false }),
} as unknown as PolicyRepository;
const noopUserRepo = {
  findById: vi.fn().mockResolvedValue({ policyId: 'p-1' }),
} as unknown as UserRepository;
const noopSystemSettings: {
  get: ReturnType<typeof vi.fn>;
} = {
  get: vi.fn().mockResolvedValue({
    cronDefaultTokenBudget: 10000,
    cronExecutionTimeoutMs: 300000,
    cronTokenGracePercent: 10,
    defaultTimezone: 'UTC',
  }),
};

const noopSessionSearch = {
  recentSessions: vi.fn().mockResolvedValue([]),
  search: vi.fn().mockResolvedValue([]),
} as unknown as SessionSearchService;

describe('ContextBuilderService', () => {
  let service: ContextBuilderService;
  let systemSettingsService: { get: ReturnType<typeof vi.fn> };
  let sessionRepoMock: {
    findById: ReturnType<typeof vi.fn>;
    setCachedSystemPrompt: ReturnType<typeof vi.fn>;
  };
  let mockWikiPageRepo: {
    listOwnedByUser: ReturnType<typeof vi.fn>;
    findDailyNotes: ReturnType<typeof vi.fn>;
    findVisibleToUser: ReturnType<typeof vi.fn>;
  };
  let mockWikiBootstrap: { ensureMigrated: ReturnType<typeof vi.fn> };

  const baseParams: ContextBuildParams = {
    agentDef: {
      name: 'TestAgent',
      description: 'A test assistant',
      systemPrompt: 'You are helpful.',
    },
    history: [],
    input: 'Hello',
    userId: 'user-1',
    channel: 'telegram',
    chatId: '123456',
    userName: 'Alice',
  };

  beforeEach(() => {
    systemSettingsService = {
      get: vi.fn().mockResolvedValue({
        cronDefaultTokenBudget: 10000,
        cronExecutionTimeoutMs: 300000,
        cronTokenGracePercent: 10,
        defaultTimezone: 'UTC',
      }),
    };
    sessionRepoMock = {
      findById: vi.fn(),
      setCachedSystemPrompt: vi.fn().mockResolvedValue(undefined),
    };
    mockWikiPageRepo = {
      listOwnedByUser: vi.fn().mockResolvedValue([]),
      findDailyNotes: vi.fn().mockResolvedValue([]),
      findVisibleToUser: vi.fn().mockResolvedValue([]),
    };
    mockWikiBootstrap = { ensureMigrated: vi.fn().mockResolvedValue(undefined) };
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const noopBootstrap = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
    const noopSkillLoader = {
      buildSkillsSummary: vi.fn().mockResolvedValue({ xml: '', stalenessMap: new Map() }),
    };
    service = new ContextBuilderService(
      noopBootstrap as unknown as BootstrapFileService,
      noopSkillLoader as unknown as SkillLoaderService,
      noopPolicyRepo,
      noopUserRepo,
      systemSettingsService as unknown as SystemSettingsService,
      sessionRepoMock as unknown as SessionRepository,
      mockWikiPageRepo as unknown as WikiPageRepository,
      mockWikiBootstrap as unknown as WikiBootstrapService,
      noopSessionSearch,
    );
  });

  describe('buildMessages', () => {
    it('should return system, history, and user messages', async () => {
      const { messages: result } = await service.buildMessages(baseParams);

      expect(result).toHaveLength(2);
      expect(result[0]!.role).toBe('system');
      expect(result[1]!.role).toBe('user');
    });

    it('should include agent identity in system prompt', async () => {
      const { messages: result } = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).toContain('# TestAgent');
      expect(system).toContain('A test assistant');
    });

    it('should include workspace block in system prompt when workspacePath is provided', async () => {
      const params = { ...baseParams, workspacePath: '/workspace' };
      const { messages: result } = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('Your workspace is at: /workspace');
      expect(system).toContain('read_file');
    });

    it('should omit workspace block when workspacePath is not provided', async () => {
      const { messages: result } = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).not.toContain('Your workspace is at: /workspace');
      expect(system).not.toContain('## Workspace');
    });

    it('should include agentDef.systemPrompt verbatim', async () => {
      const { messages: result } = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).toContain('You are helpful.');
    });

    it('should prepend runtime context to user message', async () => {
      const { messages: result } = await service.buildMessages(baseParams);

      const userContent = result[result.length - 1]!.content as string;
      expect(userContent).toContain('[Runtime Context]');
      expect(userContent).toContain('Channel: telegram');
      expect(userContent).toContain('Chat ID: 123456');
      expect(userContent).toContain('User: Alice');
      expect(userContent).toContain('Hello');
    });

    it('should include reply context when provided', async () => {
      const params: ContextBuildParams = {
        ...baseParams,
        replyContext: {
          from: { id: 42, date: 1_700_000_000, isBot: false },
          text: 'Original message text',
        },
      };

      const { messages: result } = await service.buildMessages(params);

      const userContent = result[result.length - 1]!.content as string;
      expect(userContent).toContain('[Reply Context]');
      expect(userContent).toContain('Original Sender ID: 42');
      expect(userContent).toContain('Original Sender Is Bot: false');
      expect(userContent).toContain('Original Message: Original message text');
    });

    it('should include Server Time in runtime context', async () => {
      const { messages: result } = await service.buildMessages(baseParams);

      const userContent = result[result.length - 1]!.content as string;
      expect(userContent).toContain('Server Time:');
    });

    it('should use defaults when channel/chatId/userName omitted', async () => {
      const params: ContextBuildParams = {
        agentDef: baseParams.agentDef,
        history: [],
        input: 'Hello',
        userId: 'user-1',
      };

      const { messages: result } = await service.buildMessages(params);

      const userContent = result[result.length - 1]!.content as string;
      expect(userContent).toContain('Channel: internal');
      expect(userContent).toContain('Chat ID: system');
      expect(userContent).toContain('User: System');
    });

    it('should preserve history messages between system and user', async () => {
      const params: ContextBuildParams = {
        ...baseParams,
        history: [
          { role: 'user', content: 'previous question' },
          { role: 'assistant', content: 'previous answer' },
        ],
      };

      const { messages: result } = await service.buildMessages(params);

      expect(result).toHaveLength(4);
      expect(result[1]!.role).toBe('user');
      expect(result[1]!.content).toBe('previous question');
      expect(result[2]!.role).toBe('assistant');
    });

    it('should omit description from identity when null', async () => {
      const params: ContextBuildParams = {
        ...baseParams,
        agentDef: { ...baseParams.agentDef, description: null },
      };

      const { messages: result } = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('# TestAgent');
      expect(system).not.toContain('null');
    });
  });

  describe('memory injection', () => {
    it('should omit memory section when wiki repos are empty (wiki-only path)', async () => {
      const { messages: result } = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).not.toContain('# Memory\n\n');
    });
  });

  describe('workers injection', () => {
    it('should include available sub-agents section when workers are provided', async () => {
      const params = {
        ...baseParams,
        workers: [
          { name: 'researcher', description: 'Searches the web for information' },
          { name: 'coder', description: 'Writes and tests code' },
        ],
      };
      const { messages: result } = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('# Available Sub-Agents');
      expect(system).toContain('**researcher**: Searches the web for information');
      expect(system).toContain('**coder**: Writes and tests code');
      expect(system).toContain('spawn(agent_name=');
      expect(system).toContain('spawn(prompt=');
    });

    it('should omit workers section when workers array is empty', async () => {
      const params = { ...baseParams, workers: [] };
      const { messages: result } = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).not.toContain('# Available Sub-Agents');
    });

    it('should omit workers section for sub-agents even if workers provided', async () => {
      const params = {
        ...baseParams,
        isSubAgent: true,
        workers: [{ name: 'researcher', description: 'Searches stuff' }],
      };
      const { messages: result } = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).not.toContain('# Available Sub-Agents');
    });

    it('should handle worker with null description', async () => {
      const params = {
        ...baseParams,
        workers: [{ name: 'helper', description: null }],
      };
      const { messages: result } = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('- **helper**');
      expect(system).not.toContain('null');
    });
  });

  describe('sub-agent context', () => {
    it('should use sub-agent framing instead of primary identity when isSubAgent is true', async () => {
      const params = { ...baseParams, isSubAgent: true };
      const { messages: result } = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('# Sub-Agent');
      expect(system).toContain('sub-agent spawned by the main agent');
      expect(system).toContain('Stay focused on the assigned task');
      expect(system).toContain('Agent type: TestAgent');
      expect(system).toContain('Role: A test assistant');
      expect(system).not.toContain('# TestAgent');
    });

    it('should omit sub-agent role line when description is null', async () => {
      const params = {
        ...baseParams,
        isSubAgent: true,
        agentDef: { ...baseParams.agentDef, description: null },
      };
      const { messages: result } = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('Agent type: TestAgent');
      expect(system).not.toContain('Role:');
    });

    it('should skip bootstrap files when isSubAgent is true even with workspacePath', async () => {
      const mockBootstrap = {
        loadBootstrapFiles: vi
          .fn()
          .mockResolvedValue([{ filename: 'SOUL.md', content: 'soul content' }]),
      };
      const noopSkillLoader = {
        buildSkillsSummary: vi.fn().mockResolvedValue({ xml: '', stalenessMap: new Map() }),
      };
      const svc = new ContextBuilderService(
        mockBootstrap as unknown as BootstrapFileService,
        noopSkillLoader as unknown as SkillLoaderService,
        noopPolicyRepo,
        noopUserRepo,
        noopSystemSettings as unknown as SystemSettingsService,
        sessionRepoMock as unknown as SessionRepository,
        mockWikiPageRepo as unknown as WikiPageRepository,
        mockWikiBootstrap as unknown as WikiBootstrapService,
        noopSessionSearch,
      );

      const params = { ...baseParams, isSubAgent: true, workspacePath: '/workspace' };
      const { messages: result } = await svc.buildMessages(params);

      const system = result[0]!.content as string;
      expect(mockBootstrap.loadBootstrapFiles).not.toHaveBeenCalled();
      expect(system).not.toContain('SOUL.md');
    });

    it('should still include workspace section for sub-agents when workspacePath is provided', async () => {
      const params = { ...baseParams, isSubAgent: true, workspacePath: '/workspace' };
      const { messages: result } = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('Your workspace is at: /workspace');
    });

    it('should still include agent systemPrompt for sub-agents', async () => {
      const params = { ...baseParams, isSubAgent: true };
      const { messages: result } = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('You are helpful.');
    });

    it('includes only Tool Use guidance, not Skills, for sub-agents', async () => {
      const params = { ...baseParams, isSubAgent: true };
      const { messages: result } = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('# Operating Principles');
      expect(system).toContain('**Tool use.**');
      expect(system).not.toContain('**Skills.**');
    });

    it('should still attempt memory for sub-agents (wiki path returns null when empty)', async () => {
      const params = { ...baseParams, isSubAgent: true };
      const { messages: result } = await service.buildMessages(params);

      const system = result[0]!.content as string;
      // When wiki repos are empty, no memory section is injected
      expect(system).not.toContain('# Memory');
    });
  });

  describe('bootstrap file injection', () => {
    let mockBootstrapService: { loadBootstrapFiles: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockBootstrapService = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
      const noopSkillLoader = {
        buildSkillsSummary: vi.fn().mockResolvedValue({ xml: '', stalenessMap: new Map() }),
      };
      service = new ContextBuilderService(
        mockBootstrapService as unknown as BootstrapFileService,
        noopSkillLoader as unknown as SkillLoaderService,
        noopPolicyRepo,
        noopUserRepo,
        noopSystemSettings as unknown as SystemSettingsService,
        sessionRepoMock as unknown as SessionRepository,
        mockWikiPageRepo as unknown as WikiPageRepository,
        mockWikiBootstrap as unknown as WikiBootstrapService,
        noopSessionSearch,
      );
    });

    it('should inject bootstrap sections between identity and workspace', async () => {
      mockBootstrapService.loadBootstrapFiles.mockResolvedValue([
        { filename: 'SOUL.md', content: '# Soul\nHelpful' },
        { filename: 'USER.md', content: '# User Profile\nAlice' },
      ]);

      const params = { ...baseParams, workspacePath: '/workspace' };
      const { messages: result } = await service.buildMessages(params);
      const system = result[0]!.content as string;

      const identityIdx = system.indexOf('# TestAgent');
      const soulIdx = system.indexOf('## SOUL.md\n\n# Soul\nHelpful');
      const userIdx = system.indexOf('## USER.md\n\n# User Profile\nAlice');
      const workspaceIdx = system.indexOf('## Workspace');

      expect(soulIdx).toBeGreaterThan(identityIdx);
      expect(userIdx).toBeGreaterThan(soulIdx);
      expect(workspaceIdx).toBeGreaterThan(userIdx);
    });

    it('should skip bootstrap files and workspace section when workspacePath is not provided', async () => {
      const { messages: result } = await service.buildMessages(baseParams);
      const system = result[0]!.content as string;

      expect(mockBootstrapService.loadBootstrapFiles).not.toHaveBeenCalled();
      expect(system).toContain('# TestAgent');
      expect(system).not.toContain('## Workspace');
    });

    it('should work with no bootstrap files found', async () => {
      mockBootstrapService.loadBootstrapFiles.mockResolvedValue([]);

      const params = { ...baseParams, workspacePath: '/workspace' };
      const { messages: result } = await service.buildMessages(params);
      const system = result[0]!.content as string;

      expect(system).toContain('# TestAgent');
      expect(system).toContain('## Workspace');
    });
  });

  describe('buildMemorySection — wiki-only', () => {
    it('should return no memory section when wiki repos are empty', async () => {
      const { messages: result } = await service.buildMessages(baseParams);
      const system = result[0]!.content as string;
      expect(system).not.toContain('# Memory');
    });

    it('includes Operating Principles section with Tool Use and Skills for primary agents', async () => {
      const { messages: result } = await service.buildMessages(baseParams);
      const system = result[0]!.content as string;

      expect(system).toContain('# Operating Principles');
      expect(system).toContain('**Tool use.**');
      expect(system).toContain('**Skills.**');
    });

    it('embeds declarative-vs-imperative guidance in the workspace Memory section', async () => {
      const params = { ...baseParams, workspacePath: '/workspace' };
      const { messages: result } = await service.buildMessages(params);
      const system = result[0]!.content as string;

      expect(system).toMatch(/declarative facts, not instructions/i);
      expect(system).toContain('"User prefers concise responses"');
    });

    it('embeds verification and tool-over-mental-computation guidance in the Tool Use paragraph', async () => {
      const { messages: result } = await service.buildMessages(baseParams);
      const system = result[0]!.content as string;

      expect(system).toContain('verify the result before declaring done');
      expect(system).toMatch(/prefer tools over mental computation/i);
    });

    it('places Operating Principles after agentDef.systemPrompt content', async () => {
      const { messages: result } = await service.buildMessages(baseParams);
      const system = result[0]!.content as string;

      const promptIdx = system.indexOf('You are helpful.');
      const principlesIdx = system.indexOf('# Operating Principles');

      expect(promptIdx).toBeGreaterThanOrEqual(0);
      expect(principlesIdx).toBeGreaterThanOrEqual(0);
      expect(principlesIdx).toBeGreaterThan(promptIdx);
    });
  });

  describe('execution context (scheduled tasks)', () => {
    it('includes Execution Context section when isScheduledTask=true', async () => {
      const params = {
        ...baseParams,
        isScheduledTask: true,
      };
      const { messages: result } = await service.buildMessages(params);

      const systemMsg = result.find((m) => m.role === 'system');
      expect(systemMsg?.content).toContain('# Execution Context');
      expect(systemMsg?.content).toContain('running as a scheduled task');
      expect(systemMsg?.content).toContain("The user's prompt is the deliverable");
      expect(systemMsg?.content).toContain('you have failed the task');
    });

    it('omits Execution Context section when isScheduledTask=false or undefined', async () => {
      const { messages: result } = await service.buildMessages(baseParams);

      const systemMsg = result.find((m) => m.role === 'system');
      expect(systemMsg?.content).not.toContain('# Execution Context');
    });

    it('includes Persistent Notes block when chatId is "cron:<taskId>"', async () => {
      const params = {
        ...baseParams,
        isScheduledTask: true,
        chatId: 'cron:abc123',
      };
      const { messages: result } = await service.buildMessages(params);

      const systemMsg = result.find((m) => m.role === 'system');
      const content = systemMsg?.content as string;
      expect(content).toContain('scheduled task `abc123`');
      expect(content).toContain('## Persistent Notes (optional)');
      expect(content).toContain('/workspace/memory/cron/abc123/');
      expect(content).toContain('read_file');
      expect(content).toContain('write_file');
      expect(content).toContain('Avoid `list_directory` on this folder');
      expect(content).toContain('parent directories are created automatically');
      expect(content).toContain('Prefer this folder over `wiki_write`');
    });

    it('omits Persistent Notes block when chatId does not have "cron:" prefix', async () => {
      const params = {
        ...baseParams,
        isScheduledTask: true,
        chatId: '123456',
      };
      const { messages: result } = await service.buildMessages(params);

      const systemMsg = result.find((m) => m.role === 'system');
      const content = systemMsg?.content as string;
      expect(content).toContain('# Execution Context');
      expect(content).not.toContain('## Persistent Notes');
      expect(content).not.toContain('/workspace/memory/cron/');
    });
  });

  describe('cron section cross-session reference guidance', () => {
    it('includes cron reference guidance when cron enabled and not a scheduled task', async () => {
      const cronEnabledPolicyRepo = {
        findById: vi.fn().mockResolvedValue({ cronEnabled: true }),
      } as unknown as PolicyRepository;
      const noopSkillLoader = {
        buildSkillsSummary: vi.fn().mockResolvedValue({ xml: '', stalenessMap: new Map() }),
      };
      const svc = new ContextBuilderService(
        service['bootstrapFileService'] as unknown as BootstrapFileService,
        noopSkillLoader as unknown as SkillLoaderService,
        cronEnabledPolicyRepo,
        noopUserRepo,
        noopSystemSettings as unknown as SystemSettingsService,
        sessionRepoMock as unknown as SessionRepository,
        mockWikiPageRepo as unknown as WikiPageRepository,
        mockWikiBootstrap as unknown as WikiBootstrapService,
        noopSessionSearch,
      );

      const { messages: result } = await svc.buildMessages(baseParams);

      const systemMsg = result.find((m) => m.role === 'system');
      expect(systemMsg?.content).toContain("action:'runs'");
      expect(systemMsg?.content).toContain("action:'runDetail'");
      expect(systemMsg?.content).toContain('Scheduled-task output is not part of this');
    });

    it('omits cron reference guidance when cron is disabled', async () => {
      const { messages: result } = await service.buildMessages(baseParams);

      const systemMsg = result.find((m) => m.role === 'system');
      expect(systemMsg?.content).not.toContain("action:'runs'");
      expect(systemMsg?.content).not.toContain("action:'runDetail'");
    });
  });

  describe('ContextBuilderService — Server Time uses defaultTimezone', () => {
    it('formats the Server Time line under SystemSettings.defaultTimezone', async () => {
      systemSettingsService.get.mockResolvedValue({
        cronDefaultTokenBudget: 10000,
        cronExecutionTimeoutMs: 300000,
        cronTokenGracePercent: 10,
        defaultTimezone: 'Asia/Tokyo',
      });

      const { messages: result } = await service.buildMessages(baseParams);

      const userContent = result[result.length - 1]!.content as string;
      expect(userContent).toContain('(Asia/Tokyo)');
    });
  });

  describe('ContextBuilderService — system prompt caching', () => {
    it('returns the cached snapshot without rendering when one exists', async () => {
      const sessionId = 'session-cached';
      const cachedPrompt = 'pre-rendered system prompt v1';

      const { messages: result } = await service.buildMessages({
        agentDef: baseParams.agentDef,
        history: [],
        input: 'hello',
        userId: 'user-1',
        session: { id: sessionId, cachedSystemPrompt: cachedPrompt },
      });

      const systemMessage = result.find((m) => m.role === 'system');
      expect(systemMessage?.content).toBe(cachedPrompt);
      expect(sessionRepoMock.setCachedSystemPrompt).not.toHaveBeenCalled();
      // Wiki repo should not be queried when the system prompt cache is hit
      expect(mockWikiPageRepo.listOwnedByUser).not.toHaveBeenCalled();
    });

    it('renders fresh and persists the snapshot when session present but cachedSystemPrompt is null', async () => {
      const sessionId = 'session-fresh';

      const { messages: result } = await service.buildMessages({
        agentDef: baseParams.agentDef,
        history: [],
        input: 'hello',
        userId: 'user-1',
        session: { id: sessionId, cachedSystemPrompt: null },
      });

      const systemMessage = result.find((m) => m.role === 'system');
      expect(systemMessage?.content).toContain(baseParams.agentDef.name); // proves it rendered
      expect(sessionRepoMock.setCachedSystemPrompt).toHaveBeenCalledWith(
        sessionId,
        systemMessage?.content,
      );
    });

    it('renders fresh without persisting when no session (sessionless path)', async () => {
      const { messages: result } = await service.buildMessages({
        agentDef: baseParams.agentDef,
        history: [],
        input: 'hello',
        userId: 'user-1',
        // no session
      });

      const systemMessage = result.find((m) => m.role === 'system');
      expect(systemMessage?.content).toContain(baseParams.agentDef.name);
      expect(sessionRepoMock.setCachedSystemPrompt).not.toHaveBeenCalled();
    });

    it('round-trip: second call within the same session returns the persisted snapshot byte-for-byte', async () => {
      const sessionId = 'session-roundtrip';
      let stored: string | null = null;
      sessionRepoMock.setCachedSystemPrompt.mockImplementation(
        async (_id: string, prompt: string) => {
          if (stored === null) stored = prompt;
        },
      );

      const callOnce = (input: string) =>
        service.buildMessages({
          agentDef: baseParams.agentDef,
          history: [],
          input,
          userId: 'user-1',
          session: { id: sessionId, cachedSystemPrompt: stored },
        });

      const first = await callOnce('first');
      const second = await callOnce('second');

      const firstSystem = first.messages.find((m) => m.role === 'system')?.content;
      const secondSystem = second.messages.find((m) => m.role === 'system')?.content;
      expect(firstSystem).toBe(secondSystem); // byte-identical
      expect(secondSystem).toBe(stored); // and equals what was persisted
    });

    it('continues with rendered output when setCachedSystemPrompt persistence fails', async () => {
      sessionRepoMock.setCachedSystemPrompt.mockRejectedValue(new Error('DB unavailable'));

      const { messages: result } = await service.buildMessages({
        agentDef: baseParams.agentDef,
        history: [],
        input: 'hello',
        userId: 'user-1',
        session: { id: 'session-persist-fails', cachedSystemPrompt: null },
      });

      const systemMessage = result.find((m) => m.role === 'system');
      expect(systemMessage?.content).toContain(baseParams.agentDef.name); // proves it rendered
      // The thrown error from the persist call did NOT bubble up
    });
  });
});
