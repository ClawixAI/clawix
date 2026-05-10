import { describe, it, expect, vi } from 'vitest';
import { ReasoningLoop } from '../reasoning-loop.js';
import type { ToolRegistry } from '../tool-registry.js';
import type { CompressorService } from '../compressor.js';
import type { LLMProvider, LLMResponse } from '@clawix/shared';

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    chat: vi.fn(async () => {
      const response = responses[callIndex++];
      if (!response) throw new Error('No more mock responses');
      return response;
    }),
  } as unknown as LLMProvider;
}

function toolCallResponse(toolName: string, args: Record<string, unknown>): LLMResponse {
  return {
    content: '',
    toolCalls: [{ id: `tc-${toolName}`, name: toolName, arguments: args }],
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    finishReason: 'tool_use',
  };
}

function finalResponse(text: string): LLMResponse {
  return {
    content: text,
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    finishReason: 'stop',
  };
}

const mockRegistry: ToolRegistry = {
  getDefinitions: vi.fn(() => []),
  execute: vi.fn(async () => ({ output: 'file contents here', isError: false })),
} as unknown as ToolRegistry;

const mockCompressor: CompressorService = {
  compress: vi.fn(async (msgs) => msgs),
} as unknown as CompressorService;

describe('ReasoningLoop - post-skill-use injection', () => {
  it('injects system message after reading a custom skill SKILL.md', async () => {
    const stalenessMap = new Map([
      ['/workspace/skills/my-skill/SKILL.md', { name: 'my-skill', stale: false }],
    ]);
    const provider = mockProvider([
      toolCallResponse('read_file', { path: '/workspace/skills/my-skill/SKILL.md' }),
      finalResponse('Done'),
    ]);
    const loop = new ReasoningLoop(provider, mockRegistry, mockCompressor, {
      provider: 'anthropic',
      model: 'claude-sonnet',
    });
    const result = await loop.run([{ role: 'system', content: 'You are helpful.' }], {
      stalenessMap,
    });
    const injection = result.messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        m.content.includes('You just loaded skill "my-skill"'),
    );
    expect(injection).toBeDefined();
    expect(injection!.content).toContain('reflect');
  });

  it('includes staleness hint when skill is stale', async () => {
    const stalenessMap = new Map([
      ['/workspace/skills/old-skill/SKILL.md', { name: 'old-skill', stale: true }],
    ]);
    const provider = mockProvider([
      toolCallResponse('read_file', { path: '/workspace/skills/old-skill/SKILL.md' }),
      finalResponse('Done'),
    ]);
    const loop = new ReasoningLoop(provider, mockRegistry, mockCompressor, {
      provider: 'anthropic',
      model: 'claude-sonnet',
    });
    const result = await loop.run([{ role: 'system', content: 'You are helpful.' }], {
      stalenessMap,
    });
    const injection = result.messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        m.content.includes('You just loaded skill "old-skill"'),
    );
    expect(injection).toBeDefined();
    expect(injection!.content).toContain('not updated');
  });

  it('does not inject for builtin skill reads', async () => {
    const stalenessMap = new Map();
    const provider = mockProvider([
      toolCallResponse('read_file', { path: '/skills/builtin/skill-creator/SKILL.md' }),
      finalResponse('Done'),
    ]);
    const loop = new ReasoningLoop(provider, mockRegistry, mockCompressor, {
      provider: 'anthropic',
      model: 'claude-sonnet',
    });
    const result = await loop.run([{ role: 'system', content: 'You are helpful.' }], {
      stalenessMap,
    });
    const injection = result.messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        m.content.includes('You just loaded skill'),
    );
    expect(injection).toBeUndefined();
  });

  it('injects only once per skill even if read twice', async () => {
    const stalenessMap = new Map([
      ['/workspace/skills/my-skill/SKILL.md', { name: 'my-skill', stale: false }],
    ]);
    const provider = mockProvider([
      toolCallResponse('read_file', { path: '/workspace/skills/my-skill/SKILL.md' }),
      toolCallResponse('read_file', { path: '/workspace/skills/my-skill/SKILL.md' }),
      finalResponse('Done'),
    ]);
    const loop = new ReasoningLoop(provider, mockRegistry, mockCompressor, {
      provider: 'anthropic',
      model: 'claude-sonnet',
    });
    const result = await loop.run([{ role: 'system', content: 'You are helpful.' }], {
      stalenessMap,
    });
    const injections = result.messages.filter(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        m.content.includes('You just loaded skill "my-skill"'),
    );
    expect(injections.length).toBe(1);
  });

  it('does not inject when stalenessMap is not provided', async () => {
    const provider = mockProvider([
      toolCallResponse('read_file', { path: '/workspace/skills/my-skill/SKILL.md' }),
      finalResponse('Done'),
    ]);
    const loop = new ReasoningLoop(provider, mockRegistry, mockCompressor, {
      provider: 'anthropic',
      model: 'claude-sonnet',
    });
    const result = await loop.run([{ role: 'system', content: 'You are helpful.' }]);
    const injection = result.messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        m.content.includes('You just loaded skill'),
    );
    expect(injection).toBeUndefined();
  });
});
