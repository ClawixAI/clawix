import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChatMessage, ToolDefinition } from '@clawix/shared';

// Mock the openai module before importing the provider
const mockCreate = vi.fn();
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

// Mock the logger
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

import { OpenAIProvider } from '../openai-provider.js';

/** Extract the first call's first argument from the mock, with a safe assertion. */
function getCallArgs(): Record<string, unknown> {
  const args = mockCreate.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
  if (!args) {
    throw new Error('Expected mockCreate to have been called');
  }
  return args;
}

function stubSimpleResponse(overrides: Record<string, unknown> = {}): void {
  mockCreate.mockResolvedValueOnce({
    choices: [
      {
        message: { role: 'assistant', content: 'OK', tool_calls: undefined },
        finish_reason: 'stop',
        ...overrides,
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  });
}

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider('test-api-key');
  });

  it('has name "openai"', () => {
    expect(provider.name).toBe('openai');
  });

  describe('chat', () => {
    it('sends messages and returns normalized LLMResponse', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello, world!',
              tool_calls: undefined,
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      });

      const messages: readonly ChatMessage[] = [{ role: 'user', content: 'Hi' }];

      const result = await provider.chat(messages);

      expect(result.content).toBe('Hello, world!');
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
      expect(result.toolCalls).toEqual([]);
      expect(result.thinkingBlocks).toBeNull();
    });

    it('passes system messages with role "system"', async () => {
      stubSimpleResponse();

      const messages: readonly ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ];

      await provider.chat(messages);

      const callArgs = getCallArgs();
      const msgs = callArgs['messages'] as unknown[];
      expect(msgs[0]).toEqual({
        role: 'system',
        content: 'You are helpful.',
      });
    });

    it('normalizes tool call responses', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"London"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      });

      const messages: readonly ChatMessage[] = [
        { role: 'user', content: 'What is the weather in London?' },
      ];

      const result = await provider.chat(messages);

      expect(result.content).toBeNull();
      expect(result.finishReason).toBe('tool_use');
      expect(result.toolCalls).toEqual([
        {
          id: 'call_abc123',
          name: 'get_weather',
          arguments: { location: 'London' },
        },
      ]);
    });

    it('maps finish reason "length" to "max_tokens"', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: 'assistant', content: 'Truncated...', tool_calls: undefined },
            finish_reason: 'length',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 4096, total_tokens: 4106 },
      });

      const result = await provider.chat([{ role: 'user', content: 'Long story' }]);

      expect(result.finishReason).toBe('max_tokens');
    });

    it('maps "content_filter" finish reason to "error"', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: 'assistant', content: 'Filtered', tool_calls: undefined },
            finish_reason: 'content_filter',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.finishReason).toBe('error');
    });

    it('maps truly unknown finish reasons to "stop"', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: { role: 'assistant', content: 'Done', tool_calls: undefined },
            finish_reason: 'some_future_reason',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.finishReason).toBe('stop');
    });

    it('converts tool definitions to OpenAI format', async () => {
      stubSimpleResponse();

      const tools: readonly ToolDefinition[] = [
        {
          name: 'search',
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ];

      await provider.chat([{ role: 'user', content: 'Search for cats' }], { tools });

      const callArgs = getCallArgs();
      expect(callArgs['tools']).toEqual([
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'Search the web',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        },
      ]);
    });

    it('converts assistant messages with toolCalls to OpenAI format', async () => {
      stubSimpleResponse();

      const messages: readonly ChatMessage[] = [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: { city: 'NYC' } }],
        },
        { role: 'tool', content: '{"temp": 72}', toolCallId: 'call_1' },
      ];

      await provider.chat(messages);

      const callArgs = getCallArgs();
      const msgs = callArgs['messages'] as unknown[];
      expect(msgs[1]).toEqual({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city":"NYC"}',
            },
          },
        ],
      });
      expect(msgs[2]).toEqual({
        role: 'tool',
        tool_call_id: 'call_1',
        content: '{"temp": 72}',
      });
    });

    it('uses default model and max_tokens', async () => {
      stubSimpleResponse();

      await provider.chat([{ role: 'user', content: 'Hi' }]);

      const callArgs = getCallArgs();
      expect(callArgs['model']).toBe('gpt-4o');
      expect(callArgs['max_tokens']).toBe(4096);
    });

    it('accepts custom model and settings via options', async () => {
      stubSimpleResponse();

      await provider.chat([{ role: 'user', content: 'Hi' }], {
        model: 'gpt-4o-mini',
        settings: { temperature: 0.5, maxTokens: 2048, topP: 0.9 },
      });

      const callArgs = getCallArgs();
      expect(callArgs['model']).toBe('gpt-4o-mini');
      expect(callArgs['max_tokens']).toBe(2048);
      expect(callArgs['temperature']).toBe(0.5);
      expect(callArgs['top_p']).toBe(0.9);
    });

    it('uses max_completion_tokens for o-series reasoning models', async () => {
      stubSimpleResponse();

      await provider.chat([{ role: 'user', content: 'Hi' }], {
        model: 'o3-mini',
        settings: { maxTokens: 8192 },
      });

      const callArgs = getCallArgs();
      expect(callArgs['model']).toBe('o3-mini');
      expect(callArgs['max_completion_tokens']).toBe(8192);
      expect(callArgs['max_tokens']).toBeUndefined();
    });

    it('accepts custom baseURL in constructor', () => {
      const custom = new OpenAIProvider('key', 'https://custom.api.com/v1');
      expect(custom.name).toBe('openai');
    });

    it('skips tool calls with malformed JSON arguments', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_good',
                  type: 'function',
                  function: { name: 'valid_tool', arguments: '{"key":"value"}' },
                },
                {
                  id: 'call_bad',
                  type: 'function',
                  function: { name: 'broken_tool', arguments: '{not valid json' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const result = await provider.chat([{ role: 'user', content: 'Test' }]);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        id: 'call_good',
        name: 'valid_tool',
        arguments: { key: 'value' },
      });
    });

    it('forwards toolChoice "auto" to OpenAI', async () => {
      stubSimpleResponse();

      await provider.chat([{ role: 'user', content: 'Hi' }], { toolChoice: 'auto' });

      const callArgs = getCallArgs();
      expect(callArgs['tool_choice']).toBe('auto');
    });

    it('forwards toolChoice "none" to OpenAI', async () => {
      stubSimpleResponse();

      await provider.chat([{ role: 'user', content: 'Hi' }], { toolChoice: 'none' });

      const callArgs = getCallArgs();
      expect(callArgs['tool_choice']).toBe('none');
    });

    it('forwards toolChoice with name as function object', async () => {
      stubSimpleResponse();

      await provider.chat([{ role: 'user', content: 'Hi' }], {
        toolChoice: { name: 'get_weather' },
      });

      const callArgs = getCallArgs();
      expect(callArgs['tool_choice']).toEqual({
        type: 'function',
        function: { name: 'get_weather' },
      });
    });

    it('does not include tool_choice when toolChoice is undefined', async () => {
      stubSimpleResponse();

      await provider.chat([{ role: 'user', content: 'Hi' }]);

      const callArgs = getCallArgs();
      expect(callArgs).not.toHaveProperty('tool_choice');
    });
  });
});
