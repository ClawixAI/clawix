import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider, LLMResponse } from '@clawix/shared';

import { ReasoningLoop } from '../reasoning-loop.js';
import { ToolRegistry } from '../tool-registry.js';
import type { Tool, ToolResult } from '../tool.js';

const mockCompressor = { compress: vi.fn() } as never;
const providerInfo = { provider: 'mock', model: 'test-model' };

/** Minimal pino-shaped logger whose level methods are spies. */
function makeFakeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** Provider that returns a tool call for the first `toolTurns` calls, then stops. */
function toolThenStopProvider(toolName: string, toolTurns = 1): LLMProvider {
  let calls = 0;
  return {
    name: 'scripted',
    chat: vi.fn(async () => {
      calls++;
      if (calls <= toolTurns) {
        return {
          content: null,
          toolCalls: [{ id: `tc-${calls}`, name: toolName, arguments: { q: 'x' } }],
          thinkingBlocks: null,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          finishReason: 'tool_use',
        } as LLMResponse;
      }
      return {
        content: 'done',
        toolCalls: [],
        thinkingBlocks: null,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
      } as LLMResponse;
    }),
  };
}

/** A tool that optionally sleeps (ignoring the abort signal, simulating a hang). */
function makeTool(name: string, opts: { delayMs?: number } = {}): Tool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    execute: vi.fn(async (): Promise<ToolResult> => {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      return { output: 'ok', isError: false };
    }),
  };
}

