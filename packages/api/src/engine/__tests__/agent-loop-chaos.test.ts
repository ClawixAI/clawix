import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ------------------------------------------------------------------ //
//  Module mocks — must be hoisted before imports                      //
// ------------------------------------------------------------------ //

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

// ------------------------------------------------------------------ //
//  Imports after mocks                                                //
// ------------------------------------------------------------------ //

import { TaskExecutorService } from '../task-executor.service.js';
import { agentActiveSlots, agentWatchdogFiredTotal } from '../agent-loop-metrics.js';
import type { AgentRunnerService } from '../agent-runner.service.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';
import type { SessionRepository } from '../../db/session.repository.js';
import type { RedisService } from '../../cache/redis.service.js';
import type { RedisPubSubService } from '../../cache/redis-pubsub.service.js';
import type { AgentDefinitionRepository } from '../../db/agent-definition.repository.js';
import { KEY_PREFIXES } from '../../cache/cache.constants.js';
import type { RunResult } from '../agent-runner.types.js';

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

function makeRunResult(agentRunId: string): RunResult {
  return {
    agentRunId,
    sessionId: 'sess-parent',
    output: 'done',
    status: 'completed',
    tokenUsage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      model: 'test-model',
      estimatedCostUsd: 0,
    },
  };
}

/** Read a no-label prom-client metric's current scalar value. */
async function metricValue(metric: {
  get(): Promise<{ values: { value: number }[] }>;
}): Promise<number> {
  const snapshot = await metric.get();
  return snapshot.values[0]?.value ?? 0;
}

