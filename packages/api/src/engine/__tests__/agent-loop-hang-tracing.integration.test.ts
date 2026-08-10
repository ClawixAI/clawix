import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LLMProvider, LLMResponse } from '@clawix/shared';

import { TaskExecutorService } from '../task-executor.service.js';
import { SubAgentResultPublisher } from '../sub-agent-result.publisher.js';
import { RunActivityRegistry } from '../run-activity.registry.js';
import { ReasoningLoop } from '../reasoning-loop.js';
import { ToolRegistry } from '../tool-registry.js';
import { agentWatchdogFiredTotal } from '../agent-loop-metrics.js';
import type { Tool, ToolResult } from '../tool.js';
import type { AgentRunnerService } from '../agent-runner.service.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';
import type { SessionRepository } from '../../db/session.repository.js';
import type { RedisService } from '../../cache/redis.service.js';
import type { RedisPubSubService } from '../../cache/redis-pubsub.service.js';
import type { AgentDefinitionRepository } from '../../db/agent-definition.repository.js';

/**
 * End-to-end proof that the hang-tracing chain pins the actual culprit on a
 * real stack: a real ReasoningLoop drives a tool that ignores its abort signal
 * and never returns, feeding a real RunActivityRegistry, which a real
 * TaskExecutorService watchdog reads when the never-settling run trips it.
 *
 * Unit tests prove each line fires in isolation; this confirms they compose —
 * the tool the loop got stuck in is exactly what the watchdog reports.
 */

/** Spy logger with pino-shaped level methods. */
function makeSpyLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A tool that hangs forever, ignoring the abort signal entirely. */
function hangingTool(name: string): Tool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: (): Promise<ToolResult> => new Promise<ToolResult>(() => {}),
  };
}

/** Provider that asks for one tool call (which will then hang). */
function toolCallProvider(toolName: string): LLMProvider {
  return {
    name: 'scripted',
    chat: vi.fn(async () => {
      return {
        content: null,
        toolCalls: [{ id: 'tc-1', name: toolName, arguments: {} }],
        thinkingBlocks: null,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'tool_use',
      } as LLMResponse;
    }),
  };
}

async function counterValue(): Promise<number> {
  const metric = await agentWatchdogFiredTotal.get();
  return metric.values[0]?.value ?? 0;
}

const RUN_ID = 'run-hang';

