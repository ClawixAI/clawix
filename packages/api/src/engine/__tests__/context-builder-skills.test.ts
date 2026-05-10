import { describe, it, expect, vi } from 'vitest';
import { ContextBuilderService } from '../context-builder.service.js';
import type { ContextBuildParams } from '../context-builder.types.js';
import type { SystemSettingsService } from '../../system-settings/system-settings.service.js';
import type { SessionRepository } from '../../db/session.repository.js';

const noopSystemSettings = {
  get: vi.fn().mockResolvedValue({
    cronDefaultTokenBudget: 10000,
    cronExecutionTimeoutMs: 300000,
    cronTokenGracePercent: 10,
    defaultTimezone: 'UTC',
  }),
} as unknown as SystemSettingsService;

describe('ContextBuilderService - skill summary integration', () => {
  it('includes skill summary between system prompt and memory', async () => {
    const mockMemoryRepo = { findVisibleToUser: vi.fn().mockResolvedValue([]) };
    const mockBootstrapService = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
    const mockSkillLoader = {
      buildSkillsSummary: vi.fn().mockResolvedValue({
        xml: '<skills><skill><name>test</name><description>Test</description><location>/workspace/skills/test/SKILL.md</location><source>custom</source></skill></skills>',
        stalenessMap: new Map(),
      }),
    };

    const sessionRepoMock = { setCachedSystemPrompt: vi.fn() };
    const service = new ContextBuilderService(
      mockMemoryRepo as any,
      mockBootstrapService as any,
      mockSkillLoader as any,
      { findById: vi.fn().mockResolvedValue({ cronEnabled: false }) } as any,
      { findById: vi.fn().mockResolvedValue({ policyId: 'p-1' }) } as any,
      noopSystemSettings,
      sessionRepoMock as unknown as SessionRepository,
      {
        listCards: vi.fn().mockResolvedValue([]),
        loadCard: vi.fn().mockResolvedValue(null),
        buildSummary: vi.fn().mockResolvedValue(''),
        buildAutoLoadedBlock: vi.fn().mockResolvedValue(''),
      } as any,
    );

    const params: ContextBuildParams = {
      agentDef: { name: 'TestAgent', description: 'A test agent', systemPrompt: 'Be helpful.' },
      history: [],
      input: 'Hello',
      userId: 'user1',
      workspacePath: '/tmp/workspace-user1',
    };

    const { messages } = await service.buildMessages(params);
    const systemContent = messages[0]!.content as string;

    expect(systemContent).toContain('<skills>');
    expect(systemContent).toContain('Skills are NOT agents');
    expect(systemContent).toContain('call read_file on its SKILL.md location');
    expect(systemContent).toContain('/workspace/skills/');
    const skillIndex = systemContent.indexOf('<skills>');
    const promptIndex = systemContent.indexOf('Be helpful.');
    expect(skillIndex).toBeGreaterThan(promptIndex);
    // Loader is called with <workspace>/skills as customDir
    expect(mockSkillLoader.buildSkillsSummary).toHaveBeenCalledWith('/tmp/workspace-user1/skills');
  });

  it('omits skill section for sub-agents even when skills are available', async () => {
    const mockMemoryRepo = { findVisibleToUser: vi.fn().mockResolvedValue([]) };
    const mockBootstrapService = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
    const mockSkillLoader = {
      buildSkillsSummary: vi.fn().mockResolvedValue({
        xml: '<skills><skill><name>test</name><description>Test</description><location>/skills/builtin/test/SKILL.md</location><source>builtin</source></skill></skills>',
        stalenessMap: new Map(),
      }),
    };

    const sessionRepoMock = { setCachedSystemPrompt: vi.fn() };
    const service = new ContextBuilderService(
      mockMemoryRepo as any,
      mockBootstrapService as any,
      mockSkillLoader as any,
      { findById: vi.fn().mockResolvedValue({ cronEnabled: false }) } as any,
      { findById: vi.fn().mockResolvedValue({ policyId: 'p-1' }) } as any,
      noopSystemSettings,
      sessionRepoMock as unknown as SessionRepository,
      {
        listCards: vi.fn().mockResolvedValue([]),
        loadCard: vi.fn().mockResolvedValue(null),
        buildSummary: vi.fn().mockResolvedValue(''),
        buildAutoLoadedBlock: vi.fn().mockResolvedValue(''),
      } as any,
    );

    const params: ContextBuildParams = {
      agentDef: {
        name: 'WorkerAgent',
        description: 'Specialised worker',
        systemPrompt: 'Do the task.',
      },
      history: [],
      input: 'Run',
      userId: 'user1',
      workspacePath: '/tmp/workspace-user1',
      isSubAgent: true,
    };

    const { messages } = await service.buildMessages(params);
    const systemContent = messages[0]!.content as string;

    expect(systemContent).not.toContain('<skills>');
    expect(systemContent).not.toContain('Skills are NOT agents');
    expect(mockSkillLoader.buildSkillsSummary).not.toHaveBeenCalled();
  });

  it('omits skill section when no skills available', async () => {
    const mockMemoryRepo = { findVisibleToUser: vi.fn().mockResolvedValue([]) };
    const mockBootstrapService = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
    const mockSkillLoader = {
      buildSkillsSummary: vi.fn().mockResolvedValue({ xml: '', stalenessMap: new Map() }),
    };

    const sessionRepoMock = { setCachedSystemPrompt: vi.fn() };
    const service = new ContextBuilderService(
      mockMemoryRepo as any,
      mockBootstrapService as any,
      mockSkillLoader as any,
      { findById: vi.fn().mockResolvedValue({ cronEnabled: false }) } as any,
      { findById: vi.fn().mockResolvedValue({ policyId: 'p-1' }) } as any,
      noopSystemSettings,
      sessionRepoMock as unknown as SessionRepository,
      {
        listCards: vi.fn().mockResolvedValue([]),
        loadCard: vi.fn().mockResolvedValue(null),
        buildSummary: vi.fn().mockResolvedValue(''),
        buildAutoLoadedBlock: vi.fn().mockResolvedValue(''),
      } as any,
    );

    const params: ContextBuildParams = {
      agentDef: { name: 'TestAgent', description: null, systemPrompt: 'Be helpful.' },
      history: [],
      input: 'Hello',
      userId: 'user1',
    };

    const { messages } = await service.buildMessages(params);
    const systemContent = messages[0]!.content as string;

    expect(systemContent).not.toContain('<skills>');
    expect(systemContent).not.toContain('Skills are NOT agents');
  });

  it('includes Skills Maintenance guidance after skills summary', async () => {
    const mockMemoryRepo = { findVisibleToUser: vi.fn().mockResolvedValue([]) };
    const mockBootstrapService = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
    const mockSkillLoader = {
      buildSkillsSummary: vi.fn().mockResolvedValue({
        xml: '<skills><skill><name>test</name><description>Test</description><location>/workspace/skills/test/SKILL.md</location><source>custom</source></skill></skills>',
        stalenessMap: new Map(),
      }),
    };

    const sessionRepoMock = { setCachedSystemPrompt: vi.fn() };
    const service = new ContextBuilderService(
      mockMemoryRepo as any,
      mockBootstrapService as any,
      mockSkillLoader as any,
      { findById: vi.fn().mockResolvedValue({ cronEnabled: false }) } as any,
      { findById: vi.fn().mockResolvedValue({ policyId: 'p-1' }) } as any,
      noopSystemSettings,
      sessionRepoMock as unknown as SessionRepository,
    );

    const params: ContextBuildParams = {
      agentDef: { name: 'TestAgent', description: 'A test agent', systemPrompt: 'Be helpful.' },
      history: [],
      input: 'Hello',
      userId: 'user1',
      workspacePath: '/tmp/workspace-user1',
    };

    const { messages } = await service.buildMessages(params);
    const systemContent = messages[0]!.content as string;

    expect(systemContent).toContain('Skills Maintenance');
    expect(systemContent).toContain('patch it');
    expect(systemContent).toContain('Preference order');
    expect(systemContent).toContain('correction is a skill');
    expect(systemContent).toContain('Would you like me to update');

    const skillsIndex = systemContent.indexOf('</skills>');
    const maintenanceIndex = systemContent.indexOf('Skills Maintenance');
    expect(maintenanceIndex).toBeGreaterThan(skillsIndex);
  });

  it('omits Skills Maintenance guidance when no skills', async () => {
    const mockMemoryRepo = { findVisibleToUser: vi.fn().mockResolvedValue([]) };
    const mockBootstrapService = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
    const mockSkillLoader = {
      buildSkillsSummary: vi.fn().mockResolvedValue({ xml: '', stalenessMap: new Map() }),
    };

    const sessionRepoMock = { setCachedSystemPrompt: vi.fn() };
    const service = new ContextBuilderService(
      mockMemoryRepo as any,
      mockBootstrapService as any,
      mockSkillLoader as any,
      { findById: vi.fn().mockResolvedValue({ cronEnabled: false }) } as any,
      { findById: vi.fn().mockResolvedValue({ policyId: 'p-1' }) } as any,
      noopSystemSettings,
      sessionRepoMock as unknown as SessionRepository,
    );

    const params: ContextBuildParams = {
      agentDef: { name: 'TestAgent', description: null, systemPrompt: 'Be helpful.' },
      history: [],
      input: 'Hello',
      userId: 'user1',
    };

    const { messages } = await service.buildMessages(params);
    const systemContent = messages[0]!.content as string;

    expect(systemContent).not.toContain('Skills Maintenance');
  });

  it('returns fresh staleness map even when system prompt is cached', async () => {
    const staleMap = new Map([['/workspace/skills/test/SKILL.md', { name: 'test', stale: true }]]);
    const mockMemoryRepo = { findVisibleToUser: vi.fn().mockResolvedValue([]) };
    const mockBootstrapService = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
    const mockSkillLoader = {
      buildSkillsSummary: vi.fn().mockResolvedValue({
        xml: '<skills><skill><name>test</name><description>Test</description><location>/workspace/skills/test/SKILL.md</location><source>custom</source></skill></skills>',
        stalenessMap: staleMap,
      }),
    };

    const sessionRepoMock = { setCachedSystemPrompt: vi.fn() };
    const service = new ContextBuilderService(
      mockMemoryRepo as any,
      mockBootstrapService as any,
      mockSkillLoader as any,
      { findById: vi.fn().mockResolvedValue({ cronEnabled: false }) } as any,
      { findById: vi.fn().mockResolvedValue({ policyId: 'p-1' }) } as any,
      noopSystemSettings,
      sessionRepoMock as unknown as SessionRepository,
    );

    const cachedPrompt = 'Cached system prompt with skills';
    const params: ContextBuildParams = {
      agentDef: { name: 'TestAgent', description: null, systemPrompt: 'Be helpful.' },
      history: [],
      input: 'Hello',
      userId: 'user1',
      workspacePath: '/tmp/workspace-user1',
      session: { id: 'session-1', cachedSystemPrompt: cachedPrompt },
    };

    const { messages, stalenessMap } = await service.buildMessages(params);

    expect(messages[0]!.content as string).toBe(cachedPrompt);
    expect(stalenessMap.size).toBe(1);
    expect(stalenessMap.get('/workspace/skills/test/SKILL.md')).toEqual({
      name: 'test',
      stale: true,
    });
    expect(mockSkillLoader.buildSkillsSummary).toHaveBeenCalledWith('/tmp/workspace-user1/skills');
  });
});
