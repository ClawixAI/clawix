import { describe, it, expect, vi } from 'vitest';
import { ContextBuilderService } from '../context-builder.service.js';
import type { ContextBuildParams } from '../context-builder.types.js';

describe('ContextBuilderService - skill summary integration', () => {
  it('includes skill summary between system prompt and memory', async () => {
    const mockMemoryRepo = { findVisibleToUser: vi.fn().mockResolvedValue([]) };
    const mockBootstrapService = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
    const mockSkillLoader = {
      buildSkillsSummary: vi
        .fn()
        .mockResolvedValue(
          '<skills><skill><name>test</name><description>Test</description><location>/skills/builtin/test/SKILL.md</location><source>builtin</source></skill></skills>',
        ),
    };

    const service = new ContextBuilderService(
      mockMemoryRepo as any,
      mockBootstrapService as any,
      mockSkillLoader as any,
      { findById: vi.fn().mockResolvedValue({ cronEnabled: false }) } as any,
      { findById: vi.fn().mockResolvedValue({ policyId: 'p-1' }) } as any,
    );

    const params: ContextBuildParams = {
      agentDef: { name: 'TestAgent', description: 'A test agent', systemPrompt: 'Be helpful.' },
      history: [],
      input: 'Hello',
      userId: 'user1',
    };

    const messages = await service.buildMessages(params);
    const systemContent = messages[0]!.content as string;

    expect(systemContent).toContain('<skills>');
    expect(systemContent).toContain('Skills are NOT agents');
    expect(systemContent).toContain('call read_file on its SKILL.md location');
    const skillIndex = systemContent.indexOf('<skills>');
    const promptIndex = systemContent.indexOf('Be helpful.');
    expect(skillIndex).toBeGreaterThan(promptIndex);
  });

  it('omits skill section when no skills available', async () => {
    const mockMemoryRepo = { findVisibleToUser: vi.fn().mockResolvedValue([]) };
    const mockBootstrapService = { loadBootstrapFiles: vi.fn().mockResolvedValue([]) };
    const mockSkillLoader = { buildSkillsSummary: vi.fn().mockResolvedValue('') };

    const service = new ContextBuilderService(
      mockMemoryRepo as any,
      mockBootstrapService as any,
      mockSkillLoader as any,
      { findById: vi.fn().mockResolvedValue({ cronEnabled: false }) } as any,
      { findById: vi.fn().mockResolvedValue({ policyId: 'p-1' }) } as any,
    );

    const params: ContextBuildParams = {
      agentDef: { name: 'TestAgent', description: null, systemPrompt: 'Be helpful.' },
      history: [],
      input: 'Hello',
      userId: 'user1',
    };

    const messages = await service.buildMessages(params);
    const systemContent = messages[0]!.content as string;

    expect(systemContent).not.toContain('<skills>');
    expect(systemContent).not.toContain('Skills are NOT agents');
  });
});
