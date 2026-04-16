import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

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

import { AnthropicProvider } from '../anthropic-provider.js';

describe('AnthropicProvider', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('has name "anthropic"', () => {
    const provider = new AnthropicProvider('test-key');
    expect(provider.name).toBe('anthropic');
  });

  it('sends a basic chat and returns normalized LLMResponse', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Hello!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const provider = new AnthropicProvider('test-key');
    const result = await provider.chat([{ role: 'user', content: 'Hi' }]);

    expect(result.content).toBe('Hello!');
    expect(result.finishReason).toBe('stop');
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.toolCalls).toEqual([]);
  });

  it('maps tool_use stop reason and extracts tool calls', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_123',
          name: 'web_search',
          input: { query: 'test' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 20, output_tokens: 15 },
    });

    const provider = new AnthropicProvider('test-key');
    const result = await provider.chat([{ role: 'user', content: 'Search for test' }], {
      tools: [
        {
          name: 'web_search',
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
    });

    expect(result.finishReason).toBe('tool_use');
    expect(result.toolCalls).toHaveLength(1);
    const firstToolCall = result.toolCalls[0]!;
    expect(firstToolCall.id).toBe('toolu_123');
    expect(firstToolCall.name).toBe('web_search');
    expect(firstToolCall.arguments).toEqual({ query: 'test' });
  });

  it('extracts system message and passes as top-level param', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 30, output_tokens: 10 },
    });

    const provider = new AnthropicProvider('test-key');
    await provider.chat([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ]);

    const callArgs = mockCreate.mock.calls[0]![0];
    expect(callArgs.system).toBe('You are helpful.');
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('maps max_tokens stop reason to max_tokens finish reason', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Truncated...' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 10, output_tokens: 4096 },
    });

    const provider = new AnthropicProvider('test-key');
    const result = await provider.chat([{ role: 'user', content: 'Write a novel' }]);
    expect(result.finishReason).toBe('max_tokens');
  });
});