describe('ReasoningLoop observability', () => {
  it('notifies the observer of iterations and tool start/end in order', async () => {
    const provider = toolThenStopProvider('mock_tool', 1);
    const registry = new ToolRegistry();
    registry.register(makeTool('mock_tool'));
    const loop = new ReasoningLoop(provider, registry, mockCompressor, providerInfo);

    const events: string[] = [];
    await loop.run([{ role: 'user', content: 'hi' }], {
      observer: {
        onIteration: (n) => events.push(`iter:${n}`),
        onToolStart: (name) => events.push(`start:${name}`),
        onToolEnd: (name) => events.push(`end:${name}`),
      },
    });

    expect(events).toContain('iter:1');
    expect(events).toContain('start:mock_tool');
    expect(events).toContain('end:mock_tool');
    expect(events.indexOf('start:mock_tool')).toBeLessThan(events.indexOf('end:mock_tool'));
  });

  it('logs tool completion with a duration on the run-scoped logger', async () => {
    const provider = toolThenStopProvider('mock_tool', 1);
    const registry = new ToolRegistry();
    registry.register(makeTool('mock_tool', { delayMs: 15 }));
    const loop = new ReasoningLoop(provider, registry, mockCompressor, providerInfo);
    const log = makeFakeLogger();

    await loop.run([{ role: 'user', content: 'hi' }], { logger: log as never });

    const durationLog = log.debug.mock.calls.find(
      ([obj]) =>
        obj &&
        typeof obj === 'object' &&
        (obj as Record<string, unknown>).tool === 'mock_tool' &&
        typeof (obj as Record<string, unknown>).durationMs === 'number',
    );
    expect(durationLog).toBeDefined();
    expect((durationLog![0] as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  });

  it('warns while a tool is still running past the slow-tool threshold', async () => {
    const provider = toolThenStopProvider('slow_tool', 1);
    const registry = new ToolRegistry();
    registry.register(makeTool('slow_tool', { delayMs: 80 }));
    const loop = new ReasoningLoop(provider, registry, mockCompressor, providerInfo);
    const log = makeFakeLogger();

    await loop.run([{ role: 'user', content: 'hi' }], {
      logger: log as never,
      slowToolWarnMs: 20,
    });

    const slowWarn = log.warn.mock.calls.find(
      ([obj]) =>
        obj && typeof obj === 'object' && (obj as Record<string, unknown>).tool === 'slow_tool',
    );
    expect(slowWarn).toBeDefined();
  });

  it('warns when an aborted tool keeps running past the grace period', async () => {
    const provider = toolThenStopProvider('stubborn_tool', 1);
    const registry = new ToolRegistry();
    // Sleeps 150ms regardless of the abort signal (simulates a transport that ignores abort).
    registry.register(makeTool('stubborn_tool', { delayMs: 150 }));
    const loop = new ReasoningLoop(provider, registry, mockCompressor, providerInfo);
    const log = makeFakeLogger();

    const result = await loop.run([{ role: 'user', content: 'hi' }], {
      logger: log as never,
      timeoutMs: 30, // abort fires ~30ms into the tool
      abortGraceMs: 20, // grace elapses ~50ms; tool still runs until 150ms
    });

    const abortWarn = log.warn.mock.calls.find(
      ([obj, msg]) =>
        obj &&
        typeof obj === 'object' &&
        (obj as Record<string, unknown>).tool === 'stubborn_tool' &&
        typeof msg === 'string' &&
        /abort/i.test(msg),
    );
    expect(abortWarn).toBeDefined();
    expect(result.hitTimeout).toBe(true);
  });

  it('emits periodic heartbeats while a long tool runs', async () => {
    const provider = toolThenStopProvider('long_tool', 1);
    const registry = new ToolRegistry();
    registry.register(makeTool('long_tool', { delayMs: 90 }));
    const loop = new ReasoningLoop(provider, registry, mockCompressor, providerInfo);
    const log = makeFakeLogger();

    await loop.run([{ role: 'user', content: 'hi' }], {
      logger: log as never,
      heartbeatIntervalMs: 25,
    });

    const heartbeats = log.info.mock.calls.filter(
      ([, msg]) => typeof msg === 'string' && /heartbeat/i.test(msg),
    );
    expect(heartbeats.length).toBeGreaterThanOrEqual(1);
  });

  it('does not emit heartbeats between iterations when no tool is running', async () => {
    // A slow provider call with no tool calls: the loop is "busy" but not in a
    // tool. Heartbeats are gated to in-tool time, so healthy inter-iteration
    // waits stay quiet (debug "Starting iteration" + tool logs cover the rest).
    const provider: LLMProvider = {
      name: 'slow-no-tool',
      chat: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 90));
        return {
          content: 'done',
          toolCalls: [],
          thinkingBlocks: null,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
        } as LLMResponse;
      }),
    };
    const registry = new ToolRegistry();
    const loop = new ReasoningLoop(provider, registry, mockCompressor, providerInfo);
    const log = makeFakeLogger();

    await loop.run([{ role: 'user', content: 'hi' }], {
      logger: log as never,
      heartbeatIntervalMs: 25,
    });

    const heartbeats = log.info.mock.calls.filter(
      ([, msg]) => typeof msg === 'string' && /heartbeat/i.test(msg),
    );
    expect(heartbeats.length).toBe(0);
  });

  it('heartbeat reports abort-ignored elapsed while a stubborn tool runs on', async () => {
    const provider = toolThenStopProvider('stubborn_tool', 1);
    const registry = new ToolRegistry();
    registry.register(makeTool('stubborn_tool', { delayMs: 150 }));
    const loop = new ReasoningLoop(provider, registry, mockCompressor, providerInfo);
    const log = makeFakeLogger();

    await loop.run([{ role: 'user', content: 'hi' }], {
      logger: log as never,
      timeoutMs: 30, // abort fires ~30ms into the tool
      abortGraceMs: 20,
      heartbeatIntervalMs: 25, // ticks land inside the post-abort stuck window
    });

    // At least one heartbeat, fired while the tool ignores abort, carries the
    // elapsed-since-abort so the ignoring-abort state is re-surfaced over time.
    const abortHeartbeat = log.info.mock.calls.find(
      ([obj, msg]) =>
        typeof msg === 'string' &&
        /heartbeat/i.test(msg) &&
        obj &&
        typeof obj === 'object' &&
        typeof (obj as Record<string, unknown>).abortIgnoredMs === 'number',
    );
    expect(abortHeartbeat).toBeDefined();
  });

  it('does not emit heartbeats or slow warns on a fast run with defaults', async () => {
    const provider = toolThenStopProvider('fast_tool', 1);
    const registry = new ToolRegistry();
    registry.register(makeTool('fast_tool'));
    const loop = new ReasoningLoop(provider, registry, mockCompressor, providerInfo);
    const log = makeFakeLogger();

    await loop.run([{ role: 'user', content: 'hi' }], { logger: log as never });

    const heartbeats = log.info.mock.calls.filter(
      ([, msg]) => typeof msg === 'string' && /heartbeat/i.test(msg),
    );
    const slowWarns = log.warn.mock.calls.filter(
      ([obj]) =>
        obj && typeof obj === 'object' && (obj as Record<string, unknown>).tool === 'fast_tool',
    );
    expect(heartbeats.length).toBe(0);
    expect(slowWarns.length).toBe(0);
  });
});
