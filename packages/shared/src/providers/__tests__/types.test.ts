import { describe, expect, it } from 'vitest';

import {
  createLLMResponse,
  isToolCallRequest,
  type FinishReason,
  type GenerationSettings,
  type LLMResponse,
  type LLMUsage,
  type ThinkingBlock,
  type ToolCallRequest,
} from '../types.js';

describe('isToolCallRequest', () => {
  it('should return true for a valid ToolCallRequest', () => {
    const valid: ToolCallRequest = {
      id: 'call_123',
      name: 'get_weather',
      arguments: { city: 'London' },
    };

    expect(isToolCallRequest(valid)).toBe(true);
  });

  it('should return true for a ToolCallRequest with empty arguments', () => {
    const valid: ToolCallRequest = {
      id: 'call_456',
      name: 'list_all',
      arguments: {},
    };

    expect(isToolCallRequest(valid)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isToolCallRequest(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isToolCallRequest(undefined)).toBe(false);
  });

  it('should return false for a string', () => {
    expect(isToolCallRequest('not a tool call')).toBe(false);
  });

  it('should return false for a number', () => {
    expect(isToolCallRequest(42)).toBe(false);
  });

  it('should return false when id is missing', () => {
    expect(isToolCallRequest({ name: 'foo', arguments: {} })).toBe(false);
  });

  it('should return false when name is missing', () => {
    expect(isToolCallRequest({ id: '1', arguments: {} })).toBe(false);
  });

  it('should return false when arguments is missing', () => {
    expect(isToolCallRequest({ id: '1', name: 'foo' })).toBe(false);
  });

  it('should return false when id is not a string', () => {
    expect(isToolCallRequest({ id: 123, name: 'foo', arguments: {} })).toBe(false);
  });

  it('should return false when name is not a string', () => {
    expect(isToolCallRequest({ id: '1', name: 123, arguments: {} })).toBe(false);
  });

  it('should return false when arguments is not an object', () => {
    expect(isToolCallRequest({ id: '1', name: 'foo', arguments: 'bar' })).toBe(false);
  });

  it('should return false when arguments is an array', () => {
    expect(isToolCallRequest({ id: '1', name: 'foo', arguments: [1, 2] })).toBe(false);
  });

  it('should return true for a ToolCallRequest with providerExtra', () => {
    const valid: ToolCallRequest = {
      id: 'call_789',
      name: 'search',
      arguments: { q: 'test' },
      providerExtra: { google: { thoughtSignature: 'sig-abc-123' } },
    };

    expect(isToolCallRequest(valid)).toBe(true);
  });

  it('should accept arbitrary providerExtra payload shapes', () => {
    const valid: ToolCallRequest = {
      id: 'call_999',
      name: 'noop',
      arguments: {},
      providerExtra: { anything: 'goes', nested: { deeply: true } },
    };

    expect(isToolCallRequest(valid)).toBe(true);
  });
});

describe('createLLMResponse', () => {
  it('should create a response with all defaults', () => {
    const response = createLLMResponse({});

    expect(response).toEqual({
      content: null,
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      thinkingBlocks: null,
    });
  });

  it('should create a response with content', () => {
    const response = createLLMResponse({ content: 'Hello world' });

    expect(response.content).toBe('Hello world');
    expect(response.finishReason).toBe('stop');
  });

  it('should create a response with tool calls', () => {
    const toolCalls: readonly ToolCallRequest[] = [
      { id: 'call_1', name: 'search', arguments: { query: 'test' } },
    ];

    const response = createLLMResponse({
      toolCalls,
      finishReason: 'tool_use',
    });

    expect(response.toolCalls).toEqual(toolCalls);
    expect(response.finishReason).toBe('tool_use');
    expect(response.content).toBeNull();
  });

  it('should create a response with thinking blocks', () => {
    const thinkingBlocks: readonly ThinkingBlock[] = [
      { type: 'thinking', thinking: 'Let me consider this...' },
      { type: 'thinking', thinking: 'The answer is 42.' },
    ];

    const response = createLLMResponse({
      content: 'The answer is 42.',
      thinkingBlocks,
    });

    expect(response.thinkingBlocks).toEqual(thinkingBlocks);
    expect(response.content).toBe('The answer is 42.');
  });

  it('should create a response with custom usage', () => {
    const usage: LLMUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    };

    const response = createLLMResponse({ usage });

    expect(response.usage).toEqual(usage);
  });

  it('should create a response with max_tokens finish reason', () => {
    const response = createLLMResponse({
      content: 'Truncated...',
      finishReason: 'max_tokens',
    });

    expect(response.finishReason).toBe('max_tokens');
  });

  it('should create a response with error finish reason', () => {
    const response = createLLMResponse({ finishReason: 'error' });

    expect(response.finishReason).toBe('error');
  });

  it('should return an immutable toolCalls array by default', () => {
    const response = createLLMResponse({});

    // readonly arrays cannot be mutated at runtime if frozen
    expect(Object.isFrozen(response.toolCalls)).toBe(true);
  });

  it('should preserve optional cache token fields when provided', () => {
    const usage: LLMUsage = {
      inputTokens: 50,
      outputTokens: 25,
      totalTokens: 5195,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 5120,
    };

    const response = createLLMResponse({ usage });

    expect(response.usage.cacheCreationInputTokens).toBe(0);
    expect(response.usage.cacheReadInputTokens).toBe(5120);
  });

  it('should default cache token fields to undefined when omitted', () => {
    const response = createLLMResponse({});

    expect(response.usage.cacheCreationInputTokens).toBeUndefined();
    expect(response.usage.cacheReadInputTokens).toBeUndefined();
  });
});

// Type-level tests: ensure the types compile correctly
describe('type definitions', () => {
  it('should allow all valid FinishReason values', () => {
    const reasons: FinishReason[] = ['stop', 'tool_use', 'max_tokens', 'error'];

    expect(reasons).toHaveLength(4);
  });

  it('should enforce readonly on LLMResponse', () => {
    const response: LLMResponse = createLLMResponse({ content: 'test' });

    // This verifies the type compiles with readonly
    expect(response.content).toBe('test');
  });

  it('should allow GenerationSettings with optional fields', () => {
    const empty: GenerationSettings = {};
    const partial: GenerationSettings = { temperature: 0.7, maxTokens: 1000 };
    const full: GenerationSettings = {
      temperature: 0.5,
      maxTokens: 4096,
      topP: 0.9,
      stopSequences: ['END'],
    };

    expect(empty).toBeDefined();
    expect(partial).toBeDefined();
    expect(full).toBeDefined();
  });
});
