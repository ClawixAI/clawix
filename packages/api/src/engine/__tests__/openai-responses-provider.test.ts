import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage } from '@clawix/shared';

// Mock the openai module at the module level
const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    responses = { create: mockCreate };
    constructor() {}
  },
}));

import { OpenAIResponsesProvider } from '../providers/openai-responses-provider.js';

describe('OpenAIResponsesProvider', () => {
  let provider: OpenAIResponsesProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIResponsesProvider('test-key');
  });

  it('has name "openai-responses"', () => {
    expect(provider.name).toBe('openai-responses');
  });

  it('sends a simple chat request and returns text', async () => {
    mockCreate.mockResolvedValue({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Hello!' }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });

    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    const result = await provider.chat(messages, { model: 'gpt-5.1-codex-mini' });

    expect(result.content).toBe('Hello!');
    expect(result.finishReason).toBe('stop');
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.usage.totalTokens).toBe(15);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('handles tool call responses', async () => {
    mockCreate.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          id: 'fc1',
          call_id: 'fc1',
          name: 'read_file',
          arguments: '{"path":"/test.txt"}',
        },
      ],
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
    });

    const messages: ChatMessage[] = [{ role: 'user', content: 'Read the file' }];
    const result = await provider.chat(messages, {
      model: 'gpt-5.1-codex-mini',
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
          },
        },
      ],
    });

    expect(result.finishReason).toBe('tool_use');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.name).toBe('read_file');
    expect(result.toolCalls[0]!.arguments).toEqual({ path: '/test.txt' });
  });

  it('passes instructions from system messages', async () => {
    mockCreate.mockResolvedValue({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Arrr!' }],
        },
      ],
      usage: { input_tokens: 15, output_tokens: 3, total_tokens: 18 },
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a pirate.' },
      { role: 'user', content: 'Hello' },
    ];
    await provider.chat(messages, { model: 'gpt-5.1-codex-mini' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: 'You are a pirate.' }),
    );
  });

  it('uses default model when none specified', async () => {
    mockCreate.mockResolvedValue({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'ok' }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
    });

    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    await provider.chat(messages);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.1-codex-mini' }),
    );
  });

  it('passes temperature setting when provided', async () => {
    mockCreate.mockResolvedValue({
      output: [],
      usage: { input_tokens: 5, output_tokens: 0, total_tokens: 5 },
    });

    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    await provider.chat(messages, {
      model: 'gpt-5.1-codex-mini',
      settings: { temperature: 0.7 },
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.7 }),
    );
  });

  it('handles empty output gracefully', async () => {
    mockCreate.mockResolvedValue({
      output: [],
      usage: { input_tokens: 5, output_tokens: 0, total_tokens: 5 },
    });

    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    const result = await provider.chat(messages);

    expect(result.content).toBeNull();
    expect(result.toolCalls).toHaveLength(0);
    expect(result.finishReason).toBe('stop');
  });

  it('handles missing usage data', async () => {
    mockCreate.mockResolvedValue({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Hi' }],
        },
      ],
      usage: undefined,
    });

    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    const result = await provider.chat(messages);

    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
    expect(result.usage.totalTokens).toBe(0);
  });

  it('throws on API error', async () => {
    mockCreate.mockRejectedValue(new Error('API rate limit'));

    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    await expect(
      provider.chat(messages, { model: 'gpt-5.1-codex-mini' }),
    ).rejects.toThrow('API rate limit');
  });
});
