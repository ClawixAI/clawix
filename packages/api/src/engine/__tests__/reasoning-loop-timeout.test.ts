import { describe, it, expect, vi } from 'vitest';
import type { ChatMessage, LLMProvider, LLMResponse } from '@clawix/shared';

import { ReasoningLoop } from '../reasoning-loop.js';
import { ToolRegistry } from '../tool-registry.js';
import type { Tool, ToolResult } from '../tool.js';

function createSlowProvider(delayMs: number): LLMProvider {
  return {
    name: 'test',
    chat: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      return {
        content: 'done',
        toolCalls: [],
        thinkingBlocks: null,
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        finishReason: 'stop',
      } as LLMResponse;
    }),
  };
}

/** Create a provider that always returns tool calls (to force multi-iteration). */
function createSlowToolCallProvider(delayMs: number): LLMProvider {
  return {
    name: 'test-tool',
    chat: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      return {
        content: null,
        toolCalls: [{ id: `tc-${Date.now()}`, name: 'slow_tool', arguments: { q: 'x' } }],
        thinkingBlocks: null,
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        finishReason: 'tool_use',
      } as LLMResponse;
    }),
  };
}

function makeMockTool(name: string, output: string): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    execute: vi.fn(async (): Promise<ToolResult> => ({ output, isError: false })),
  };
}

describe('ReasoningLoop timeout', () => {
  it('aborts when wall-clock timeout is exceeded', async () => {
    // Provider takes 200ms per call; timeout fires at 50ms.
    // The first chat() call completes at ~200ms, then the abort check at the
    // start of iteration 2 sees the signal and breaks.
    const provider = createSlowProvider(200);
    const registry = new ToolRegistry();
    const loop = new ReasoningLoop(provider, registry);
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

    const result = await loop.run(messages, {
      timeoutMs: 50,
    });

    expect(result.hitTimeout).toBe(true);
  });

  it('completes normally when within timeout', async () => {
    const provider = createSlowProvider(10);
    const registry = new ToolRegistry();
    const loop = new ReasoningLoop(provider, registry);
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

    const result = await loop.run(messages, { timeoutMs: 5000 });

    expect(result.hitTimeout).toBe(false);
    expect(result.content).toBe('done');
  });

  it('returns hitTimeout false when no timeout configured', async () => {
    const provider = createSlowProvider(10);
    const registry = new ToolRegistry();
    const loop = new ReasoningLoop(provider, registry);
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

    const result = await loop.run(messages);

    expect(result.hitTimeout).toBe(false);
  });

  it('aborts immediately when external signal is already aborted', async () => {
    const provider = createSlowProvider(10);
    const registry = new ToolRegistry();
    const loop = new ReasoningLoop(provider, registry);
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

    const controller = new AbortController();
    controller.abort();

    const result = await loop.run(messages, { abortSignal: controller.signal });

    expect(result.hitTimeout).toBe(true);
    expect(result.iterations).toBe(0);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it('stops iterating when timeout fires between tool-call iterations', async () => {
    // Provider always returns tool calls (would loop forever without timeout).
    // Each call takes 200ms; timeout fires at 50ms.
    // Iteration 1: chat starts at 0ms, timeout fires at 50ms, chat completes at 200ms,
    // tool executes, loop goes back, abort check at start of iteration 2 breaks.
    const provider = createSlowToolCallProvider(200);
    const tool = makeMockTool('slow_tool', 'result');
    const registry = new ToolRegistry();
    registry.register(tool);
    const loop = new ReasoningLoop(provider, registry);
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

    const result = await loop.run(messages, { timeoutMs: 50 });

    expect(result.hitTimeout).toBe(true);
    // Timeout fires during iteration 1; abort caught before iteration 2 runs chat
    expect(result.iterations).toBeLessThanOrEqual(2);
    // Without timeout, provider would be called maxIterations (40) times
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  it('aborts when external signal fires during execution', async () => {
    const provider = createSlowProvider(200);
    const registry = new ToolRegistry();
    const loop = new ReasoningLoop(provider, registry);
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 50);

    const result = await loop.run(messages, { abortSignal: controller.signal });

    expect(result.hitTimeout).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(1);
  });
});
