import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, LLMProvider, LLMResponse, LLMUsage } from '@clawix/shared';
import { createLLMResponse } from '@clawix/shared';

import { ReasoningLoop } from '../reasoning-loop.js';
import { BudgetTracker } from '../budget-tracker.js';
import { ToolRegistry } from '../tool-registry.js';
import type { Tool, ToolResult } from '../tool.js';

/* ------------------------------------------------------------------ */
/*  Mock helpers                                                       */
/* ------------------------------------------------------------------ */

/** Create an LLMProvider that returns responses in sequence. */
function makeMockProvider(responses: readonly LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    name: 'mock-provider',
    chat: vi.fn(async () => {
      if (callIndex >= responses.length) {
        throw new Error('No more mock responses');
      }
      const response = responses[callIndex]!;
      callIndex += 1;
      return response;
    }),
  };
}

/** Create a Tool with mocked execute. */
function makeMockTool(name: string, output: string): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    execute: vi.fn(
      async (): Promise<ToolResult> => ({
        output,
        isError: false,
      }),
    ),
  };
}

/** Helper to create a usage object. */
function makeUsage(input: number, output: number): LLMUsage {
  return { inputTokens: input, outputTokens: output, totalTokens: input + output };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ReasoningLoop', () => {
  it('single-turn (no tool calls): returns model response, 1 iteration', async () => {
    const response = createLLMResponse({
      content: 'Hello!',
      finishReason: 'stop',
      usage: makeUsage(10, 5),
    });
    const provider = makeMockProvider([response]);
    const registry = new ToolRegistry();
    const loop = new ReasoningLoop(provider, registry);

    const result = await loop.run([{ role: 'user', content: 'Hi' }]);

    expect(result.content).toBe('Hello!');
    expect(result.iterations).toBe(1);
    expect(result.hitMaxIterations).toBe(false);
    expect(result.totalUsage).toEqual(makeUsage(10, 5));
    expect(provider.chat).toHaveBeenCalledOnce();
  });

  it('multi-turn with tools: executes tool, feeds result back, gets final answer', async () => {
    const toolCallResponse = createLLMResponse({
      content: null,
      finishReason: 'tool_use',
      toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'test' } }],
      usage: makeUsage(10, 8),
    });
    const finalResponse = createLLMResponse({
      content: 'Found the answer.',
      finishReason: 'stop',
      usage: makeUsage(20, 12),
    });
    const provider = makeMockProvider([toolCallResponse, finalResponse]);

    const searchTool = makeMockTool('search', 'result data');
    const registry = new ToolRegistry();
    registry.register(searchTool);

    const loop = new ReasoningLoop(provider, registry);
    const result = await loop.run([{ role: 'user', content: 'Find info' }]);

    expect(result.content).toBe('Found the answer.');
    expect(result.iterations).toBe(2);
    expect(result.totalUsage).toEqual(makeUsage(30, 20));
    expect(searchTool.execute).toHaveBeenCalledWith({ query: 'test' });
    expect(result.hitMaxIterations).toBe(false);
  });

  it('multiple tool calls in one response: both tools execute', async () => {
    const toolCallResponse = createLLMResponse({
      content: null,
      finishReason: 'tool_use',
      toolCalls: [
        { id: 'tc1', name: 'search', arguments: { query: 'a' } },
        { id: 'tc2', name: 'read', arguments: { query: 'b' } },
      ],
      usage: makeUsage(10, 10),
    });
    const finalResponse = createLLMResponse({
      content: 'Done.',
      finishReason: 'stop',
      usage: makeUsage(15, 5),
    });
    const provider = makeMockProvider([toolCallResponse, finalResponse]);

    const searchTool = makeMockTool('search', 'search result');
    const readTool = makeMockTool('read', 'read result');
    const registry = new ToolRegistry();
    registry.register(searchTool);
    registry.register(readTool);

    const loop = new ReasoningLoop(provider, registry);
    const result = await loop.run([{ role: 'user', content: 'Do stuff' }]);

    expect(result.content).toBe('Done.');
    expect(result.iterations).toBe(2);
    expect(searchTool.execute).toHaveBeenCalledOnce();
    expect(readTool.execute).toHaveBeenCalledOnce();
    // Two tool result messages should be in the messages array
    const toolMessages = result.messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
  });

  it('max iterations: hits limit, hitMaxIterations=true', async () => {
    // Always returns tool calls — never stops
    const toolCallResponse = createLLMResponse({
      content: null,
      finishReason: 'tool_use',
      toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'loop' } }],
      usage: makeUsage(5, 5),
    });
    // Provide enough responses for maxIterations
    const maxIter = 3;
    const responses = Array.from({ length: maxIter }, () => toolCallResponse);
    const provider = makeMockProvider(responses);

    const searchTool = makeMockTool('search', 'still going');
    const registry = new ToolRegistry();
    registry.register(searchTool);

    const loop = new ReasoningLoop(provider, registry);
    const result = await loop.run([{ role: 'user', content: 'Loop forever' }], {
      maxIterations: maxIter,
    });

    expect(result.iterations).toBe(maxIter);
    expect(result.hitMaxIterations).toBe(true);
    expect(result.totalUsage).toEqual(makeUsage(15, 15));
  });

  it('error finish reason: stops immediately, returns content', async () => {
    const errorResponse = createLLMResponse({
      content: 'Something went wrong',
      finishReason: 'error',
      usage: makeUsage(5, 2),
    });
    const provider = makeMockProvider([errorResponse]);
    const registry = new ToolRegistry();
    const loop = new ReasoningLoop(provider, registry);

    const result = await loop.run([{ role: 'user', content: 'test' }]);

    expect(result.content).toBe('Something went wrong');
    expect(result.iterations).toBe(1);
    expect(result.hitMaxIterations).toBe(false);
  });

  it('provider error: rejects/throws the error', async () => {
    const provider: LLMProvider = {
      name: 'failing-provider',
      chat: vi.fn(async () => {
        throw new Error('API failure');
      }),
    };
    const registry = new ToolRegistry();
    const loop = new ReasoningLoop(provider, registry);

    await expect(loop.run([{ role: 'user', content: 'test' }])).rejects.toThrow('API failure');
  });

  it('progress callback: onProgress called with hint containing tool name', async () => {
    const toolCallResponse = createLLMResponse({
      content: null,
      finishReason: 'tool_use',
      toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'test query' } }],
      usage: makeUsage(5, 5),
    });
    const finalResponse = createLLMResponse({
      content: 'Done.',
      finishReason: 'stop',
      usage: makeUsage(5, 5),
    });
    const provider = makeMockProvider([toolCallResponse, finalResponse]);

    const searchTool = makeMockTool('search', 'data');
    const registry = new ToolRegistry();
    registry.register(searchTool);

    const onProgress = vi.fn();
    const loop = new ReasoningLoop(provider, registry);
    await loop.run([{ role: 'user', content: 'test' }], { onProgress });

    expect(onProgress).toHaveBeenCalledOnce();
    const hint = onProgress.mock.calls[0]![0] as string;
    expect(hint).toContain('search');
  });

  describe('token budget', () => {
    it('completes normally when no tracker is set', async () => {
      const response = createLLMResponse({
        content: 'Hello!',
        finishReason: 'stop',
        usage: makeUsage(100, 50),
      });
      const provider = makeMockProvider([response]);
      const registry = new ToolRegistry();
      const loop = new ReasoningLoop(provider, registry);

      const result = await loop.run([{ role: 'user', content: 'Hi' }]);

      expect(result.hitTokenBudget).toBe(false);
      expect(result.content).toBe('Hello!');
    });

    it('completes normally when under budget', async () => {
      const response = createLLMResponse({
        content: 'Hello!',
        finishReason: 'stop',
        usage: makeUsage(40, 40),
      });
      const provider = makeMockProvider([response]);
      const registry = new ToolRegistry();
      const loop = new ReasoningLoop(provider, registry);

      const tracker = new BudgetTracker(100, 10);
      const result = await loop.run([{ role: 'user', content: 'Hi' }], {
        budgetTracker: tracker,
      });

      expect(result.hitTokenBudget).toBe(false);
      expect(result.content).toBe('Hello!');
      expect(tracker.used).toBe(80);
    });

    it('injects grace message when at budget and allows one more turn', async () => {
      // First response: uses exactly the budget
      const firstResponse = createLLMResponse({
        content: null,
        finishReason: 'tool_use',
        toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'test' } }],
        usage: makeUsage(50, 50), // 100 total = hits tokenBudget of 100
      });
      // Second response: final answer (the grace turn — must be a 'stop'
      // because the loop forces tools=[] for it)
      const secondResponse = createLLMResponse({
        content: 'Summarized findings.',
        finishReason: 'stop',
        usage: makeUsage(5, 5), // 110 total — under 110% grace limit
      });
      const provider = makeMockProvider([firstResponse, secondResponse]);

      const searchTool = makeMockTool('search', 'result');
      const registry = new ToolRegistry();
      registry.register(searchTool);

      const loop = new ReasoningLoop(provider, registry);
      const result = await loop.run([{ role: 'user', content: 'test' }], {
        budgetTracker: new BudgetTracker(100, 10),
      });

      expect(result.hitTokenBudget).toBe(false);
      expect(result.content).toBe('Summarized findings.');
      // Grace message should be in messages
      const systemMessages = result.messages.filter((m) => m.role === 'system');
      expect(systemMessages).toHaveLength(1);
      expect(systemMessages[0]!.content).toContain('token limit');
    });

    it('grace turn forces tools=[] and a maxTokens cap on the next call', async () => {
      const firstResponse = createLLMResponse({
        content: null,
        finishReason: 'tool_use',
        toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'test' } }],
        usage: makeUsage(50, 50), // hits budget of 100
      });
      const secondResponse = createLLMResponse({
        content: 'Done.',
        finishReason: 'stop',
        usage: makeUsage(2, 2),
      });
      const provider = makeMockProvider([firstResponse, secondResponse]);

      const searchTool = makeMockTool('search', 'result');
      const registry = new ToolRegistry();
      registry.register(searchTool);

      const loop = new ReasoningLoop(provider, registry);
      await loop.run([{ role: 'user', content: 'test' }], {
        budgetTracker: new BudgetTracker(100, 10),
      });

      // Two calls: first with full tools, second is the grace turn —
      // tools must be empty and maxTokens must be set.
      const calls = (provider.chat as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      const firstCallOpts = calls[0]![1] as { tools?: readonly unknown[] };
      const secondCallOpts = calls[1]![1] as {
        tools?: readonly unknown[];
        settings?: { maxTokens?: number };
      };
      expect(firstCallOpts.tools?.length).toBeGreaterThan(0);
      expect(secondCallOpts.tools).toEqual([]);
      expect(secondCallOpts.settings?.maxTokens).toBeGreaterThan(0);
    });

    it('hard stops when over grace limit', async () => {
      // First response: tool calls, uses 50 tokens
      const firstResponse = createLLMResponse({
        content: null,
        finishReason: 'tool_use',
        toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'test' } }],
        usage: makeUsage(25, 25), // 50 total — under budget of 100
      });
      // Second response: exceeds grace limit (100 * 1.10 = 110)
      const secondResponse = createLLMResponse({
        content: 'Still going.',
        finishReason: 'tool_use',
        toolCalls: [{ id: 'tc2', name: 'search', arguments: { query: 'more' } }],
        usage: makeUsage(40, 30), // adds 70 → total 120 >= 110 grace limit
      });
      const provider = makeMockProvider([firstResponse, secondResponse]);

      const searchTool = makeMockTool('search', 'result');
      const registry = new ToolRegistry();
      registry.register(searchTool);

      const loop = new ReasoningLoop(provider, registry);
      const result = await loop.run([{ role: 'user', content: 'test' }], {
        budgetTracker: new BudgetTracker(100, 10),
      });

      expect(result.hitTokenBudget).toBe(true);
      expect(result.iterations).toBe(2);
    });

    it('uses configured grace percent', async () => {
      // Budget = 100, grace percent = 10 → grace limit 110
      const firstResponse = createLLMResponse({
        content: null,
        finishReason: 'tool_use',
        toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'test' } }],
        usage: makeUsage(50, 50), // 100 total → hits budget, grace injected
      });
      const secondResponse = createLLMResponse({
        content: 'Done within grace.',
        finishReason: 'stop',
        usage: makeUsage(3, 2), // adds 5 → total 105, under grace limit of 110
      });
      const provider = makeMockProvider([firstResponse, secondResponse]);

      const searchTool = makeMockTool('search', 'result');
      const registry = new ToolRegistry();
      registry.register(searchTool);

      const loop = new ReasoningLoop(provider, registry);
      const result = await loop.run([{ role: 'user', content: 'test' }], {
        budgetTracker: new BudgetTracker(100, 10),
      });

      // Should complete normally (not hard-killed)
      expect(result.hitTokenBudget).toBe(false);
      expect(result.content).toBe('Done within grace.');
    });

    it('shared tracker accumulates across two reasoning loops', async () => {
      // Simulates a "parent + sub-agent" sharing the same tracker.
      const tracker = new BudgetTracker(100, 10);

      // First loop ("parent first turn") consumes 60 tokens
      const firstResp = createLLMResponse({
        content: 'parent ack',
        finishReason: 'stop',
        usage: makeUsage(30, 30),
      });
      const provider1 = makeMockProvider([firstResp]);
      const loop1 = new ReasoningLoop(provider1, new ToolRegistry());
      await loop1.run([{ role: 'user', content: 'p' }], { budgetTracker: tracker });
      expect(tracker.used).toBe(60);

      // Second loop ("sub-agent") starts with a tracker already at 60 and
      // overshoots the grace limit (110) on its very first call.
      const subResp = createLLMResponse({
        content: 'too much',
        finishReason: 'tool_use',
        toolCalls: [{ id: 't1', name: 'search', arguments: { query: 'q' } }],
        usage: makeUsage(40, 30), // 60 + 70 = 130 ≥ 110
      });
      const provider2 = makeMockProvider([subResp]);
      const loop2 = new ReasoningLoop(provider2, new ToolRegistry());
      const result2 = await loop2.run([{ role: 'user', content: 's' }], {
        budgetTracker: tracker,
      });

      expect(result2.hitTokenBudget).toBe(true);
      expect(tracker.used).toBe(130);
    });

    it('null budget on tracker disables enforcement', async () => {
      const tracker = new BudgetTracker(null, 10);
      const response = createLLMResponse({
        content: 'big response',
        finishReason: 'stop',
        usage: makeUsage(10_000_000, 10_000_000), // way past any sane limit
      });
      const provider = makeMockProvider([response]);
      const loop = new ReasoningLoop(provider, new ToolRegistry());

      const result = await loop.run([{ role: 'user', content: 'go' }], {
        budgetTracker: tracker,
      });

      expect(result.hitTokenBudget).toBe(false);
      expect(tracker.isOverGrace()).toBe(false);
      expect(tracker.used).toBe(20_000_000);
    });
  });

  it('message accumulation: result.messages contains all message types', async () => {
    const toolCallResponse = createLLMResponse({
      content: null,
      finishReason: 'tool_use',
      toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'q' } }],
      usage: makeUsage(5, 5),
    });
    const finalResponse = createLLMResponse({
      content: 'Final answer.',
      finishReason: 'stop',
      usage: makeUsage(5, 5),
    });
    const provider = makeMockProvider([toolCallResponse, finalResponse]);

    const searchTool = makeMockTool('search', 'tool output');
    const registry = new ToolRegistry();
    registry.register(searchTool);

    const loop = new ReasoningLoop(provider, registry);
    const initialMessages: readonly ChatMessage[] = [{ role: 'user', content: 'question' }];
    const result = await loop.run(initialMessages);

    // Should have: user, assistant(+toolCalls), tool result, final assistant
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0]).toEqual({ role: 'user', content: 'question' });
    expect(result.messages[1]!.role).toBe('assistant');
    expect(result.messages[1]!.toolCalls).toHaveLength(1);
    expect(result.messages[2]!.role).toBe('tool');
    expect(result.messages[2]!.toolCallId).toBe('tc1');
    expect(result.messages[3]).toEqual({ role: 'assistant', content: 'Final answer.' });
  });
});
