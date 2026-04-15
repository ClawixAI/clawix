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
import type { MemoryItemRepository } from '../../db/memory-item.repository.js';
import type { BootstrapFileService } from '../bootstrap-file.service.js';
import type { SkillLoaderService } from '../skill-loader.service.js';
import type { PolicyRepository } from '../../db/policy.repository.js';
import type { UserRepository } from '../../db/user.repository.js';
import type { ContextBuildParams } from '../context-builder.types.js';

// Default mocks for cron section — cronEnabled: false so no section is injected
const noopPolicyRepo = {
  findById: vi.fn().mockResolvedValue({ cronEnabled: false }),
} as unknown as PolicyRepository;
const noopUserRepo = {
  findById: vi.fn().mockResolvedValue({ policyId: 'p-1' }),
} as unknown as UserRepository;

describe('ContextBuilderService', () => {
  let service: ContextBuilderService;
  let mockMemoryRepo: {
    findVisibleToUser: ReturnType<typeof vi.fn>;
    findDailyNotes: ReturnType<typeof vi.fn>;
    findDistinctTags: ReturnType<typeof vi.fn>;
  };

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
    mockMemoryRepo = {
      findVisibleToUser: vi.fn().mockResolvedValue([]),
      findDailyNotes: vi.fn().mockResolvedValue([]),
      findDistinctTags: vi.fn().mockResolvedValue([]),
    };
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const noopBootstrap = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
    const noopSkillLoader = { buildSkillsSummary: vi.fn().mockResolvedValue('') };
    service = new ContextBuilderService(
      mockMemoryRepo as unknown as MemoryItemRepository,
      noopBootstrap as unknown as BootstrapFileService,
      noopSkillLoader as unknown as SkillLoaderService,
      noopPolicyRepo,
      noopUserRepo,
    );
  });

  describe('buildMessages', () => {
    it('should return system, history, and user messages', async () => {
      const result = await service.buildMessages(baseParams);

      expect(result).toHaveLength(2);
      expect(result[0]!.role).toBe('system');
      expect(result[1]!.role).toBe('user');
    });

    it('should include agent identity in system prompt', async () => {
      const result = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).toContain('# TestAgent');
      expect(system).toContain('A test assistant');
    });

    it('should include workspace block in system prompt when workspacePath is provided', async () => {
      const params = { ...baseParams, workspacePath: '/workspace' };
      const result = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('Your workspace is at: /workspace');
      expect(system).toContain('read_file');
    });

    it('should omit workspace block when workspacePath is not provided', async () => {
      const result = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).not.toContain('Your workspace is at: /workspace');
      expect(system).not.toContain('## Workspace');
    });

    it('should include agentDef.systemPrompt verbatim', async () => {
      const result = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).toContain('You are helpful.');
    });

    it('should prepend runtime context to user message', async () => {
      const result = await service.buildMessages(baseParams);

      const userContent = result[result.length - 1]!.content as string;
      expect(userContent).toContain('[Runtime Context]');
      expect(userContent).toContain('Channel: telegram');
      expect(userContent).toContain('Chat ID: 123456');
      expect(userContent).toContain('User: Alice');
      expect(userContent).toContain('Hello');
    });

    it('should include Server Time in runtime context', async () => {
      const result = await service.buildMessages(baseParams);

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

      const result = await service.buildMessages(params);

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

      const result = await service.buildMessages(params);

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

      const result = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('# TestAgent');
      expect(system).not.toContain('null');
    });
  });

  describe('memory injection', () => {
    it('should append memory section when daily notes exist', async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockMemoryRepo.findDailyNotes.mockResolvedValue([
        {
          id: 'mem-1',
          ownerId: 'user-1',
          content: { text: 'User prefers TypeScript' },
          tags: [`daily:${today}`],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).toContain('# Memory');
      expect(system).toContain('User prefers TypeScript');
    });

    it('should omit memory section when all tiers are empty', async () => {
      const result = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).not.toContain('# Memory\n\n');
    });

    it('should format string content directly in daily notes', async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockMemoryRepo.findDailyNotes.mockResolvedValue([
        {
          id: 'mem-1',
          ownerId: 'user-1',
          content: 'Simple string memory',
          tags: [`daily:${today}`],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).toContain('- Simple string memory');
    });

    it('should use text field from object content in daily notes', async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockMemoryRepo.findDailyNotes.mockResolvedValue([
        {
          id: 'mem-1',
          ownerId: 'user-1',
          content: { text: 'Object with text', extra: 'ignored' },
          tags: [`daily:${today}`],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).toContain('- Object with text');
    });

    it('should JSON.stringify non-text objects in daily notes', async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockMemoryRepo.findDailyNotes.mockResolvedValue([
        {
          id: 'mem-1',
          ownerId: 'user-1',
          content: { key: 'value', nested: true },
          tags: [`daily:${today}`],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).toContain('{"key":"value","nested":true}');
    });

    it('should respect daily notes token budget and stop adding items', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const makeItem = (id: number) => ({
        id: `mem-${id}`,
        ownerId: 'user-1',
        content: `MARKER_${id}_${'x'.repeat(380)}`,
        tags: [`daily:${today}`],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const items = Array.from({ length: 25 }, (_, i) => makeItem(i + 1));
      mockMemoryRepo.findDailyNotes.mockResolvedValue(items);

      const result = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).toContain('MARKER_1_');
      // With DAILY_NOTES_TOKEN_BUDGET=1000 and ~100 tokens per item, we should stop well before 25
      expect(system).not.toContain('MARKER_25_');
    });

    it('should truncate individual items exceeding max chars', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const longContent = 'a'.repeat(600);
      mockMemoryRepo.findDailyNotes.mockResolvedValue([
        {
          id: 'mem-1',
          ownerId: 'user-1',
          content: longContent,
          tags: [`daily:${today}`],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).toContain('...');
    });

    it('should gracefully omit memory section when repository throws', async () => {
      mockMemoryRepo.findDailyNotes.mockRejectedValue(new Error('DB connection failed'));
      mockMemoryRepo.findDistinctTags.mockRejectedValue(new Error('DB connection failed'));

      const result = await service.buildMessages(baseParams);

      const system = result[0]!.content as string;
      expect(system).toContain('# TestAgent');
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
      const result = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('# Available Sub-Agents');
      expect(system).toContain('**researcher**: Searches the web for information');
      expect(system).toContain('**coder**: Writes and tests code');
      expect(system).toContain('spawn(agent_name=');
      expect(system).toContain('spawn(prompt=');
    });

    it('should omit workers section when workers array is empty', async () => {
      const params = { ...baseParams, workers: [] };
      const result = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).not.toContain('# Available Sub-Agents');
    });

    it('should omit workers section for sub-agents even if workers provided', async () => {
      const params = {
        ...baseParams,
        isSubAgent: true,
        workers: [{ name: 'researcher', description: 'Searches stuff' }],
      };
      const result = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).not.toContain('# Available Sub-Agents');
    });

    it('should handle worker with null description', async () => {
      const params = {
        ...baseParams,
        workers: [{ name: 'helper', description: null }],
      };
      const result = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('- **helper**');
      expect(system).not.toContain('null');
    });
  });

  describe('sub-agent context', () => {
    it('should use sub-agent framing instead of primary identity when isSubAgent is true', async () => {
      const params = { ...baseParams, isSubAgent: true };
      const result = await service.buildMessages(params);

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
      const result = await service.buildMessages(params);

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
      const noopSkillLoader = { buildSkillsSummary: vi.fn().mockResolvedValue('') };
      const svc = new ContextBuilderService(
        mockMemoryRepo as unknown as MemoryItemRepository,
        mockBootstrap as unknown as BootstrapFileService,
        noopSkillLoader as unknown as SkillLoaderService,
        noopPolicyRepo,
        noopUserRepo,
      );

      const params = { ...baseParams, isSubAgent: true, workspacePath: '/workspace' };
      const result = await svc.buildMessages(params);

      const system = result[0]!.content as string;
      expect(mockBootstrap.loadBootstrapFiles).not.toHaveBeenCalled();
      expect(system).not.toContain('SOUL.md');
    });

    it('should still include workspace section for sub-agents when workspacePath is provided', async () => {
      const params = { ...baseParams, isSubAgent: true, workspacePath: '/workspace' };
      const result = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('Your workspace is at: /workspace');
    });

    it('should still include agent systemPrompt for sub-agents', async () => {
      const params = { ...baseParams, isSubAgent: true };
      const result = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('You are helpful.');
    });

    it('should still include memory for sub-agents', async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockMemoryRepo.findDailyNotes.mockResolvedValue([
        {
          id: 'mem-1',
          ownerId: 'user-1',
          content: 'Remember this',
          tags: [`daily:${today}`],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const params = { ...baseParams, isSubAgent: true };
      const result = await service.buildMessages(params);

      const system = result[0]!.content as string;
      expect(system).toContain('# Memory');
      expect(system).toContain('Remember this');
    });
  });

  describe('bootstrap file injection', () => {
    let mockBootstrapService: { loadBootstrapFiles: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockBootstrapService = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
      const noopSkillLoader = { buildSkillsSummary: vi.fn().mockResolvedValue('') };
      service = new ContextBuilderService(
        mockMemoryRepo as unknown as MemoryItemRepository,
        mockBootstrapService as unknown as BootstrapFileService,
        noopSkillLoader as unknown as SkillLoaderService,
        noopPolicyRepo,
        noopUserRepo,
      );
    });

    it('should inject bootstrap sections between identity and workspace', async () => {
      mockBootstrapService.loadBootstrapFiles.mockResolvedValue([
        { filename: 'SOUL.md', content: '# Soul\nHelpful' },
        { filename: 'USER.md', content: '# User Profile\nAlice' },
      ]);

      const params = { ...baseParams, workspacePath: '/workspace' };
      const result = await service.buildMessages(params);
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
      const result = await service.buildMessages(baseParams);
      const system = result[0]!.content as string;

      expect(mockBootstrapService.loadBootstrapFiles).not.toHaveBeenCalled();
      expect(system).toContain('# TestAgent');
      expect(system).not.toContain('## Workspace');
    });

    it('should work with no bootstrap files found', async () => {
      mockBootstrapService.loadBootstrapFiles.mockResolvedValue([]);

      const params = { ...baseParams, workspacePath: '/workspace' };
      const result = await service.buildMessages(params);
      const system = result[0]!.content as string;

      expect(system).toContain('# TestAgent');
      expect(system).toContain('## Workspace');
    });
  });

  describe('buildMemorySection — 3-tier', () => {
    it('should include MEMORY.md content in Long-term Memory section', async () => {
      mockReadFile.mockResolvedValue('# My notes\nI like TypeScript' as never);

      const result = await service.buildMessages({
        ...baseParams,
        workspacePath: '/data/users/u1/workspace',
      });

      const system = result[0]!.content as string;
      expect(system).toContain('## Long-term Memory');
      expect(system).toContain('I like TypeScript');
    });

    it('should include daily notes from last 3 days', async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockMemoryRepo.findDailyNotes.mockResolvedValue([
        { content: 'Worked on auth', tags: [`daily:${today}`], createdAt: new Date() },
      ]);

      const result = await service.buildMessages({
        ...baseParams,
        workspacePath: '/data/users/u1/workspace',
      });

      const system = result[0]!.content as string;
      expect(system).toContain('## Recent Activity');
      expect(system).toContain('Worked on auth');
    });

    it('should include tag index without daily: tags', async () => {
      mockMemoryRepo.findDistinctTags.mockResolvedValue(['preference', 'project-auth']);

      const result = await service.buildMessages({
        ...baseParams,
        workspacePath: '/data/users/u1/workspace',
      });

      const system = result[0]!.content as string;
      expect(system).toContain('## Available Memory Tags');
      expect(system).toContain('preference, project-auth');
    });

    it('should return no memory section when all tiers are empty', async () => {
      const result = await service.buildMessages(baseParams);
      const system = result[0]!.content as string;
      expect(system).not.toContain('# Memory');
    });
  });
});