describe('agent-loop hang tracing (end-to-end)', () => {
  let runActivity: RunActivityRegistry;
  let spyLogger: ReturnType<typeof makeSpyLogger>;
  let mockAgentRunRegistry: { abort: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['MAX_CONCURRENT_AGENTS'] = '1';
    runActivity = new RunActivityRegistry();
    spyLogger = makeSpyLogger();
    mockAgentRunRegistry = { abort: vi.fn().mockReturnValue(true) };
  });

  afterEach(() => {
    delete process.env['MAX_CONCURRENT_AGENTS'];
  });

  function buildExecutor() {
    // Real loop with a tool that ignores abort and never returns.
    const registry = new ToolRegistry();
    registry.register(hangingTool('hang'));
    const loop = new ReasoningLoop(
      toolCallProvider('hang'),
      registry,
      { compress: vi.fn() } as never,
      { provider: 'mock', model: 'test' },
    );

    // Thin runner mirroring what AgentRunnerService does for tracing: register
    // activity, run the real loop with a run-scoped logger + observer wired to
    // the real registry. The tool hangs, so run() never settles — exactly the
    // condition the executor watchdog exists to catch.
    const runner = {
      run: (opts: { agentRunId: string; sessionId: string; timeoutMs?: number }) => {
        runActivity.register(opts.agentRunId, { agentName: 'worker', sessionId: opts.sessionId });
        return loop.run([{ role: 'user', content: 'go' }], {
          logger: spyLogger as never,
          timeoutMs: opts.timeoutMs,
          slowToolWarnMs: 500,
          abortGraceMs: 200,
          heartbeatIntervalMs: 300,
          observer: {
            onIteration: (n) => runActivity.recordIteration(opts.agentRunId, n),
            onToolStart: (name) => runActivity.recordToolStart(opts.agentRunId, name),
            onToolEnd: () => runActivity.recordToolEnd(opts.agentRunId),
          },
        });
      },
    };

    const childRun = {
      id: RUN_ID,
      parentAgentRunId: 'run-parent',
      agentDefinitionId: 'agent-def-1',
      sessionId: 'sess-parent',
    };
    const parentRun = { id: 'run-parent', sessionId: 'sess-parent', parentAgentRunId: null };

    const mockAgentRunRepo = {
      findById: vi.fn(async (id: string) => (id === RUN_ID ? childRun : parentRun)),
      update: vi.fn().mockResolvedValue(childRun),
      findAllByStatus: vi.fn().mockResolvedValue([]),
    };
    const mockSessionRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'sess-parent', userId: 'u1' }),
    };
    const mockRedis = {
      lpush: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(true),
      getClient: vi.fn().mockReturnValue({ scan: vi.fn().mockResolvedValue(['0', []]) }),
    };
    const mockPubsub = {
      publish: vi.fn().mockResolvedValue(1),
      subscribe: vi.fn().mockResolvedValue(undefined),
    };
    const mockAgentDefRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'agent-def-1', name: 'worker' }),
    };

    const resultPublisher = new SubAgentResultPublisher(
      mockAgentRunRepo as unknown as AgentRunRepository,
      mockAgentDefRepo as unknown as AgentDefinitionRepository,
      mockRedis as unknown as RedisService,
      mockPubsub as unknown as RedisPubSubService,
    );

    return new TaskExecutorService(
      runner as unknown as AgentRunnerService,
      mockAgentRunRepo as unknown as AgentRunRepository,
      mockSessionRepo as unknown as SessionRepository,
      mockRedis as unknown as RedisService,
      mockPubsub as unknown as RedisPubSubService,
      mockAgentRunRegistry as unknown as import('../agent-run-registry.service.js').AgentRunRegistry,
      runActivity,
      resultPublisher,
    );
  }

  it('traces a hanging sub-agent from tool-start through the watchdog death-log', async () => {
    vi.useFakeTimers();
    try {
      const before = await counterValue();
      const service = buildExecutor();

      service.submit(RUN_ID, {
        agentDefinitionId: 'agent-def-1',
        input: 'go',
        userId: 'u1',
        sessionId: 'sess-parent',
        timeoutMs: 1000,
      });

      // Mid-hang: the loop has entered the tool. The real registry snapshot —
      // the exact source the watchdog reads — must name the stuck tool.
      await vi.advanceTimersByTimeAsync(600);
      const midSnapshot = runActivity.snapshot(RUN_ID);
      expect(midSnapshot?.currentToolName).toBe('hang');
      expect(midSnapshot?.iteration).toBe(1);

      // A heartbeat fired during the tool, naming it; a slow-tool warn fired.
      const heartbeat = spyLogger.info.mock.calls.find(
        ([o, m]) =>
          typeof m === 'string' &&
          /heartbeat/i.test(m) &&
          (o as Record<string, unknown>)?.tool === 'hang',
      );
      expect(heartbeat).toBeDefined();
      expect(
        spyLogger.warn.mock.calls.some(
          ([, m]) => typeof m === 'string' && /slow threshold/i.test(m),
        ),
      ).toBe(true);

      // Past the loop timeout + grace: abort fired and the tool ignored it.
      await vi.advanceTimersByTimeAsync(700);
      expect(
        spyLogger.warn.mock.calls.some(
          ([, m]) => typeof m === 'string' && /ignoring abort signal/i.test(m),
        ),
      ).toBe(true);

      // Past the watchdog window: the never-settling run is force-failed, and
      // the watchdog reports via the same registry snapshot.
      await vi.advanceTimersByTimeAsync(31_000);
      expect(mockAgentRunRegistry.abort).toHaveBeenCalledWith(RUN_ID, 'watchdog_timeout');
      expect(await counterValue()).toBe(before + 1);
      expect(service.activeCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
