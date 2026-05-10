/**
 * Integration test: agent run cancellation end-to-end
 *
 * Verifies that when AgentRunRegistry fires abort for an active run:
 *   1. The run's reasoning loop exits cleanly within ~1s
 *   2. An in-flight tool call that honors AbortSignal is aborted (stub sleep tool)
 *   3. Cancellation propagates through real ReasoningLoop + real ToolRegistry +
 *      real AgentRunRegistry — only the LLM provider, DB layer, and slow tool are stubbed
 *
 * Pattern: same as recovery-integration.test.ts — real engine internals,
 * mocked external dependencies.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider, LLMResponse, ChatMessage } from '@clawix/shared';
import { createLLMResponse } from '@clawix/shared';

import { ReasoningLoop } from '../reasoning-loop.js';
import { ToolRegistry } from '../tool-registry.js';
import { AgentRunRegistry } from '../agent-run-registry.service.js';
import type { Tool, ToolResult, ToolExecuteContext } from '../tool.js';

/* ------------------------------------------------------------------ */
/*  Shared fixtures                                                    */
/* ------------------------------------------------------------------ */

const providerInfo = { provider: 'mock', model: 'test-model' };

/** CompressorService stub — compression is not exercised in these tests. */
const mockCompressor = { compress: vi.fn() } as never;

/* ------------------------------------------------------------------ */
/*  Stub tools                                                         */
/* ------------------------------------------------------------------ */

/**
 * A long-running tool that respects AbortSignal — simulates `shell sleep 30`.
 * Resolves after 30s, OR resolves immediately with isError=true when signal fires.
 */
function makeSleepTool(): Tool {
  return {
    name: 'sleep',
    description: 'Simulate a long-running tool',
    parameters: { type: 'object', properties: {} },
    async execute(_params: Record<string, unknown>, ctx?: ToolExecuteContext): Promise<ToolResult> {
      return new Promise<ToolResult>((resolve) => {
        const timeout = setTimeout(() => resolve({ output: 'finished', isError: false }), 30_000);

        if (ctx?.abortSignal) {
          if (ctx.abortSignal.aborted) {
            clearTimeout(timeout);
            resolve({ output: 'aborted', isError: true });
            return;
          }
          ctx.abortSignal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeout);
              resolve({ output: 'aborted', isError: true });
            },
            { once: true },
          );
        }
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Provider factory (matches recovery-integration.test.ts pattern)   */
/* ------------------------------------------------------------------ */

function makeProvider(responses: LLMResponse[]): LLMProvider & { chat: ReturnType<typeof vi.fn> } {
  let i = 0;
  const chat = vi.fn().mockImplementation(async () => {
    const r = responses[i++];
    if (!r) throw new Error('provider script exhausted');
    return r;
  });
  return { name: 'mock', chat } as unknown as LLMProvider & { chat: ReturnType<typeof vi.fn> };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('Agent run cancellation — end-to-end integration', () => {
  /**
   * Primary test: verifies the full abort-signal propagation path.
   *
   * The provider is scripted to call the slow `sleep` tool (30s wall-clock),
   * then return a final answer. Without cancellation the test would block for
   * 30s and exceed the 5s test timeout. With proper plumbing the abort fires
   * after 100ms, the sleep tool's Promise resolves immediately, and the loop
   * exits in well under 1s.
   */
  it('cancels a slow tool within 1s when AgentRunRegistry fires abort', async () => {
    // Stub Prisma — only the in-memory abort path matters here.
    const stubPrisma = {
      agentRun: {
        findMany: vi.fn().mockResolvedValue([{ id: 'run-1' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const registry = new AgentRunRegistry(stubPrisma as never);

    // Real ToolRegistry with the slow sleep tool.
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(makeSleepTool());

    // Provider scripted to: call the sleep tool once, then end.
    // The second response would only be reached if cancellation is broken.
    const provider = makeProvider([
      createLLMResponse({
        content: null,
        finishReason: 'tool_use',
        toolCalls: [{ id: 'tc1', name: 'sleep', arguments: {} }],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
      createLLMResponse({
        content: 'done',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    ]);

    // Register the controller with the registry and pass its signal into the loop.
    const controller = new AbortController();
    registry.register('run-1', controller);

    const loop = new ReasoningLoop(provider, toolRegistry, mockCompressor, providerInfo);

    const userMessage: ChatMessage = { role: 'user', content: 'please sleep' };

    // Trigger abort 100ms after the run starts — well before the 30s sleep ends.
    const startTime = Date.now();
    setTimeout(() => {
      registry.abort('run-1', 'user_stop');
    }, 100);

    const result = await loop.run([userMessage], { abortSignal: controller.signal });
    const elapsed = Date.now() - startTime;

    // The loop must exit in under 1s (the 30s sleep was cancelled).
    expect(elapsed).toBeLessThan(1000);

    // The controller signal must be aborted with the reason set by the registry.
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe('user_stop');

    // hitTimeout is true because the loop treats external abort as a timeout exit.
    expect(result.hitTimeout).toBe(true);
  }, 5_000 /* 5s test timeout — well above the 1s assertion */);

  /**
   * Secondary test: abortAllForUser fires all in-memory aborts AND writes
   * status='cancelled' to the DB layer.
   *
   * This is primarily an integration check of the registry's combined
   * in-memory + DB behaviour (the unit tests in agent-run-registry.service.test.ts
   * cover the individual methods).
   */
  it('abortAllForUser fires abort and writes cancelled to DB', async () => {
    const stubPrisma = {
      agentRun: {
        findMany: vi.fn().mockResolvedValue([{ id: 'run-A' }, { id: 'run-B' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const registry = new AgentRunRegistry(stubPrisma as never);

    const c1 = new AbortController();
    const c2 = new AbortController();
    registry.register('run-A', c1);
    registry.register('run-B', c2);

    const result = await registry.abortAllForUser('user-1');

    // Both in-memory controllers must be aborted with the correct reason.
    expect(result.stopped).toBe(2);
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
    expect(c1.signal.reason).toBe('user_stop');
    expect(c2.signal.reason).toBe('user_stop');

    // The DB update must target the correct run IDs and set the right fields.
    expect(stubPrisma.agentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['run-A', 'run-B'] }, status: 'running' },
        data: expect.objectContaining({
          status: 'cancelled',
          error: 'Stopped by user',
        }),
      }),
    );
  });
});