const mockSession = {
  id: 'sess-parent',
  userId: 'user-1',
  agentDefinitionId: 'agent-def-1',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockAgentRun = {
  id: 'run-1',
  agentDefinitionId: 'agent-def-1',
  sessionId: 'sess-parent',
  status: 'pending' as const,
  input: 'Hello!',
  output: null,
  error: null,
  tokenUsage: null,
  startedAt: new Date(),
  completedAt: null,
  parentAgentRunId: null,
};

// ------------------------------------------------------------------ //
//  Chaos harness                                                      //
//                                                                     //
//  Drives a swarm of sub-agent runs through a matrix of fault modes   //
//  (clean, provider-reject, abort-ignoring hang, slow-but-ok) and     //
//  asserts the executor's stability invariants after everything       //
//  settles: no slot leak, drained queue, every child reported back,   //
//  and the watchdog fired exactly once per hung child.                //
// ------------------------------------------------------------------ //

describe('agent-loop chaos harness', () => {
  let service: TaskExecutorService;
  let mockAgentRunner: { run: ReturnType<typeof vi.fn> };
  let mockAgentRunRepo: {
    findAllByStatus: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    sumSessionTokenUsage: ReturnType<typeof vi.fn>;
  };
  let mockSessionRepo: { findById: ReturnType<typeof vi.fn> };
  let mockRedis: Record<string, ReturnType<typeof vi.fn>>;
  let mockPubsub: { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
  let mockAgentDefRepo: { findById: ReturnType<typeof vi.fn> };
  let mockAgentRunRegistry: { abort: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    // Small ceiling so the swarm saturates slots and exercises queue drain.
    process.env['MAX_CONCURRENT_AGENTS'] = '4';
    process.env['MAX_PENDING_AGENTS'] = '100';

    mockAgentRunner = { run: vi.fn() };
    mockAgentRunRepo = {
      findAllByStatus: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ ...mockAgentRun }),
      findById: vi.fn().mockResolvedValue(mockAgentRun),
      sumSessionTokenUsage: vi.fn().mockResolvedValue(0),
    };
    mockSessionRepo = { findById: vi.fn().mockResolvedValue(mockSession) };
    mockRedis = {
      lpush: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(true),
      setNx: vi.fn().mockResolvedValue(true),
      del: vi.fn().mockResolvedValue(true),
      lmove: vi.fn().mockResolvedValue(null),
      lrem: vi.fn().mockResolvedValue(1),
      llen: vi.fn().mockResolvedValue(0),
      lrange: vi.fn().mockResolvedValue([]),
      incr: vi.fn().mockResolvedValue(1),
      getClient: vi.fn().mockReturnValue({ scan: vi.fn().mockResolvedValue(['0', []]) }),
    };
    mockPubsub = {
      publish: vi.fn().mockResolvedValue(1),
      subscribe: vi.fn().mockResolvedValue(undefined),
    };
    mockAgentDefRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'agent-def-1', name: 'worker' }),
    };
    mockAgentRunRegistry = { abort: vi.fn().mockReturnValue(true) };
    const mockRunActivity = { snapshot: vi.fn().mockReturnValue(undefined) };

    service = new TaskExecutorService(
      mockAgentRunner as unknown as AgentRunnerService,
      mockAgentRunRepo as unknown as AgentRunRepository,
      mockSessionRepo as unknown as SessionRepository,
      mockRedis as unknown as RedisService,
      mockPubsub as unknown as RedisPubSubService,
      mockAgentDefRepo as unknown as AgentDefinitionRepository,
      mockAgentRunRegistry as unknown as import('../agent-run-registry.service.js').AgentRunRegistry,
      mockRunActivity as unknown as import('../run-activity.registry.js').RunActivityRegistry,
    );
  });

  afterEach(() => {
    delete process.env['MAX_CONCURRENT_AGENTS'];
    delete process.env['MAX_PENDING_AGENTS'];
  });

  it('survives a swarm of mixed faults with no slot leak or lost child', async () => {
    vi.useFakeTimers();
    try {
      const N = 12;
      const FAULTS = ['ok', 'reject', 'hang', 'slow-ok'] as const;
      const faultOf = (i: number): (typeof FAULTS)[number] => FAULTS[i % FAULTS.length]!;
      const hangCount = Array.from({ length: N }, (_, i) => i).filter(
        (i) => faultOf(i) === 'hang',
      ).length;

      const parentRun = { ...mockAgentRun, id: 'parent', parentAgentRunId: null };
      mockAgentRunRepo.findById.mockImplementation((id: string) =>
        id === 'parent'
          ? Promise.resolve(parentRun)
          : Promise.resolve({ ...mockAgentRun, id, parentAgentRunId: 'parent' }),
      );

      // Inject a fault per child based on its index.
      mockAgentRunner.run.mockImplementation((opts: { agentRunId: string }) => {
        const idx = Number(opts.agentRunId.slice(1));
        switch (faultOf(idx)) {
          case 'ok':
            return Promise.resolve(makeRunResult(opts.agentRunId));
          case 'reject':
            return Promise.reject(new Error(`provider blew up on ${opts.agentRunId}`));
          case 'hang':
            // Never settles — simulates a tool that ignores the abort signal.
            return new Promise<RunResult>(() => {});
          case 'slow-ok':
            // Settles well before the watchdog window (1000 + 30000 ms).
            return new Promise<RunResult>((resolve) =>
              setTimeout(() => resolve(makeRunResult(opts.agentRunId)), 500),
            );
        }
      });

      // prom-client counters are process-global singletons that accumulate
      // across tests in this file — capture-and-diff (not absolute value) keeps
      // this test independent of the sibling test below.
      const watchdogBefore = await metricValue(agentWatchdogFiredTotal);

      for (let i = 0; i < N; i++) {
        service.submit(`c${i}`, {
          agentDefinitionId: 'agent-def-1',
          input: `task ${i}`,
          userId: 'user-1',
          sessionId: 'sess-parent',
          timeoutMs: 1000,
        });
      }

      // Drive everything to quiescence: slow-ok resolves at 500ms; hangs are
      // force-aborted by the watchdog at 31s, freeing slots so the queued tail
      // drains. runAllTimersAsync flushes microtasks between timers.
      //
      // NB: the 'hang' promises never settle by design. runAllTimersAsync only
      // *advances timers* — it does not await dangling promises — so it still
      // terminates here. That is exactly the production condition being
      // simulated (a tool that ignores the abort signal); do not "fix" this by
      // awaiting the runner promises.
      await vi.runAllTimersAsync();

      // ---- Invariants ------------------------------------------------ //

      // No slot leak; queue fully drained.
      expect(service.activeCount).toBe(0);
      expect(service.pendingCount).toBe(0);

      // Every child reported exactly one terminal result/failure to the parent —
      // nothing silently dropped.
      const parentQueueKey = `${KEY_PREFIXES.agentResults}sess-parent`;
      const deliveries = mockRedis.lpush!.mock.calls.filter((c) => c[0] === parentQueueKey);
      expect(deliveries).toHaveLength(N);

      // The watchdog fired once per hung child — and only for the hung ones.
      const watchdogAfter = await metricValue(agentWatchdogFiredTotal);
      expect(watchdogAfter - watchdogBefore).toBe(hangCount);
      expect(mockAgentRunRegistry.abort).toHaveBeenCalledTimes(hangCount);

      // Gauge reflects a fully-drained executor.
      expect(await metricValue(agentActiveSlots)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never exceeds the configured concurrency ceiling under a burst', async () => {
    vi.useFakeTimers();
    try {
      const maxConcurrent = 4;
      let peakActive = 0;

      const parentRun = { ...mockAgentRun, id: 'parent', parentAgentRunId: null };
      mockAgentRunRepo.findById.mockImplementation((id: string) =>
        id === 'parent'
          ? Promise.resolve(parentRun)
          : Promise.resolve({ ...mockAgentRun, id, parentAgentRunId: 'parent' }),
      );

      // Each run holds its slot for a spread of durations; sample the live slot
      // count on every start to catch any transient over-subscription.
      mockAgentRunner.run.mockImplementation((opts: { agentRunId: string }) => {
        peakActive = Math.max(peakActive, service.activeCount);
        const idx = Number(opts.agentRunId.slice(1));
        return new Promise<RunResult>((resolve) =>
          setTimeout(() => resolve(makeRunResult(opts.agentRunId)), 100 * (1 + (idx % 5))),
        );
      });

      for (let i = 0; i < 30; i++) {
        service.submit(`c${i}`, {
          agentDefinitionId: 'agent-def-1',
          input: `task ${i}`,
          userId: 'user-1',
          sessionId: 'sess-parent',
          timeoutMs: 5000,
        });
      }

      await vi.runAllTimersAsync();

      expect(peakActive).toBeLessThanOrEqual(maxConcurrent);
      expect(service.activeCount).toBe(0);
      expect(service.pendingCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
