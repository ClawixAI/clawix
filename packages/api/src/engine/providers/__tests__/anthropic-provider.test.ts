import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockStream = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate, stream: mockStream },
  })),
}));

/**
 * Set up `messages.stream()` to return a MessageStream whose `finalMessage()`
 * resolves to `message`. Mirrors the SDK's streaming helper: the request is
 * sent as SSE and `finalMessage()` resolves once the stream completes.
 */
function streamResolving(message: unknown): void {
  mockStream.mockReturnValueOnce({
    finalMessage: vi.fn().mockResolvedValue(message),
  });
}

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
    mockStream.mockReset();
  });

  it('has name "anthropic"', () => {
    const provider = new AnthropicProvider('test-key');
    expect(provider.name).toBe('anthropic');
  });

  it('uses the streaming API so the request is incremental, not a blocking non-streaming call', async () => {
    streamResolving({
      content: [{ type: 'text', text: 'streamed' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 2 },
    });

    const provider = new AnthropicProvider('test-key');
    const result = await provider.chat([{ role: 'user', content: 'Hi' }]);

    // The blocking `messages.create` path must not be used — it holds the
    // socket with zero bytes until the whole completion lands, which is what
    // makes long turns look hung.
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.content).toBe('streamed');
  });

  it('forwards the abort signal to the streaming request', async () => {
    streamResolving({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const controller = new AbortController();

    const provider = new AnthropicProvider('test-key');
    await provider.chat([{ role: 'user', content: 'Hi' }], { abortSignal: controller.signal });

    const requestOptions = mockStream.mock.calls[0]![1];
    expect(requestOptions?.signal).toBe(controller.signal);
  });

  it('sends a basic chat and returns normalized LLMResponse', async () => {
    streamResolving({
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
    streamResolving({
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
    streamResolving({
      content: [{ type: 'text', text: 'Response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 30, output_tokens: 10 },
    });

    const provider = new AnthropicProvider('test-key');
    await provider.chat([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ]);

    const callArgs = mockStream.mock.calls[0]![0];
    // With caching enabled (default), system is a content-block array
    expect(callArgs.system).toEqual([
      { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
    ]);
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('maps max_tokens stop reason to max_tokens finish reason', async () => {
    streamResolving({
      content: [{ type: 'text', text: 'Truncated...' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 10, output_tokens: 4096 },
    });

    const provider = new AnthropicProvider('test-key');
    const result = await provider.chat([{ role: 'user', content: 'Write a novel' }]);
    expect(result.finishReason).toBe('max_tokens');
  });

  it('surfaces cache token fields from the response', async () => {
    streamResolving({
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
    streamResolving({
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
    mockStream.mockReset();
  });

  it('marks the system block with cache_control by default', async () => {
    streamResolving({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    const provider = new AnthropicProvider('test-key');
    await provider.chat([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ]);

    const args = mockStream.mock.calls[0]![0];
    expect(args.system).toEqual([
      {
        type: 'text',
        text: 'You are helpful.',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('marks the last tool with cache_control by default', async () => {
    streamResolving({
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

    const args = mockStream.mock.calls[0]![0];
    expect(args.tools).toHaveLength(2);
    expect(args.tools[0]).not.toHaveProperty('cache_control');
    expect(args.tools[1]).toMatchObject({
      name: 'tool_b',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('does not mark system or tools when enableCaching=false', async () => {
    streamResolving({
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

    const args = mockStream.mock.calls[0]![0];
    // System is sent as a plain string (no content blocks) when caching is off
    expect(args.system).toBe('You are helpful.');
    expect(args.tools[0]).not.toHaveProperty('cache_control');
  });

  it('does not send cache_control on the user message', async () => {
    streamResolving({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    const provider = new AnthropicProvider('test-key');
    await provider.chat([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Timestamp 123: please respond' },
    ]);

    const args = mockStream.mock.calls[0]![0];
    expect(args.messages[0]).toEqual({ role: 'user', content: 'Timestamp 123: please respond' });
    expect(JSON.stringify(args.messages)).not.toContain('cache_control');
  });

  it('omits system content blocks entirely when there is no system message', async () => {
    streamResolving({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    const provider = new AnthropicProvider('test-key');
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const args = mockStream.mock.calls[0]![0];
    expect(args.system).toBeUndefined();
  });
});
