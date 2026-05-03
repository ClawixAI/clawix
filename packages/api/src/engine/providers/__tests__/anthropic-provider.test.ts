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
    // With caching enabled (default), system is a content-block array
    expect(callArgs.system).toEqual([
      { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
    ]);
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

  it('surfaces cache token fields from the response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'cached response' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 12,
        output_tokens: 8,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 5120,
      },
    });

    const provider = new AnthropicProvider('test-key');
    const result = await provider.chat([{ role: 'user', content: 'Hi' }]);

    expect(result.usage.cacheCreationInputTokens).toBe(0);
    expect(result.usage.cacheReadInputTokens).toBe(5120);
    expect(result.usage.totalTokens).toBe(12 + 8 + 0 + 5120);
  });

  it('omits cache token fields when the SDK does not return them', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'no cache response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const provider = new AnthropicProvider('test-key');
    const result = await provider.chat([{ role: 'user', content: 'Hi' }]);

    expect(result.usage.cacheCreationInputTokens).toBeUndefined();
    expect(result.usage.cacheReadInputTokens).toBeUndefined();
    expect(result.usage.totalTokens).toBe(15);
  });
});

describe('AnthropicProvider — prompt caching', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('marks the system block with cache_control by default', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    const provider = new AnthropicProvider('test-key');
    await provider.chat([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ]);

    const args = mockCreate.mock.calls[0]![0];
    expect(args.system).toEqual([
      {
        type: 'text',
        text: 'You are helpful.',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('marks the last tool with cache_control by default', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    const provider = new AnthropicProvider('test-key');
    await provider.chat([{ role: 'user', content: 'Hi' }], {
      tools: [
        { name: 'tool_a', description: 'A', inputSchema: { type: 'object' } },
        { name: 'tool_b', description: 'B', inputSchema: { type: 'object' } },
      ],
    });

    const args = mockCreate.mock.calls[0]![0];
    expect(args.tools).toHaveLength(2);
    expect(args.tools[0]).not.toHaveProperty('cache_control');
    expect(args.tools[1]).toMatchObject({
      name: 'tool_b',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('does not mark system or tools when enableCaching=false', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    const provider = new AnthropicProvider('test-key', undefined, { enableCaching: false });
    await provider.chat(
      [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ],
      {
        tools: [{ name: 'tool_a', description: 'A', inputSchema: { type: 'object' } }],
      },
    );

    const args = mockCreate.mock.calls[0]![0];
    // System is sent as a plain string (no content blocks) when caching is off
    expect(args.system).toBe('You are helpful.');
    expect(args.tools[0]).not.toHaveProperty('cache_control');
  });

  it('does not send cache_control on the user message', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    const provider = new AnthropicProvider('test-key');
    await provider.chat([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Timestamp 123: please respond' },
    ]);

    const args = mockCreate.mock.calls[0]![0];
    expect(args.messages[0]).toEqual({ role: 'user', content: 'Timestamp 123: please respond' });
    expect(JSON.stringify(args.messages)).not.toContain('cache_control');
  });

  it('omits system content blocks entirely when there is no system message', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    const provider = new AnthropicProvider('test-key');
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const args = mockCreate.mock.calls[0]![0];
    expect(args.system).toBeUndefined();
  });
});
