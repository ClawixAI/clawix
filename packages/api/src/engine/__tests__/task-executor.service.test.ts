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
import { BudgetTracker } from '../budget-tracker.js';
import type { AgentRunnerService } from '../agent-runner.service.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';
import type { SessionRepository } from '../../db/session.repository.js';
import type { RedisService } from '../../cache/redis.service.js';
import type { RedisPubSubService } from '../../cache/redis-pubsub.service.js';
import type { AgentDefinitionRepository } from '../../db/agent-definition.repository.js';
import { KEY_PREFIXES, DEFAULT_TTL, PUBSUB_CHANNELS } from '../../cache/cache.constants.js';
import type { RunResult } from '../agent-runner.types.js';

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeRunResult(agentRunId = 'run-1'): RunResult {
  return {
    agentRunId,
    sessionId: 'sess-1',
    output: 'done',
    status: 'completed',
    tokenUsage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      model: 'gpt-4',
      estimatedCostUsd: 0,
    },
  };
}

// ------------------------------------------------------------------ //
//  Test fixtures                                                      //
// ------------------------------------------------------------------ //

const mockSession = {
  id: 'sess-1',
  userId: 'user-1',
  agentDefinitionId: 'agent-def-1',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockAgentRun = {
  id: 'run-1',
  agentDefinitionId: 'agent-def-1',
  sessionId: 'sess-1',
  status: 'pending' as const,
  input: 'Hello!',
  output: null,
  error: null,
  tokenUsage: null,
  startedAt: new Date(),
  completedAt: null,
};

// ------------------------------------------------------------------ //
//  Tests                                                              //
// ------------------------------------------------------------------ //

describe('TaskExecutorService', () => {
  let service: TaskExecutorService;
  let mockAgentRunner: { run: ReturnType<typeof vi.fn> };
  let mockAgentRunRepo: {
    findAllByStatus: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    sumSessionTokenUsage: ReturnType<typeof vi.fn>;
  };
  let mockSessionRepo: { findById: ReturnType<typeof vi.fn> };
  let mockRedis: {
    lpush: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
    setNx: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    lmove: ReturnType<typeof vi.fn>;
    lrem: ReturnType<typeof vi.fn>;
    llen: ReturnType<typeof vi.fn>;
    lrange: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    getClient: ReturnType<typeof vi.fn>;
  };
  let mockPubsub: {
    publish: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  let mockAgentDefRepo: { findById: ReturnType<typeof vi.fn> };
  let mockAgentRunRegistry: { abort: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    process.env['MAX_CONCURRENT_AGENTS'] = '2';
    process.env['MAX_PENDING_AGENTS'] = '3';

    mockAgentRunner = { run: vi.fn().mockResolvedValue(makeRunResult()) };

    mockAgentRunRepo = {
      findAllByStatus: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ ...mockAgentRun }),
      findById: vi.fn().mockResolvedValue(mockAgentRun),
      sumSessionTokenUsage: vi.fn().mockResolvedValue(0),
    };

    mockSessionRepo = {
      findById: vi.fn().mockResolvedValue(mockSession),
    };

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
      findById: vi.fn().mockResolvedValue({ id: 'agent-def-1', name: 'test-agent' }),
    };

    mockAgentRunRegistry = { abort: vi.fn().mockReturnValue(true) };

    service = new TaskExecutorService(
      mockAgentRunner as unknown as AgentRunnerService,
      mockAgentRunRepo as unknown as AgentRunRepository,
      mockSessionRepo as unknown as SessionRepository,
      mockRedis as unknown as RedisService,
      mockPubsub as unknown as RedisPubSubService,
      mockAgentDefRepo as unknown as AgentDefinitionRepository,
      mockAgentRunRegistry as unknown as import('../agent-run-registry.service.js').AgentRunRegistry,
    );
  });

  afterEach(() => {
    delete process.env['MAX_CONCURRENT_AGENTS'];
    delete process.env['MAX_PENDING_AGENTS'];
  });

  // ---------------------------------------------------------------- //
  //  describe('submit')                                               //
  // ---------------------------------------------------------------- //

  describe('submit', () => {
    it('executes task immediately when under concurrency limit', async () => {
      service.submit('run-1', {
        agentDefinitionId: 'agent-def-1',
        input: 'Hello!',
        userId: 'user-1',
        sessionId: 'sess-1',
      });

      // Allow microtask queue to flush
      await Promise.resolve();

      expect(mockAgentRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          agentDefinitionId: 'agent-def-1',
          input: 'Hello!',
          userId: 'user-1',
          sessionId: 'sess-1',
          isSubAgent: true,
          agentRunId: 'run-1',
        }),
      );
    });

    it('queues task when at concurrency limit', async () => {
      // Fill up concurrency slots with never-resolving tasks
      const deferred1 = createDeferred<RunResult>();
      const deferred2 = createDeferred<RunResult>();
      mockAgentRunner.run
        .mockReturnValueOnce(deferred1.promise)
        .mockReturnValueOnce(deferred2.promise);

      service.submit('run-1', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 1',
        userId: 'user-1',
        sessionId: 'sess-1',
      });
      service.submit('run-2', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 2',
        userId: 'user-1',
        sessionId: 'sess-1',
      });

      await Promise.resolve();

      // Both slots filled — submit a third
      service.submit('run-3', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 3',
        userId: 'user-1',
        sessionId: 'sess-1',
      });

      // run-3 should be queued but not yet started
      expect(mockAgentRunner.run).toHaveBeenCalledTimes(2);
      expect(service.pendingCount).toBe(1);

      // Resolve deferred cleanup
      deferred1.resolve(makeRunResult('run-1'));
      deferred2.resolve(makeRunResult('run-2'));
    });

    it('forwards abortSignal from SubmitOptions into agentRunner.run', async () => {
      const controller = new AbortController();

      service.submit('run-signal', {
        agentDefinitionId: 'agent-def-1',
        input: 'Hello!',
        userId: 'user-1',
        sessionId: 'sess-1',
        abortSignal: controller.signal,
      });

      await Promise.resolve();

      expect(mockAgentRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          agentRunId: 'run-signal',
          isSubAgent: true,
          abortSignal: controller.signal,
        }),
      );
    });

    it('rejects and fails AgentRun when queue is full (MAX_PENDING_AGENTS)', async () => {
      // Fill concurrency (2 active)
      const deferred1 = createDeferred<RunResult>();
      const deferred2 = createDeferred<RunResult>();
      mockAgentRunner.run
        .mockReturnValueOnce(deferred1.promise)
        .mockReturnValueOnce(deferred2.promise);

      service.submit('run-1', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 1',
        userId: 'user-1',
        sessionId: 'sess-1',
      });
      service.submit('run-2', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 2',
        userId: 'user-1',
        sessionId: 'sess-1',
      });
      await Promise.resolve();

      // Fill pending queue (MAX_PENDING_AGENTS = 3)
      service.submit('run-3', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 3',
        userId: 'user-1',
        sessionId: 'sess-1',
      });
      service.submit('run-4', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 4',
        userId: 'user-1',
        sessionId: 'sess-1',
      });
      service.submit('run-5', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 5',
        userId: 'user-1',
        sessionId: 'sess-1',
      });

      // Submitting one more should reject (queue full)
      service.submit('run-overflow', {
        agentDefinitionId: 'agent-def-1',
        input: 'overflow task',
        userId: 'user-1',
        sessionId: 'sess-1',
      });

      await Promise.resolve();

      // Should have called update to fail the overflow run
      expect(mockAgentRunRepo.update).toHaveBeenCalledWith(
        'run-overflow',
        expect.objectContaining({ status: 'failed' }),
      );

      // Cleanup deferreds
      deferred1.resolve(makeRunResult('run-1'));
      deferred2.resolve(makeRunResult('run-2'));
    });
  });

  // ---------------------------------------------------------------- //
  //  describe('drain')                                               //
  // ---------------------------------------------------------------- //

  describe('drain', () => {
    it('starts queued tasks when slots become available', async () => {
      const deferred1 = createDeferred<RunResult>();
      mockAgentRunner.run
        .mockReturnValueOnce(deferred1.promise)
        .mockReturnValueOnce(new Promise(() => {})) // run-2 never resolves in this test
        .mockResolvedValue(makeRunResult('run-3')); // run-3 resolves

      // Fill one slot
      service.submit('run-1', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 1',
        userId: 'user-1',
        sessionId: 'sess-1',
      });
      service.submit('run-2', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 2',
        userId: 'user-1',
        sessionId: 'sess-1',
      });
      await Promise.resolve();

      // Queue a third task
      service.submit('run-3', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 3',
        userId: 'user-1',
        sessionId: 'sess-1',
      });

      expect(service.pendingCount).toBe(1);

      // Resolve slot 1 — should trigger drain and start run-3
      deferred1.resolve(makeRunResult('run-1'));
      // Let microtasks flush
      await new Promise((r) => setTimeout(r, 0));

      expect(mockAgentRunner.run).toHaveBeenCalledTimes(3);
      expect(service.pendingCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------- //
  //  describe('executeTask')                                         //
  // ---------------------------------------------------------------- //

  describe('executeTask', () => {
    it('calls agentRunner.run with isSubAgent true and agentRunId', async () => {
      service.submit('run-1', {
        agentDefinitionId: 'agent-def-1',
        input: 'Hello!',
        userId: 'user-1',
        sessionId: 'sess-1',
      });

      await new Promise((r) => setTimeout(r, 0));

      expect(mockAgentRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          isSubAgent: true,
          agentRunId: 'run-1',
        }),
      );
    });

    it('decrements activeCount after completion', async () => {
      const deferred = createDeferred<RunResult>();
      mockAgentRunner.run.mockReturnValueOnce(deferred.promise);

      service.submit('run-1', {
        agentDefinitionId: 'agent-def-1',
        input: 'Hello!',
        userId: 'user-1',
        sessionId: 'sess-1',
      });

      await Promise.resolve();
      expect(service.activeCount).toBe(1);

      deferred.resolve(makeRunResult('run-1'));
      await new Promise((r) => setTimeout(r, 0));

      expect(service.activeCount).toBe(0);
    });

    it('passes the policy-resolved timeoutMs through to agentRunner.run', async () => {
      service.submit('run-1', {
        agentDefinitionId: 'agent-def-1',
        input: 'Hello!',
        userId: 'user-1',
        sessionId: 'sess-1',
        timeoutMs: 12345,
      });

      await Promise.resolve();

      expect(mockAgentRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({ agentRunId: 'run-1', timeoutMs: 12345 }),
      );
    });

    it('falls back to the default sub-agent timeout when none is supplied', async () => {
      service.submit('run-1', {
        agentDefinitionId: 'agent-def-1',
        input: 'Hello!',
        userId: 'user-1',
        sessionId: 'sess-1',
      });

      await Promise.resolve();

      expect(mockAgentRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({ agentRunId: 'run-1', timeoutMs: 300000 }),
      );
    });
  });

  // ---------------------------------------------------------------- //
  //  describe('watchdog')                                            //
  // ---------------------------------------------------------------- //

  describe('watchdog', () => {
    it('aborts a stuck sub-agent, reports failure to the parent, and frees the slot', async () => {
      vi.useFakeTimers();
      try {
        const childRun = {
          ...mockAgentRun,
          id: 'run-stuck',
          parentAgentRunId: 'run-parent',
          agentDefinitionId: 'agent-def-1',
        };
        const parentRun = {
          ...mockAgentRun,
          id: 'run-parent',
          sessionId: 'sess-parent',
          parentAgentRunId: null,
        };
        mockAgentRunRepo.findById.mockResolvedValueOnce(childRun).mockResolvedValueOnce(parentRun);
        // Run never settles — simulates a tool that ignores the abort signal.
        mockAgentRunner.run.mockReturnValueOnce(new Promise<RunResult>(() => {}));

        service.submit('run-stuck', {
          agentDefinitionId: 'agent-def-1',
          input: 'build an app',
          userId: 'user-1',
          sessionId: 'sess-parent',
          timeoutMs: 1000,
        });

        expect(service.activeCount).toBe(1);

        // Advance past timeoutMs (1000) + watchdog grace (30000).
        await vi.advanceTimersByTimeAsync(31_001);

        expect(mockAgentRunRegistry.abort).toHaveBeenCalledWith('run-stuck', 'watchdog_timeout');
        expect(mockAgentRunRepo.update).toHaveBeenCalledWith(
          'run-stuck',
          expect.objectContaining({ status: 'failed' }),
        );

        const queueKey = `${KEY_PREFIXES.agentResults}sess-parent`;
        expect(mockRedis.lpush).toHaveBeenCalledWith(queueKey, expect.any(String));
        const published = JSON.parse(mockRedis.lpush.mock.calls[0]![1] as string) as {
          status: string;
        };
        expect(published.status).toBe('failed');

        expect(service.activeCount).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ---------------------------------------------------------------- //
  //  describe('watchdog races')                                      //
  // ---------------------------------------------------------------- //

  describe('watchdog races', () => {
    // The `settled` latch (task-executor.service.ts:318/350/357) is the subtle
    // invariant: exactly one of {watchdog, resolve, reject} may finalize a run.
    // These cover the branches the happy-path tests never exercise.

    it('finalizes exactly once when the run settles after the watchdog already fired', async () => {
      vi.useFakeTimers();
      try {
        const childRun = {
          ...mockAgentRun,
          id: 'run-late',
          parentAgentRunId: 'run-parent',
          agentDefinitionId: 'agent-def-1',
        };
        const parentRun = {
          ...mockAgentRun,
          id: 'run-parent',
          sessionId: 'sess-parent',
          parentAgentRunId: null,
        };
        mockAgentRunRepo.findById.mockImplementation((id: string) =>
          id === 'run-parent' ? Promise.resolve(parentRun) : Promise.resolve(childRun),
        );

        // Deferred so we can let the run settle *after* the watchdog fires.
        const deferred = createDeferred<RunResult>();
        mockAgentRunner.run.mockReturnValueOnce(deferred.promise);

        service.submit('run-late', {
          agentDefinitionId: 'agent-def-1',
          input: 'build an app',
          userId: 'user-1',
          sessionId: 'sess-parent',
          timeoutMs: 1000,
        });

        expect(service.activeCount).toBe(1);

        // Watchdog fires (timeoutMs 1000 + grace 30000), taking the settle latch.
        await vi.advanceTimersByTimeAsync(31_001);
        expect(mockAgentRunRegistry.abort).toHaveBeenCalledWith('run-late', 'watchdog_timeout');
        expect(service.activeCount).toBe(0);
        const lpushCallsAfterWatchdog = mockRedis.lpush.mock.calls.length;
        const updateCallsAfterWatchdog = mockAgentRunRepo.update.mock.calls.length;

        // The orphaned run finally resolves — the `if (settled) return` guard
        // must make this a complete no-op: no double finalize, no success publish.
        deferred.resolve(makeRunResult('run-late'));
        await vi.advanceTimersByTimeAsync(1);

        // finalize() ran once, not twice — activeCount stays 0 rather than -1.
        expect(service.activeCount).toBe(0);
        // No second (success) result published on top of the watchdog's failure.
        expect(mockRedis.lpush.mock.calls.length).toBe(lpushCallsAfterWatchdog);
        // No later 'completed' write clobbering the watchdog's 'failed' write.
        expect(mockAgentRunRepo.update.mock.calls.length).toBe(updateCallsAfterWatchdog);
        expect(mockAgentRunRepo.update).toHaveBeenCalledWith(
          'run-late',
          expect.objectContaining({ status: 'failed' }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('frees the slot and clears the watchdog when the run rejects', async () => {
      vi.useFakeTimers();
      try {
        const childRun = {
          ...mockAgentRun,
          id: 'run-reject',
          parentAgentRunId: 'run-parent',
          agentDefinitionId: 'agent-def-1',
        };
        const parentRun = {
          ...mockAgentRun,
          id: 'run-parent',
          sessionId: 'sess-parent',
          parentAgentRunId: null,
        };
        mockAgentRunRepo.findById.mockImplementation((id: string) =>
          id === 'run-parent' ? Promise.resolve(parentRun) : Promise.resolve(childRun),
        );

        const deferred = createDeferred<RunResult>();
        mockAgentRunner.run.mockReturnValueOnce(deferred.promise);

        service.submit('run-reject', {
          agentDefinitionId: 'agent-def-1',
          input: 'build an app',
          userId: 'user-1',
          sessionId: 'sess-parent',
          timeoutMs: 1000,
        });

        expect(service.activeCount).toBe(1);

        // agentRunner.run rejects — the catch branch must finalize (free the slot)
        // and publish a failure to the parent.
        deferred.reject(new Error('agent runner blew up'));
        await vi.advanceTimersByTimeAsync(1);

        expect(service.activeCount).toBe(0);
        const queueKey = `${KEY_PREFIXES.agentResults}sess-parent`;
        expect(mockRedis.lpush).toHaveBeenCalledWith(queueKey, expect.any(String));
        const published = JSON.parse(mockRedis.lpush.mock.calls[0]![1] as string) as {
          status: string;
        };
        expect(published.status).toBe('failed');

        // The watchdog must have been cleared on the reject path — advancing past
        // its window must NOT fire it (no double abort / double finalize).
        mockAgentRunRegistry.abort.mockClear();
        await vi.advanceTimersByTimeAsync(31_001);
        expect(mockAgentRunRegistry.abort).not.toHaveBeenCalled();
        expect(service.activeCount).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ---------------------------------------------------------------- //
  //  describe('progress forwarding')                                 //
  // ---------------------------------------------------------------- //

  describe('progress forwarding', () => {
    it('forwards throttled progress to the parent channel', async () => {
      // Run never settles so the captured onProgress stays callable.
      mockAgentRunner.run.mockReturnValueOnce(new Promise<RunResult>(() => {}));

      service.submit('run-1', {
        agentDefinitionId: 'agent-def-1',
        input: 'do work',
        userId: 'user-1',
        sessionId: 'sess-parent',
        displayName: 'coder',
      });

      await Promise.resolve();

      const call = mockAgentRunner.run.mock.calls[0]![0] as {
        onProgress?: (hint: string) => void;
      };
      expect(typeof call.onProgress).toBe('function');

      call.onProgress!('shell(npm install)');
      call.onProgress!('shell(ls)'); // throttled — same tick
      await Promise.resolve();

      const progressPublishes = mockPubsub.publish.mock.calls.filter(
        (c: unknown[]) => c[0] === PUBSUB_CHANNELS.channelResponseReady,
      );
      expect(progressPublishes).toHaveLength(1);
      expect(progressPublishes[0]![1]).toEqual({
        sessionId: 'sess-parent',
        output: expect.stringContaining('coder is working'),
      });
    });
  });

  // ---------------------------------------------------------------- //
  //  describe('onModuleInit')                                        //
  // ---------------------------------------------------------------- //

  describe('onModuleInit', () => {
    it('recovers pending AgentRuns from database', async () => {
      const pendingRun = {
        ...mockAgentRun,
        id: 'run-pending',
        sessionId: 'sess-1',
        agentDefinitionId: 'agent-def-1',
        input: 'recover me',
        status: 'pending' as const,
      };
      mockAgentRunRepo.findAllByStatus.mockResolvedValue([pendingRun]);
      mockSessionRepo.findById.mockResolvedValue({ ...mockSession, id: 'sess-1' });

      await service.onModuleInit();

      // Allow tasks to start
      await new Promise((r) => setTimeout(r, 0));

      expect(mockAgentRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          agentRunId: 'run-pending',
          agentDefinitionId: 'agent-def-1',
          input: 'recover me',
          userId: 'user-1',
          sessionId: 'sess-1',
          isSubAgent: true,
        }),
      );
    });

    it('does nothing when no pending runs exist', async () => {
      mockAgentRunRepo.findAllByStatus.mockResolvedValue([]);

      await service.onModuleInit();

      await new Promise((r) => setTimeout(r, 0));

      expect(mockAgentRunner.run).not.toHaveBeenCalled();
    });

    it('handles errors gracefully when session not found', async () => {
      const pendingRun = {
        ...mockAgentRun,
        id: 'run-bad-session',
        sessionId: 'sess-missing',
      };
      mockAgentRunRepo.findAllByStatus.mockResolvedValue([pendingRun]);
      mockSessionRepo.findById.mockRejectedValue(new Error('Session not found'));

      // Should not throw
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('skips a whole session group when its session lookup fails, still recovering others', async () => {
      // A missing session means no userId to run under, so the entire group is
      // unrecoverable — the broad skip is intentional. Other sessions are
      // unaffected.
      const badRun = { ...mockAgentRun, id: 'bad-1', sessionId: 'sess-gone', tokenBudget: null };
      const goodRun = { ...mockAgentRun, id: 'good-1', sessionId: 'sess-ok', tokenBudget: null };
      mockAgentRunRepo.findAllByStatus.mockResolvedValue([badRun, goodRun]);
      mockSessionRepo.findById.mockImplementation((id: string) =>
        id === 'sess-ok'
          ? Promise.resolve({ ...mockSession, id: 'sess-ok' })
          : Promise.reject(new Error('Session not found')),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 0));

      const submittedIds = mockAgentRunner.run.mock.calls.map(
        (c: unknown[]) => (c[0] as { agentRunId: string }).agentRunId,
      );
      expect(submittedIds).toContain('good-1');
      expect(submittedIds).not.toContain('bad-1');
    });

    it('reconstructs a BudgetTracker from persisted budget on recovery', async () => {
      const pendingRun = {
        ...mockAgentRun,
        id: 'run-with-budget',
        sessionId: 'sess-1',
        tokenBudget: 5000,
        tokenGracePercent: 25,
      };
      mockAgentRunRepo.findAllByStatus.mockResolvedValue([pendingRun]);
      mockSessionRepo.findById.mockResolvedValue({ ...mockSession, id: 'sess-1' });

      await service.onModuleInit();
      await new Promise((r) => setTimeout(r, 0));

      const call = mockAgentRunner.run.mock.calls[0]![0] as {
        budgetTracker?: { budget: number | null; gracePercent: number };
      };
      expect(call.budgetTracker).toBeDefined();
      expect(call.budgetTracker?.budget).toBe(5000);
      expect(call.budgetTracker?.gracePercent).toBe(25);
    });

    it('does not pass a tracker when the persisted budget is null', async () => {
      const pendingRun = {
        ...mockAgentRun,
        id: 'run-no-budget',
        sessionId: 'sess-1',
        tokenBudget: null,
        tokenGracePercent: null,
      };
      mockAgentRunRepo.findAllByStatus.mockResolvedValue([pendingRun]);
      mockSessionRepo.findById.mockResolvedValue({ ...mockSession, id: 'sess-1' });

      await service.onModuleInit();
      await new Promise((r) => setTimeout(r, 0));

      const call = mockAgentRunner.run.mock.calls[0]![0] as { budgetTracker?: unknown };
      expect(call.budgetTracker).toBeUndefined();
    });

    it('shares one seeded tracker across all recovered siblings of a session', async () => {
      const runA = {
        ...mockAgentRun,
        id: 'run-a',
        sessionId: 'sess-swarm',
        tokenBudget: 10000,
        tokenGracePercent: 10,
        input: 'a',
      };
      const runB = {
        ...mockAgentRun,
        id: 'run-b',
        sessionId: 'sess-swarm',
        tokenBudget: 10000,
        tokenGracePercent: 10,
        input: 'b',
      };
      mockAgentRunRepo.findAllByStatus.mockResolvedValue([runA, runB]);
      mockSessionRepo.findById.mockResolvedValue({ ...mockSession, id: 'sess-swarm' });
      // The swarm already spent 6000 tokens before the crash.
      mockAgentRunRepo.sumSessionTokenUsage.mockResolvedValue(6000);

      await service.onModuleInit();
      await new Promise((r) => setTimeout(r, 0));

      const trackers = mockAgentRunner.run.mock.calls
        .filter((c: unknown[]) => (c[0] as { sessionId?: string }).sessionId === 'sess-swarm')
        .map((c: unknown[]) => (c[0] as { budgetTracker?: BudgetTracker }).budgetTracker);

      expect(trackers).toHaveLength(2);
      // Both siblings share the SAME instance, so their post-recovery spend
      // accumulates together under one cap.
      expect(trackers[0]).toBeInstanceOf(BudgetTracker);
      expect(trackers[0]).toBe(trackers[1]);
      // Seeded from the swarm's prior spend, not reset to 0.
      expect(trackers[0]?.used).toBe(6000);
      expect(trackers[0]?.budget).toBe(10000);
      // Summed once per session, not once per run.
      expect(mockAgentRunRepo.sumSessionTokenUsage).toHaveBeenCalledWith('sess-swarm');
      expect(mockAgentRunRepo.sumSessionTokenUsage).toHaveBeenCalledTimes(1);
    });

    it('rebuilds independent trackers for distinct sessions', async () => {
      const run1 = {
        ...mockAgentRun,
        id: 'r1',
        sessionId: 'sess-1',
        tokenBudget: 1000,
        tokenGracePercent: 10,
      };
      const run2 = {
        ...mockAgentRun,
        id: 'r2',
        sessionId: 'sess-2',
        tokenBudget: 2000,
        tokenGracePercent: 10,
      };
      mockAgentRunRepo.findAllByStatus.mockResolvedValue([run1, run2]);
      mockSessionRepo.findById.mockImplementation((id: string) =>
        Promise.resolve({ ...mockSession, id }),
      );
      mockAgentRunRepo.sumSessionTokenUsage.mockImplementation((sid: string) =>
        Promise.resolve(sid === 'sess-1' ? 100 : 500),
      );

      await service.onModuleInit();
      await new Promise((r) => setTimeout(r, 0));

      const trackerFor = (id: string): BudgetTracker | undefined =>
        mockAgentRunner.run.mock.calls
          .map((c: unknown[]) => c[0] as { agentRunId: string; budgetTracker?: BudgetTracker })
          .find((o) => o.agentRunId === id)?.budgetTracker;

      expect(trackerFor('r1')).not.toBe(trackerFor('r2'));
      expect(trackerFor('r1')?.used).toBe(100);
      expect(trackerFor('r2')?.used).toBe(500);
    });
  });

  // ---------------------------------------------------------------- //
  //  describe('properties')                                          //
  // ---------------------------------------------------------------- //

  describe('properties', () => {
    it('reports correct activeCount', async () => {
      const deferred = createDeferred<RunResult>();
      mockAgentRunner.run.mockReturnValue(deferred.promise);

      expect(service.activeCount).toBe(0);

      service.submit('run-1', {
        agentDefinitionId: 'agent-def-1',
        input: 'task',
        userId: 'user-1',
        sessionId: 'sess-1',
      });

      await Promise.resolve();

      expect(service.activeCount).toBe(1);

      deferred.resolve(makeRunResult('run-1'));
    });

    it('reports correct pendingCount', async () => {
      // Fill active slots (limit = 2)
      const deferred1 = createDeferred<RunResult>();
      const deferred2 = createDeferred<RunResult>();
      mockAgentRunner.run
        .mockReturnValueOnce(deferred1.promise)
        .mockReturnValueOnce(deferred2.promise);

      service.submit('run-1', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 1',
        userId: 'user-1',
        sessionId: 'sess-1',
      });
      service.submit('run-2', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 2',
        userId: 'user-1',
        sessionId: 'sess-1',
      });
      await Promise.resolve();

      expect(service.pendingCount).toBe(0);

      service.submit('run-3', {
        agentDefinitionId: 'agent-def-1',
        input: 'task 3',
        userId: 'user-1',
        sessionId: 'sess-1',
      });

      expect(service.pendingCount).toBe(1);

      deferred1.resolve(makeRunResult('run-1'));
      deferred2.resolve(makeRunResult('run-2'));
    });
  });

  // ---------------------------------------------------------------- //
  //  describe('result publishing')                                    //
  // ---------------------------------------------------------------- //

  describe('result publishing', () => {
    it('publishes result to Redis when sub-agent has a parent', async () => {
      const childRun = {
        ...mockAgentRun,
        id: 'run-child',
        parentAgentRunId: 'run-parent',
        agentDefinitionId: 'agent-def-1',
      };
      const parentRun = {
        ...mockAgentRun,
        id: 'run-parent',
        sessionId: 'sess-parent',
        parentAgentRunId: null,
      };
      mockAgentRunRepo.findById.mockResolvedValueOnce(childRun).mockResolvedValueOnce(parentRun);

      service.submit('run-child', {
        agentDefinitionId: 'agent-def-1',
        input: 'do work',
        userId: 'user-1',
        sessionId: 'sess-parent',
      });
      await new Promise((r) => setTimeout(r, 50));

      const queueKey = `${KEY_PREFIXES.agentResults}sess-parent`;
      expect(mockRedis.lpush).toHaveBeenCalledWith(queueKey, expect.any(String));
      expect(mockRedis.expire).toHaveBeenCalledWith(queueKey, DEFAULT_TTL.agentResults);
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        PUBSUB_CHANNELS.agentResultReady,
        'sess-parent',
      );
    });

    it('does not publish when sub-agent has no parent', async () => {
      mockAgentRunRepo.findById.mockResolvedValue({
        ...mockAgentRun,
        parentAgentRunId: null,
      });

      service.submit('run-1', {
        agentDefinitionId: 'agent-def-1',
        input: 'do work',
        userId: 'user-1',
        sessionId: 'sess-1',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockRedis.lpush).not.toHaveBeenCalled();
    });

    it('publishes failure result when sub-agent fails and has a parent', async () => {
      const childRun = {
        ...mockAgentRun,
        id: 'run-child',
        parentAgentRunId: 'run-parent',
        agentDefinitionId: 'agent-def-1',
      };
      const parentRun = {
        ...mockAgentRun,
        id: 'run-parent',
        sessionId: 'sess-parent',
        parentAgentRunId: null,
      };
      mockAgentRunRepo.findById.mockResolvedValueOnce(childRun).mockResolvedValueOnce(parentRun);
      mockAgentRunner.run.mockRejectedValue(new Error('agent crashed'));

      service.submit('run-child', {
        agentDefinitionId: 'agent-def-1',
        input: 'do work',
        userId: 'user-1',
        sessionId: 'sess-parent',
      });
      await new Promise((r) => setTimeout(r, 50));

      const queueKey = `${KEY_PREFIXES.agentResults}sess-parent`;
      expect(mockRedis.lpush).toHaveBeenCalledWith(queueKey, expect.any(String));
      const publishedJson = mockRedis.lpush.mock.calls[0]![1] as string;
      const published = JSON.parse(publishedJson) as { status: string; error: string };
      expect(published.status).toBe('failed');
      expect(published.error).toBe('agent crashed');
    });
  });

  // ---------------------------------------------------------------- //
  //  describe('result delivery')                                      //
  // ---------------------------------------------------------------- //

  describe('result delivery', () => {
    it('subscribes to result-ready channel on module init', async () => {
      await service.onModuleInit();
      expect(mockPubsub.subscribe).toHaveBeenCalledWith(
        PUBSUB_CHANNELS.agentResultReady,
        expect.any(Function),
      );
    });

    it('delivers result by re-invoking parent agent', async () => {
      const parentRun = {
        id: 'run-parent',
        agentDefinitionId: 'agent-def-1',
        sessionId: 'sess-parent',
        parentAgentRunId: null,
      };
      mockAgentRunRepo.findById.mockResolvedValue(parentRun);
      mockRedis.setNx.mockResolvedValue(true);
      mockRedis.lmove
        .mockResolvedValueOnce(
          JSON.stringify({
            agentRunId: 'run-child',
            parentAgentRunId: 'run-parent',
            agentName: 'researcher',
            output: 'Research findings...',
            status: 'completed',
            error: null,
          }),
        )
        .mockResolvedValueOnce(null);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.llen.mockResolvedValue(0);
      mockSessionRepo.findById.mockResolvedValue({
        ...mockSession,
        id: 'sess-parent',
        userId: 'user-1',
      });

      await service.onModuleInit();
      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: string;
      }) => void;
      await subscribeCb({ payload: 'sess-parent' });
      await new Promise((r) => setTimeout(r, 100));

      const reinvocationCalls = mockAgentRunner.run.mock.calls.filter(
        (call: unknown[]) => (call[0] as { isReinvocation?: boolean }).isReinvocation,
      );
      expect(reinvocationCalls).toHaveLength(1);
      const input = (reinvocationCalls[0]![0] as { input: string }).input;
      expect(input).toContain('[Sub-Agent Result]');
      expect(input).toContain('researcher');
    });

    it('respects reinvocation cap', async () => {
      process.env['MAX_REINVOCATIONS'] = '2';
      service = new TaskExecutorService(
        mockAgentRunner as unknown as AgentRunnerService,
        mockAgentRunRepo as unknown as AgentRunRepository,
        mockSessionRepo as unknown as SessionRepository,
        mockRedis as unknown as RedisService,
        mockPubsub as unknown as RedisPubSubService,
        mockAgentDefRepo as unknown as AgentDefinitionRepository,
        mockAgentRunRegistry as unknown as import('../agent-run-registry.service.js').AgentRunRegistry,
      );

      mockAgentRunRepo.findById.mockResolvedValue({
        id: 'run-parent',
        agentDefinitionId: 'agent-def-1',
        sessionId: 'sess-parent',
        parentAgentRunId: null,
      });
      mockRedis.setNx.mockResolvedValue(true);
      mockRedis.lmove.mockResolvedValue(
        JSON.stringify({
          agentRunId: 'run-child',
          parentAgentRunId: 'run-parent',
          agentName: 'worker',
          output: 'result',
          status: 'completed',
          error: null,
        }),
      );
      mockRedis.incr.mockResolvedValue(3); // over limit of 2
      mockRedis.llen.mockResolvedValue(0);

      await service.onModuleInit();
      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: string;
      }) => void;
      await subscribeCb({ payload: 'sess-parent' });
      await new Promise((r) => setTimeout(r, 100));

      const reinvocationCalls = mockAgentRunner.run.mock.calls.filter(
        (call: unknown[]) => (call[0] as { isReinvocation?: boolean }).isReinvocation,
      );
      expect(reinvocationCalls).toHaveLength(0);
      delete process.env['MAX_REINVOCATIONS'];
    });

    it('publishes channelResponseReady after successful re-invocation', async () => {
      const parentRun = {
        id: 'run-parent',
        agentDefinitionId: 'agent-def-1',
        sessionId: 'sess-parent',
        parentAgentRunId: null,
      };
      mockAgentRunRepo.findById.mockResolvedValue(parentRun);
      mockRedis.setNx.mockResolvedValue(true);
      mockRedis.lmove
        .mockResolvedValueOnce(
          JSON.stringify({
            agentRunId: 'run-child',
            parentAgentRunId: 'run-parent',
            agentName: 'researcher',
            output: 'Research findings...',
            status: 'completed',
            error: null,
          }),
        )
        .mockResolvedValueOnce(null);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.llen.mockResolvedValue(0);
      mockSessionRepo.findById.mockResolvedValue({
        ...mockSession,
        id: 'sess-parent',
        userId: 'user-1',
      });

      const reinvocationResult = makeRunResult('run-reinvoke');
      mockAgentRunner.run.mockResolvedValue(reinvocationResult);

      await service.onModuleInit();
      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: string;
      }) => void;
      await subscribeCb({ payload: 'sess-parent' });
      await new Promise((r) => setTimeout(r, 100));

      expect(mockPubsub.publish).toHaveBeenCalledWith(PUBSUB_CHANNELS.channelResponseReady, {
        sessionId: 'sess-parent',
        output: 'done',
      });
    });

    it('does not publish channelResponseReady when re-invocation has no output', async () => {
      const parentRun = {
        id: 'run-parent',
        agentDefinitionId: 'agent-def-1',
        sessionId: 'sess-parent',
        parentAgentRunId: null,
      };
      mockAgentRunRepo.findById.mockResolvedValue(parentRun);
      mockRedis.setNx.mockResolvedValue(true);
      mockRedis.lmove
        .mockResolvedValueOnce(
          JSON.stringify({
            agentRunId: 'run-child',
            parentAgentRunId: 'run-parent',
            agentName: 'researcher',
            output: 'done',
            status: 'completed',
            error: null,
          }),
        )
        .mockResolvedValueOnce(null);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.llen.mockResolvedValue(0);
      mockSessionRepo.findById.mockResolvedValue({
        ...mockSession,
        id: 'sess-parent',
        userId: 'user-1',
      });

      mockAgentRunner.run.mockResolvedValue({
        ...makeRunResult('run-reinvoke'),
        output: null,
      });

      await service.onModuleInit();
      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: string;
      }) => void;
      await subscribeCb({ payload: 'sess-parent' });
      await new Promise((r) => setTimeout(r, 100));

      expect(mockPubsub.publish).not.toHaveBeenCalledWith(
        PUBSUB_CHANNELS.channelResponseReady,
        expect.anything(),
      );
    });

    it('delivers both completed and failed child results to the parent (partial failure)', async () => {
      const parentRun = {
        id: 'run-parent',
        agentDefinitionId: 'agent-def-1',
        sessionId: 'sess-parent',
        parentAgentRunId: null,
      };
      mockAgentRunRepo.findById.mockResolvedValue(parentRun);
      mockSessionRepo.findById.mockResolvedValue({
        ...mockSession,
        id: 'sess-parent',
        userId: 'user-1',
      });
      mockRedis.setNx.mockResolvedValue(true);

      const completedRaw = JSON.stringify({
        agentRunId: 'run-child-ok',
        parentAgentRunId: 'run-parent',
        agentName: 'researcher',
        output: 'Research findings ready',
        status: 'completed',
        error: null,
      });
      const failedRaw = JSON.stringify({
        agentRunId: 'run-child-bad',
        parentAgentRunId: 'run-parent',
        agentName: 'coder',
        output: null,
        status: 'failed',
        error: 'compilation blew up',
      });
      // Two children resolve in sequence, then the queue drains.
      mockRedis.lmove
        .mockResolvedValueOnce(completedRaw)
        .mockResolvedValueOnce(failedRaw)
        .mockResolvedValueOnce(null);
      mockRedis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
      mockRedis.llen.mockResolvedValue(0);

      await service.onModuleInit();
      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: string;
      }) => void;
      await subscribeCb({ payload: 'sess-parent' });
      await new Promise((r) => setTimeout(r, 100));

      const reinvocationInputs = mockAgentRunner.run.mock.calls
        .filter((call: unknown[]) => (call[0] as { isReinvocation?: boolean }).isReinvocation)
        .map((call: unknown[]) => (call[0] as { input: string }).input);

      // Both children delivered — the failed one is NOT silently dropped.
      expect(reinvocationInputs).toHaveLength(2);
      const completedInjection = reinvocationInputs.find((i) => i.includes('researcher'));
      const failedInjection = reinvocationInputs.find((i) => i.includes('coder'));
      expect(completedInjection).toContain('Status: completed');
      expect(completedInjection).toContain('Research findings ready');
      expect(failedInjection).toContain('Status: failed');
      expect(failedInjection).toContain('compilation blew up');

      // Both processing entries removed — nothing stranded for crash recovery.
      const processingKey = `${KEY_PREFIXES.agentProcessing}sess-parent`;
      expect(mockRedis.lrem).toHaveBeenCalledWith(processingKey, 1, completedRaw);
      expect(mockRedis.lrem).toHaveBeenCalledWith(processingKey, 1, failedRaw);
    });

    it('does not start delivery when lock is held', async () => {
      mockRedis.setNx.mockResolvedValue(false);

      await service.onModuleInit();
      const subscribeCb = mockPubsub.subscribe.mock.calls[0]![1] as (msg: {
        payload: string;
      }) => void;
      await subscribeCb({ payload: 'sess-parent' });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockRedis.lmove).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- //
  //  describe('crash recovery')                                       //
  // ---------------------------------------------------------------- //

  describe('crash recovery', () => {
    it('moves items from processing lists back to result queues on startup', async () => {
      const processingKey = `${KEY_PREFIXES.agentProcessing}sess-recover`;
      const resultItem = JSON.stringify({
        agentRunId: 'run-orphan',
        parentAgentRunId: 'run-parent',
        agentName: 'worker',
        output: 'orphaned result',
        status: 'completed',
        error: null,
      });

      const mockScan = vi.fn().mockResolvedValueOnce(['0', [processingKey]]);
      mockRedis.getClient.mockReturnValue({ scan: mockScan });
      mockRedis.lrange.mockResolvedValue([resultItem]);
      mockRedis.lmove.mockResolvedValueOnce(resultItem).mockResolvedValueOnce(null);

      await service.onModuleInit();

      expect(mockRedis.lmove).toHaveBeenCalled();
      expect(mockPubsub.publish).toHaveBeenCalledWith(
        PUBSUB_CHANNELS.agentResultReady,
        'sess-recover',
      );
    });
  });
});
