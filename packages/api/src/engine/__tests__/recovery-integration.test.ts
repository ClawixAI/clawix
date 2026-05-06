/**
 * Recovery integration tests — exercises the real ReasoningLoop with a real
 * recovery path (runWithRecovery + ToolLoopGuard) by mocking only
 * provider.chat and toolRegistry.execute.
 *
 * These tests intentionally do NOT mock ReasoningLoop itself; they verify
 * that the retry and loop-abort behaviours work end-to-end through the real
 * loop implementation.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { LLMProvider, LLMResponse, ChatMessage } from '@clawix/shared';
import { createLLMResponse } from '@clawix/shared';

import { ReasoningLoop } from '../reasoning-loop.js';
import { ToolRegistry } from '../tool-registry.js';
import { LoopAbortedError } from '../error-classifier.js';
import type { Tool, ToolResult } from '../tool.js';

/* ------------------------------------------------------------------ */
/*  Shared fixtures                                                    */
/* ------------------------------------------------------------------ */

const providerInfo = { provider: 'mock', model: 'test-model' };

/** A CompressorService stub — compression is not exercised in these tests. */
const mockCompressor = { compress: vi.fn() } as never;

const userMessage: ChatMessage = { role: 'user', content: 'Hello!' };

/** A minimal successful LLMResponse with no tool calls. */
function makeOkResponse(content = 'recovered'): LLMResponse {
  return createLLMResponse({
    content,
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  });
}

/** An LLMResponse that requests a single tool call. */
function makeToolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
  id = 'tc-1',
): LLMResponse {
  return createLLMResponse({
    content: null,
    finishReason: 'tool_use',
    toolCalls: [{ id, name: toolName, arguments: args }],
    usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
  });
}

/* ------------------------------------------------------------------ */
/*  Helper: build a minimal LLMProvider from a scripted call sequence  */
/* ------------------------------------------------------------------ */

function makeProvider(
  script: { error?: Error; response?: LLMResponse }[],
): LLMProvider & { chat: ReturnType<typeof vi.fn> } {
  let i = 0;
  const chat = vi.fn().mockImplementation(async () => {
    const step = script[i++];
    if (!step) throw new Error('provider script exhausted');
    if (step.error) throw step.error;
    return step.response!;
  });
  return { name: 'mock', chat } as unknown as LLMProvider & { chat: ReturnType<typeof vi.fn> };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ReasoningLoop — recovery integration', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------- //
  //  Test 1: Recovers from a transient 503 and completes the run     //
  // ---------------------------------------------------------------- //

  it('recovers from a transient 503 and completes the run', async () => {
    const overloaded = Object.assign(new Error('status 503 overloaded'), { status: 503 });

    const provider = makeProvider([
      { error: overloaded }, // first call: 503 — triggers retry in runWithRecovery
      { response: makeOkResponse('recovered') }, // second call: success
    ]);

    const registry = new ToolRegistry();
    const loop = new ReasoningLoop(provider, registry, mockCompressor, providerInfo);

    // Use fake timers so the 500 ms + jitter backoff resolves instantly.
    vi.useFakeTimers();

    const promise = loop.run([userMessage]);

    // Advance past the first retry backoff window (default: 500 ms base + up to 250 ms jitter).
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    // The provider must have been called twice: once failing, once succeeding.
    expect(provider.chat).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('recovered');
    expect(result.iterations).toBe(1); // one completed loop iteration
  });

  // ---------------------------------------------------------------- //
  //  Test 2: ToolLoopGuard aborts after 3× identical failing calls   //
  // ---------------------------------------------------------------- //

  it('surfaces LoopAbortedError when the same tool fails 3× in a row', async () => {
    const toolName = 'web_search';
    const toolArgs = { q: 'test query' };

    // The provider always requests the same tool call (drives the loop).
    // We need 3 tool-call responses so the guard can see 3 consecutive failures.
    const provider = makeProvider([
      { response: makeToolCallResponse(toolName, toolArgs, 'tc-1') },
      { response: makeToolCallResponse(toolName, toolArgs, 'tc-2') },
      { response: makeToolCallResponse(toolName, toolArgs, 'tc-3') },
    ]);

    // Register a tool that always returns an error result.
    const failingTool: Tool = {
      name: toolName,
      description: 'web search',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
      execute: vi.fn().mockResolvedValue({
        output: 'ERROR: service unavailable',
        isError: true,
      } satisfies ToolResult),
    };

    const registry = new ToolRegistry();
    registry.register(failingTool);

    const loop = new ReasoningLoop(provider, registry, mockCompressor, providerInfo);

    // The ToolLoopGuard fires synchronously inside the loop — no timers needed.
    await expect(loop.run([userMessage])).rejects.toBeInstanceOf(LoopAbortedError);

    // The tool must have been executed exactly 3 times (the threshold).
    expect(failingTool.execute).toHaveBeenCalledTimes(3);

    // The provider was called 3 times (once per iteration before guard fired).
    expect(provider.chat).toHaveBeenCalledTimes(3);
  });
});
