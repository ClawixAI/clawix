import { describe, expect, it } from 'vitest';
import type { ChatMessage, ToolDefinition } from '@clawix/shared';
import {
  isCodexModel,
  toResponsesTool,
  toResponsesInput,
  parseResponsesOutput,
} from '../providers/openai-responses-utils.js';

/* ------------------------------------------------------------------ */
/*  isCodexModel                                                       */
/* ------------------------------------------------------------------ */

describe('isCodexModel', () => {
  it.each([
    'gpt-5.1-codex-mini',
    'gpt-5-codex',
    'codex-mini',
  ])('returns true for codex model: %s', (model) => {
    expect(isCodexModel(model)).toBe(true);
  });

  it.each([
    'gpt-5',
    'gpt-5.1',
    'gpt-5.4',
  ])('returns true for gpt-5.x model: %s', (model) => {
    expect(isCodexModel(model)).toBe(true);
  });

  it.each([
    'gpt-4.1',
    'gpt-4o',
    'gpt-4o-mini',
    'o3-mini',
    'o4-mini',
    'claude-3-opus',
  ])('returns false for non-codex model: %s', (model) => {
    expect(isCodexModel(model)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  toResponsesTool                                                    */
/* ------------------------------------------------------------------ */

describe('toResponsesTool', () => {
  it('converts a ToolDefinition to Responses API format', () => {
    const tool: ToolDefinition = {
      name: 'get_weather',
      description: 'Get the current weather for a location',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string' },
        },
        required: ['location'],
      },
    };

    expect(toResponsesTool(tool)).toEqual({
      type: 'function',
      name: 'get_weather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' },
        },
        required: ['location'],
      },
    });
  });
});

/* ------------------------------------------------------------------ */
/*  toResponsesInput                                                   */
/* ------------------------------------------------------------------ */

describe('toResponsesInput', () => {
  it('returns a plain string input for a single user message', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello!' },
    ];

    const result = toResponsesInput(messages);

    expect(result).toEqual({
      instructions: undefined,
      input: 'Hello!',
    });
  });

  it('extracts system messages as instructions', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hi' },
    ];

    const result = toResponsesInput(messages);

    expect(result.instructions).toBe('You are helpful.\n\nBe concise.');
    expect(result.input).toBe('Hi');
  });

  it('converts a multi-turn conversation with tool calls', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'What is the weather?' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'get_weather', arguments: { location: 'NYC' } },
        ],
      },
      { role: 'tool', content: '72F sunny', toolCallId: 'call_1' },
      { role: 'assistant', content: 'It is 72F and sunny in NYC.' },
    ];

    const result = toResponsesInput(messages);

    expect(result.instructions).toBe('System prompt');
    expect(Array.isArray(result.input)).toBe(true);

    const items = result.input as readonly Record<string, unknown>[];
    expect(items).toHaveLength(4);

    expect(items[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'What is the weather?' }],
    });

    expect(items[1]).toEqual({
      type: 'function_call',
      id: 'fc_call_1',
      call_id: 'fc_call_1',
      name: 'get_weather',
      arguments: '{"location":"NYC"}',
    });

    expect(items[2]).toEqual({
      type: 'function_call_output',
      call_id: 'fc_call_1',
      output: '72F sunny',
    });

    expect(items[3]).toEqual({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'It is 72F and sunny in NYC.' }],
    });
  });

  it('returns input array for multiple user messages without system', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Reply' },
      { role: 'user', content: 'Second' },
    ];

    const result = toResponsesInput(messages);

    expect(result.instructions).toBeUndefined();
    expect(Array.isArray(result.input)).toBe(true);
    expect(result.input).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ */
/*  parseResponsesOutput                                               */
/* ------------------------------------------------------------------ */

describe('parseResponsesOutput', () => {
  it('parses text output', () => {
    const output = [
      {
        type: 'message',
        content: [
          { type: 'output_text', text: 'Hello, ' },
          { type: 'output_text', text: 'world!' },
        ],
      },
    ];

    const result = parseResponsesOutput(output);

    expect(result.content).toBe('Hello, world!');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.finishReason).toBe('stop');
  });

  it('parses function call output', () => {
    const output = [
      {
        type: 'function_call',
        call_id: 'call_abc',
        name: 'get_weather',
        arguments: '{"location":"London"}',
      },
    ];

    const result = parseResponsesOutput(output);

    expect(result.content).toBeNull();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      id: 'call_abc',
      name: 'get_weather',
      arguments: { location: 'London' },
    });
    expect(result.finishReason).toBe('tool_use');
  });

  it('parses mixed output with text and function calls', () => {
    const output = [
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'Let me check.' }],
      },
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_xyz',
        name: 'search',
        arguments: '{"query":"test"}',
      },
    ];

    const result = parseResponsesOutput(output);

    expect(result.content).toBe('Let me check.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.id).toBe('call_xyz');
    expect(result.finishReason).toBe('tool_use');
  });

  it('falls back to id when call_id is missing', () => {
    const output = [
      {
        type: 'function_call',
        id: 'fallback_id',
        name: 'do_thing',
        arguments: '{}',
      },
    ];

    const result = parseResponsesOutput(output);

    expect(result.toolCalls[0]!.id).toBe('fallback_id');
  });

  it('skips function calls with invalid JSON arguments', () => {
    const output = [
      {
        type: 'function_call',
        call_id: 'call_bad',
        name: 'broken_tool',
        arguments: '{invalid json',
      },
    ];

    const result = parseResponsesOutput(output);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.finishReason).toBe('stop');
  });

  it('returns null content for empty output', () => {
    const result = parseResponsesOutput([]);

    expect(result.content).toBeNull();
    expect(result.toolCalls).toHaveLength(0);
    expect(result.finishReason).toBe('stop');
  });
});
