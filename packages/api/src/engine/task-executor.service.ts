/**
 * TaskExecutorService — concurrency-limited async executor for sub-agent tasks.
 *
 * Responsibilities:
 * - Accept task submissions from the spawn tool
 * - Enforce MAX_CONCURRENT_AGENTS (active slots) and MAX_PENDING_AGENTS (queue depth)
 * - Run submitted tasks via AgentRunnerService with isSubAgent: true
 * - Recover pending AgentRun records from the database on module init
 * - Publish sub-agent results to Redis and re-invoke parent agents
 * - Crash recovery: move orphaned processing items back to result queues
 */

import { randomUUID } from 'node:crypto';

import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import type { AgentRunnerService } from './agent-runner.service.js';
import { BudgetTracker } from './budget-tracker.js';
import { AgentRunRepository } from '../db/agent-run.repository.js';
import { SessionRepository } from '../db/session.repository.js';
import { RedisService } from '../cache/redis.service.js';
import { RedisPubSubService } from '../cache/redis-pubsub.service.js';
import {
  KEY_PREFIXES,
  DEFAULT_TTL,
  PUBSUB_CHANNELS,
  SCAN_BATCH_SIZE,
} from '../cache/cache.constants.js';
import { AgentRunRegistry } from './agent-run-registry.service.js';
import { RunActivityRegistry } from './run-activity.registry.js';
import {
  agentActiveSlots,
  agentPendingQueue,
  agentMaxConcurrent,
  agentWatchdogFiredTotal,
} from './agent-loop-metrics.js';
import {
  SubAgentResultPublisher,
  type SubAgentResultPayload,
} from './sub-agent-result.publisher.js';

/** A pending AgentRun row as returned by the recovery query. */
type RecoverableRun = Awaited<ReturnType<AgentRunRepository['findAllByStatus']>>[number];

const logger = createLogger('engine:task-executor');

/**
 * Fallback wall-clock cap (ms) for a sub-agent run when the submit options
 * carry no policy-resolved timeout (e.g. an orphan recovered after a crash,
 * which has no parent/policy context). Overridable via SUBAGENT_TIMEOUT_MS.
 */
const DEFAULT_SUBAGENT_TIMEOUT_MS = (() => {
  const raw = parseInt(process.env['SUBAGENT_TIMEOUT_MS'] ?? '300000', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 300000;
})();

/**
 * Grace added on top of the run's own timeout before the executor's hard
 * watchdog fires. The reasoning loop should abort cleanly at `timeoutMs`; the
 * watchdog only fires if it cannot (e.g. a tool that ignores the abort signal),
 * forcibly freeing the slot and reporting failure to the parent.
 */
const SUBAGENT_WATCHDOG_GRACE_MS = 30_000;

/** Minimum spacing between progress heartbeats forwarded to the parent channel. */
const SUBAGENT_PROGRESS_THROTTLE_MS = 30_000;

/** How often the sweep retries results stuck in processing lists. */
const PROCESSING_SWEEP_INTERVAL_MS = 60_000;

/**
 * Max delivery attempts for one result payload before it is dropped (loudly).
 * Attempts are spaced by the sweep interval, so 5 attempts spans ~5 minutes.
 */
const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * Upper bound on results combined into one batch-drain reinvocation. Keeps a
 * single injection from growing unbounded; overflow is delivered by the next
 * wave iteration.
 */
const MAX_RESULTS_PER_WAVE = 20;

// ------------------------------------------------------------------ //
//  Types                                                              //
// ------------------------------------------------------------------ //

interface SubmitOptions {
  readonly agentDefinitionId: string;
  readonly input: string;
  readonly userId: string;
  readonly sessionId: string;
  /**
   * Shared budget tracker inherited from the spawning parent. In-memory only:
   * recovery from a persisted pending AgentRun cannot reattach the tracker, so
   * recovered tasks run unbounded (acceptable — they're orphans).
   */
  readonly budgetTracker?: BudgetTracker;
  /**
   * Optional parent abort signal. When fired, the sub-agent's run is
   * cancelled (its own effectiveSignal will trip via AbortSignal.any).
   * In-memory only — the recovery path (orphan runs) has no parent signal.
   */
  readonly abortSignal?: AbortSignal;
  /**
   * Wall-clock cap (ms) for the run, resolved from the spawning user's policy
   * (`Policy.maxSubAgentRunMs`). Drives both the reasoning loop's own timeout
   * and the executor's hard watchdog. Absent on the orphan-recovery path.
   */
  readonly timeoutMs?: number;
  /** Human-readable agent label, used to tag progress heartbeats to the parent. */
  readonly displayName?: string;
  /**
   * Per-user fairness quota resolved from the spawning user's policy
   * (`Policy.maxConcurrentSubAgents` / `maxPendingSubAgents`). Absent on the
   * orphan-recovery path — the USER_MAX_* env defaults apply instead.
   */
  readonly userQuota?: {
    readonly maxConcurrent: number;
    readonly maxPending: number;
  };
}

interface QueueItem {
  readonly agentRunId: string;
  readonly options: SubmitOptions;
}

// ------------------------------------------------------------------ //
//  TaskExecutorService                                                //
// ------------------------------------------------------------------ //

/**
 * Concurrency-limited executor that runs sub-agent tasks via AgentRunnerService.
 *
 * Limits are controlled by environment variables:
 * - MAX_CONCURRENT_AGENTS  (default: 10)  — max simultaneous running tasks
 * - MAX_PENDING_AGENTS     (default: 100) — max tasks waiting in the queue
 * - MAX_REINVOCATIONS      (default: 10)  — max re-invocations of a parent per session
 */
@Injectable()
export class TaskExecutorService implements OnModuleInit, OnModuleDestroy {
  private readonly maxConcurrent: number;
  private readonly maxPending: number;
  private readonly maxReinvocations: number;
  private readonly userMaxConcurrentDefault: number;
  private readonly userMaxPendingDefault: number;
  /**
   * Per-user FIFO queues drained round-robin so a heavy user competes only
   * with themselves for slots, never starving other users (D10). Users are
   * appended to `rotation` on first submit and never removed — bounded by
   * user count, and keeping the array stable keeps the rotation index sane.
   */
  private readonly userQueues = new Map<string, QueueItem[]>();
  private readonly userActive = new Map<string, number>();
  private readonly rotation: string[] = [];
  private rotationIdx = 0;
  private activeCount_ = 0;
  private sweepHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject('AgentRunnerService')
    private readonly agentRunner: AgentRunnerService,
    private readonly agentRunRepo: AgentRunRepository,
    private readonly sessionRepo: SessionRepository,
    private readonly redis: RedisService,
    private readonly pubsub: RedisPubSubService,
    private readonly agentRunRegistry: AgentRunRegistry,
    private readonly runActivity: RunActivityRegistry,
    private readonly resultPublisher: SubAgentResultPublisher,
  ) {
    this.maxConcurrent = parseInt(process.env['MAX_CONCURRENT_AGENTS'] ?? '10', 10);
    this.maxPending = parseInt(process.env['MAX_PENDING_AGENTS'] ?? '100', 10);
    const rawReinvocations = parseInt(process.env['MAX_REINVOCATIONS'] ?? '10', 10);
    this.maxReinvocations = rawReinvocations > 0 ? rawReinvocations : 10;
    this.userMaxConcurrentDefault = parseInt(process.env['USER_MAX_CONCURRENT_AGENTS'] ?? '3', 10);
    this.userMaxPendingDefault = parseInt(process.env['USER_MAX_PENDING_AGENTS'] ?? '20', 10);
    agentMaxConcurrent.set(this.maxConcurrent);
    this.syncSlotGauges();
  }

  /** Publish the current slot occupancy to Prometheus. Called on every count change. */
  private syncSlotGauges(): void {
    agentActiveSlots.set(this.activeCount_);
    agentPendingQueue.set(this.pendingCount);
  }

  /** Effective per-user quota for a queue item (policy-resolved or env default). */
  private quotaFor(options: SubmitOptions): { maxConcurrent: number; maxPending: number } {
    return (
      options.userQuota ?? {
        maxConcurrent: this.userMaxConcurrentDefault,
        maxPending: this.userMaxPendingDefault,
      }
    );
  }

  // ---------------------------------------------------------------- //
  //  Public properties                                               //
  // ---------------------------------------------------------------- //

  /** Number of tasks currently running. */
  get activeCount(): number {
    return this.activeCount_;
  }

  /** Number of tasks waiting across all user queues. */
  get pendingCount(): number {
    let total = 0;
    for (const queue of this.userQueues.values()) total += queue.length;
    return total;
  }

  // ---------------------------------------------------------------- //
  //  Public API                                                      //
  // ---------------------------------------------------------------- //

  /**
   * Submit a task for execution.
   *
   * If a concurrency slot is available, the task starts immediately.
   * If the active limit is reached, the task is queued.
   * If the queue is also full, the AgentRun is marked failed and the task is dropped.
   *
   * @param agentRunId - The pre-created AgentRun record to reuse.
   * @param options    - Run parameters (agentDefinitionId, input, userId, sessionId).
   */
  submit(agentRunId: string, options: SubmitOptions): void {
    const quota = this.quotaFor(options);
    const queue = this.userQueues.get(options.userId);

    // Global ceiling first (host capacity), then the per-user share (D7/D10) —
    // a heavy user exhausts their own queue depth, not everyone's.
    let rejection: string | null = null;
    if (this.pendingCount >= this.maxPending) {
      rejection = 'Task queue is full; task rejected';
    } else if ((queue?.length ?? 0) >= quota.maxPending) {
      rejection = `Your task queue is full (${quota.maxPending} pending tasks allowed by your plan); task rejected`;
    }

    if (rejection !== null) {
      logger.warn({ agentRunId, userId: options.userId, rejection }, 'Rejecting task');
      this.agentRunRepo
        .update(agentRunId, {
          status: 'failed',
          error: rejection,
          completedAt: new Date(),
        })
        .catch((err: unknown) => {
          logger.error({ agentRunId, err }, 'Failed to mark rejected AgentRun as failed');
        });
      // The spawn tool already told the parent this task was spawned, so a
      // silent drop would leave it waiting forever — publish the rejection.
      void this.resultPublisher.publishFailure(agentRunId, new Error(rejection));
      return;
    }

    let userQueue = this.userQueues.get(options.userId);
    if (!userQueue) {
      userQueue = [];
      this.userQueues.set(options.userId, userQueue);
      this.rotation.push(options.userId);
    }
    userQueue.push({ agentRunId, options });
    this.syncSlotGauges();
    this.drain();
  }

  /**
   * Remove a still-queued task from its user queue (task_cancel on a task
   * that never started). Returns false when the task is not queued — it is
   * already running (cancel via AgentRunRegistry.abort) or settled.
   */
  cancelQueued(agentRunId: string): boolean {
    for (const queue of this.userQueues.values()) {
      const idx = queue.findIndex((item) => item.agentRunId === agentRunId);
      if (idx >= 0) {
        queue.splice(idx, 1);
        this.syncSlotGauges();
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- //
  //  Lifecycle                                                       //
  // ---------------------------------------------------------------- //

  /**
   * On module init:
   * 1. Recover any AgentRuns that are still in 'pending' status
   * 2. Subscribe to the result-ready pub/sub channel
   * 3. Recover orphaned processing list items (crash recovery)
   */
  async onModuleInit(): Promise<void> {
    // 1. Recover pending AgentRuns from the database
    try {
      const pendingRuns = await this.agentRunRepo.findAllByStatus('pending');

      if (pendingRuns.length > 0) {
        logger.info({ count: pendingRuns.length }, 'Recovering pending AgentRuns on startup');

        // Group by session so all recovered siblings of one swarm share a
        // single BudgetTracker instance, seeded with the swarm's already-
        // recorded spend. Without this each orphan would get a fresh full
        // allowance and the swarm could collectively blow past its cap.
        const bySession = new Map<string, RecoverableRun[]>();
        for (const run of pendingRuns) {
          if (!run.sessionId) {
            // Cron runs have no session and no swarm to share a budget with.
            logger.warn({ agentRunId: run.id }, 'Skipping recovery for sessionless AgentRun');
            continue;
          }
          const group = bySession.get(run.sessionId);
          if (group) group.push(run);
          else bySession.set(run.sessionId, [run]);
        }

        for (const [sessionId, runs] of bySession) {
          try {
            await this.recoverSessionGroup(sessionId, runs);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(
              { sessionId, error: message },
              'Failed to recover pending AgentRun session group',
            );
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Error during pending AgentRun recovery');
    }

    // 2. Subscribe to result-ready notifications
    await this.pubsub.subscribe<string>(PUBSUB_CHANNELS.agentResultReady, (msg) => {
      const parentSessionId = msg.payload;
      if (typeof parentSessionId === 'string' && parentSessionId.length > 0) {
        void this.tryDeliverResults(parentSessionId);
      }
    });

    // 3. Crash recovery — move orphaned processing items back to result queues
    await this.recoverProcessingResults();

    // 4. Periodic sweep — retry results stuck in processing lists after a
    //    failed delivery, without requiring a process restart.
    this.sweepHandle = setInterval(() => {
      void this.sweepStuckProcessing();
    }, PROCESSING_SWEEP_INTERVAL_MS);
    if (typeof this.sweepHandle.unref === 'function') this.sweepHandle.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepHandle) {
      clearInterval(this.sweepHandle);
      this.sweepHandle = null;
    }
  }

  /**
   * Recover all pending runs belonging to one session (one swarm). Rebuilds a
   * single shared {@link BudgetTracker} seeded with the tokens the swarm already
   * spent before the crash, then re-submits every run against that shared
   * tracker so their combined post-recovery spend stays within the original cap.
   *
   * Throws if the session lookup fails; the caller catches and skips the WHOLE
   * group. That broad skip is intentional — a missing session means there is no
   * userId to run under, so none of the swarm's runs are recoverable anyway.
   */
  private async recoverSessionGroup(
    sessionId: string,
    runs: readonly RecoverableRun[],
  ): Promise<void> {
    const session = await this.sessionRepo.findById(sessionId);

    // The budget cap is shared across the whole swarm — every spawned child
    // inherits the parent's cap (see spawn.ts), so all budgeted siblings carry
    // the same tokenBudget/tokenGracePercent. We therefore take the cap from the
    // first run that persisted one and apply it to the shared tracker. A null
    // cap means no enforcement — no tracker.
    const budgeted = runs.find((r) => r.tokenBudget != null);
    let sharedTracker: BudgetTracker | undefined;
    if (budgeted?.tokenBudget != null) {
      const alreadySpent = await this.agentRunRepo.sumSessionTokenUsage(sessionId);
      sharedTracker = new BudgetTracker(
        budgeted.tokenBudget,
        budgeted.tokenGracePercent ?? 10,
        alreadySpent,
      );
      logger.info(
        { sessionId, budget: budgeted.tokenBudget, alreadySpent, recovered: runs.length },
        'Rebuilt shared swarm budget tracker seeded with prior spend',
      );
    }

    for (const run of runs) {
      this.submit(run.id, {
        agentDefinitionId: run.agentDefinitionId,
        input: run.input,
        userId: session.userId,
        sessionId,
        ...(sharedTracker ? { budgetTracker: sharedTracker } : {}),
      });
    }
  }

  // ---------------------------------------------------------------- //
  //  Private methods                                                 //
  // ---------------------------------------------------------------- //

  /**
   * Drain the user queues round-robin while global slots are available and
   * the picked user is under their own concurrent cap (D10 fairness): a user
   * saturating their quota is skipped, never blocking the users after them.
   */
  private drain(): void {
    while (this.activeCount_ < this.maxConcurrent) {
      const item = this.nextEligibleItem();
      if (!item) break;

      this.activeCount_++;
      this.userActive.set(item.options.userId, (this.userActive.get(item.options.userId) ?? 0) + 1);
      // Fire-and-forget; errors handled inside executeTask
      void this.executeTask(item);
    }
    this.syncSlotGauges();
  }

  /**
   * Round-robin pick across user queues: the next queued item whose user is
   * below their per-user concurrent cap, starting after the last-served user.
   */
  private nextEligibleItem(): QueueItem | null {
    const users = this.rotation;
    for (let i = 0; i < users.length; i++) {
      const idx = (this.rotationIdx + i) % users.length;
      const userId = users[idx]!;
      const queue = this.userQueues.get(userId);
      if (!queue || queue.length === 0) continue;

      const quota = this.quotaFor(queue[0]!.options);
      if ((this.userActive.get(userId) ?? 0) >= quota.maxConcurrent) continue;

      this.rotationIdx = (idx + 1) % users.length;
      return queue.shift() ?? null;
    }
    return null;
  }

  /**
   * Execute a single task via AgentRunnerService.
   *
   * Guarantees the parent always hears back and the concurrency slot is always
   * freed — exactly once — via a `settled` latch shared by three racing exits:
   *   1. the run resolves        → publish result,
   *   2. the run rejects         → publish failure,
   *   3. the hard watchdog fires → abort the in-flight run, publish failure.
   *
   * The watchdog (3) is the backstop for a run that cannot honor its own
   * timeout (e.g. a tool that ignores the abort signal): without it the awaited
   * `agentRunner.run()` would never settle, leaking the slot forever and
   * leaving the parent waiting indefinitely with no feedback.
   */
  private async executeTask(item: QueueItem): Promise<void> {
    const { agentRunId, options } = item;
    const timeoutMs = options.timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS;

    logger.debug({ agentRunId, timeoutMs }, 'Starting task execution');

    let settled = false;
    const finalize = (): void => {
      this.activeCount_--;
      const active = this.userActive.get(options.userId) ?? 1;
      this.userActive.set(options.userId, Math.max(0, active - 1));
      this.drain();
    };

    // Backstop: if the run hasn't settled within its timeout + grace, the loop
    // failed to abort itself. Forcibly abort, report failure to the parent, and
    // free the slot — the orphaned promise (if any) becomes a no-op on settle.
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      agentWatchdogFiredTotal.inc();
      // Enrich the death-log with the run's last-known activity so it names the
      // tool/iteration the run was wedged in, not just an opaque timeout.
      const activity = this.runActivity.snapshot(agentRunId);
      const stuckInMs =
        activity?.currentToolStartedAt != null ? Date.now() - activity.currentToolStartedAt : null;
      logger.error(
        {
          agentRunId,
          timeoutMs,
          iteration: activity?.iteration ?? null,
          lastTool: activity?.currentToolName ?? null,
          stuckInToolMs: stuckInMs,
        },
        'Sub-agent watchdog fired — run did not settle; aborting and failing',
      );
      this.agentRunRegistry.abort(agentRunId, 'watchdog_timeout');
      this.agentRunRepo
        .update(agentRunId, {
          status: 'failed',
          error: 'Sub-agent run timed out (watchdog)',
          completedAt: new Date(),
        })
        .catch((err: unknown) => {
          logger.error({ agentRunId, err }, 'Failed to mark watchdog-timed-out run as failed');
        });
      void this.resultPublisher.publishFailure(agentRunId, new Error('Sub-agent run timed out'));
      finalize();
    }, timeoutMs + SUBAGENT_WATCHDOG_GRACE_MS);
    if (typeof watchdog === 'object' && watchdog !== null && typeof watchdog.unref === 'function') {
      watchdog.unref();
    }

    try {
      const result = await this.agentRunner.run({
        ...options,
        isSubAgent: true,
        agentRunId,
        timeoutMs,
        onProgress: this.buildProgressForwarder(options),
      });

      if (settled) return; // watchdog already handled it
      settled = true;
      clearTimeout(watchdog);
      logger.info({ agentRunId, status: result.status }, 'Task settled');
      // Pass the run's real status through — a timed-out or budget-killed child
      // resolves (not rejects) with status 'failed', and the parent must not
      // see that as 'completed'.
      const completed = result.status === 'completed';
      await this.resultPublisher.publishOutcome(agentRunId, {
        status: completed ? 'completed' : 'failed',
        output: result.output,
        error: completed
          ? null
          : (result.error ?? `Sub-agent run ended with status '${result.status}'`),
      });
      finalize();
    } catch (err: unknown) {
      if (settled) return; // watchdog already handled it
      settled = true;
      clearTimeout(watchdog);
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ agentRunId, error: error.message }, 'Task execution failed');
      await this.resultPublisher.publishFailure(agentRunId, error);
      finalize();
    }
  }

  /**
   * Build a throttled progress callback that forwards a sub-agent's tool
   * activity to the parent's channel, so long-running sub-agents are visibly
   * alive instead of looking hung. Transient: delivered as a channel message,
   * not persisted to session history.
   */
  private buildProgressForwarder(options: SubmitOptions): (hint: string) => void {
    const label = options.displayName ?? 'sub-agent';
    let lastEmit = 0;
    return (hint: string): void => {
      const now = Date.now();
      if (now - lastEmit < SUBAGENT_PROGRESS_THROTTLE_MS) return;
      lastEmit = now;
      void this.pubsub
        .publish(PUBSUB_CHANNELS.channelResponseReady, {
          sessionId: options.sessionId,
          output: `_${label} is working: ${hint}_`,
        })
        .catch((err: unknown) => {
          logger.debug({ err }, 'Failed to forward sub-agent progress');
        });
    };
  }

  // ---------------------------------------------------------------- //
  //  Result delivery                                                  //
  // ---------------------------------------------------------------- //

  /**
   * Attempt to acquire a per-session lock and deliver pending results to the parent agent.
   */
  private async tryDeliverResults(parentSessionId: string): Promise<void> {
    // D4 guard: never re-invoke while the session's parent run is still live —
    // the reinvocation would load history before the parent's turn is saved
    // and both runs would interleave writes to the same session. The parent's
    // completion hook (AgentRunnerService run() finally) re-publishes
    // agentResultReady when the queue is non-empty, so deferral never strands
    // results.
    const activePrimary = await this.agentRunRepo.findActivePrimaryRun(parentSessionId);
    if (activePrimary) {
      logger.debug(
        { parentSessionId, activeRunId: activePrimary.id },
        'Parent run still active; deferring result delivery until it settles',
      );
      return;
    }

    const lockKey = KEY_PREFIXES.agentLock + parentSessionId;
    // Token-fenced lock: the critical section below contains full parent LLM
    // reinvocations, which can outlast any fixed TTL. The token (a) lets a
    // renewal heartbeat extend only a lock we still hold, and (b) makes
    // release a compare-and-delete, so an expired holder can never delete the
    // lock of a successor that legitimately acquired it in the meantime.
    const lockToken = randomUUID();
    const acquired = await this.redis.setNx(lockKey, lockToken, DEFAULT_TTL.agentLock);
    if (!acquired) {
      logger.debug({ parentSessionId }, 'Lock held; skipping delivery');
      return;
    }

    const renewTimer = setInterval(
      () => {
        this.redis
          .extendFencedLock(lockKey, lockToken, DEFAULT_TTL.agentLock)
          .then((held) => {
            if (!held) {
              logger.warn(
                { parentSessionId },
                'Delivery lock lost mid-delivery (expired or taken over); a concurrent deliverer may be active',
              );
            }
          })
          .catch((err: unknown) => {
            logger.warn({ parentSessionId, err }, 'Delivery lock renewal failed');
          });
      },
      (DEFAULT_TTL.agentLock * 1000) / 3,
    );

    try {
      await this.deliverResults(parentSessionId);

      // Final check inside lock: catch results that arrived between last LMOVE and now
      const remaining = await this.redis.llen(KEY_PREFIXES.agentResults + parentSessionId);
      if (remaining > 0) {
        await this.deliverResults(parentSessionId);
      }
    } finally {
      clearInterval(renewTimer);
      await this.redis.releaseFencedLock(lockKey, lockToken);
    }
  }

  /**
   * Batch drain: move every queued result to the processing list, then
   * re-invoke the parent ONCE with a combined [Sub-Agent Results] injection.
   * N settled children cost one delivery turn instead of N full parent runs
   * (D9); the reinvocation cap therefore counts dispatched waves, not
   * per-result attempts, and rolls back on cap-hit or failure so neither
   * burns the window (D6).
   */
  private async deliverResults(parentSessionId: string): Promise<void> {
    const queueKey = KEY_PREFIXES.agentResults + parentSessionId;
    const processingKey = KEY_PREFIXES.agentProcessing + parentSessionId;
    const reinvokeCountKey = KEY_PREFIXES.agentReinvokeCount + parentSessionId;

    while (true) {
      // Drain the queue (bounded per wave) into the processing list.
      const batch: string[] = [];
      while (batch.length < MAX_RESULTS_PER_WAVE) {
        const raw = await this.redis.lmove(queueKey, processingKey, 'RIGHT', 'LEFT');
        if (raw === null) break;
        batch.push(raw);
      }
      if (batch.length === 0) return;

      // Parse up front; unparseable items are dropped loudly, not retried.
      const items: { raw: string; payload: SubAgentResultPayload }[] = [];
      for (const raw of batch) {
        try {
          items.push({ raw, payload: JSON.parse(raw) as SubAgentResultPayload });
        } catch {
          await this.redis.lrem(processingKey, 1, raw);
          logger.error({ parentSessionId }, 'Dropping unparseable sub-agent result payload');
        }
      }
      if (items.length === 0) continue;

      // Wave cap (D6): INCR once per dispatched wave; roll back when the wave
      // does not actually run so cap-hits and failures never burn the window.
      const count = await this.redis.incr(reinvokeCountKey);
      if (count === 1) {
        await this.redis.expire(reinvokeCountKey, DEFAULT_TTL.agentReinvokeCount);
      }
      if (count > this.maxReinvocations) {
        await this.redis.decr(reinvokeCountKey);
        logger.warn(
          { parentSessionId, count, max: this.maxReinvocations, queued: items.length },
          'Reinvocation cap reached; results stay queued for the next delivery trigger',
        );
        for (const item of items) {
          await this.redis.lpush(queueKey, item.raw);
          await this.redis.lrem(processingKey, 1, item.raw);
        }
        return;
      }

      try {
        const parentRun = await this.agentRunRepo.findById(items[0]!.payload.parentAgentRunId);

        if (!parentRun.sessionId) {
          logger.warn(
            { parentAgentRunId: items[0]!.payload.parentAgentRunId },
            'Skipping reinvocation for sessionless AgentRun',
          );
          for (const item of items) {
            await this.redis.lrem(processingKey, 1, item.raw);
          }
          await this.redis.decr(reinvokeCountKey);
          continue;
        }

        const session = await this.sessionRepo.findById(parentRun.sessionId);
        const input = this.formatBatchInjection(items.map((i) => i.payload));

        const reinvocationResult = await this.agentRunner.run({
          agentDefinitionId: parentRun.agentDefinitionId,
          input,
          userId: session.userId,
          sessionId: parentRun.sessionId,
          isReinvocation: true,
        });

        // Notify channel layer to deliver the response to the user
        if (reinvocationResult.output) {
          await this.pubsub.publish(PUBSUB_CHANNELS.channelResponseReady, {
            sessionId: parentRun.sessionId,
            output: reinvocationResult.output,
          });
        }

        // Success — remove the whole wave from the processing list
        for (const item of items) {
          await this.redis.lrem(processingKey, 1, item.raw);
        }

        logger.info(
          { parentSessionId, delivered: items.length, wave: count },
          'Delivered sub-agent result batch to parent',
        );
      } catch (err: unknown) {
        await this.redis.decr(reinvokeCountKey);
        const message = err instanceof Error ? err.message : String(err);
        for (const item of items) {
          await this.handleDeliveryError(processingKey, parentSessionId, item.raw, message);
        }
        return;
      }
    }
  }

  /**
   * A delivery attempt failed. Bump the attempt counter on the payload so the
   * periodic sweep retries it a bounded number of times: under the cap the
   * item is rewritten in place (processing list) for the next sweep; at the
   * cap — or unparseable — it is dropped loudly instead of bouncing forever.
   */
  private async handleDeliveryError(
    processingKey: string,
    parentSessionId: string,
    raw: string,
    errorMessage: string,
  ): Promise<void> {
    let payload: SubAgentResultPayload | null = null;
    try {
      payload = JSON.parse(raw) as SubAgentResultPayload;
    } catch {
      payload = null;
    }

    try {
      if (!payload) {
        await this.redis.lrem(processingKey, 1, raw);
        logger.error(
          { parentSessionId, error: errorMessage },
          'Dropping unparseable sub-agent result payload',
        );
        return;
      }

      const attempts = (payload.deliveryAttempts ?? 0) + 1;
      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        await this.redis.lrem(processingKey, 1, raw);
        logger.error(
          { parentSessionId, childRunId: payload.agentRunId, attempts, error: errorMessage },
          'Dropping sub-agent result after repeated delivery failures',
        );
        return;
      }

      // Push the updated copy before removing the old one so a crash between
      // the two duplicates the item instead of losing it.
      const updated = JSON.stringify({ ...payload, deliveryAttempts: attempts });
      await this.redis.lpush(processingKey, updated);
      await this.redis.lrem(processingKey, 1, raw);
      logger.error(
        { parentSessionId, attempts, error: errorMessage },
        'Failed to deliver result to parent; will retry via periodic sweep',
      );
    } catch (updateErr: unknown) {
      const message = updateErr instanceof Error ? updateErr.message : String(updateErr);
      logger.error(
        { parentSessionId, error: message },
        'Failed to update stuck delivery item; leaving as-is for sweep/recovery',
      );
    }
  }

  /**
   * Format the combined batch injection sent to the parent agent — one
   * message carrying every settled result in the wave.
   */
  private formatBatchInjection(results: readonly SubAgentResultPayload[]): string {
    const sections = results.map((r) => {
      const body =
        r.status === 'completed'
          ? (r.output ?? '(no output)')
          : `Error: ${r.error ?? 'Unknown error'}`;
      return [`### ${r.agentName} (task ${r.agentRunId}) — ${r.status}`, body].join('\n');
    });

    return [
      '[Sub-Agent Results]',
      `${results.length} sub-agent task(s) settled; all their results are below.`,
      '',
      sections.join('\n\n'),
      '',
      '---',
      'You may continue processing, spawn new tasks, or compose a final response for the user.',
    ].join('\n');
  }

  // ---------------------------------------------------------------- //
  //  Crash recovery                                                   //
  // ---------------------------------------------------------------- //

  /**
   * On startup, scan for any processing lists and move their items back
   * to the corresponding result queues so they can be re-delivered.
   */
  private async recoverProcessingResults(): Promise<void> {
    await this.requeueProcessingLists({ skipLocked: false });
  }

  /**
   * Periodic sweep: requeue results left in processing lists by a failed
   * delivery so they are retried without a process restart. Sessions whose
   * delivery lock is currently held are skipped — their items are in-flight,
   * not stuck.
   */
  private async sweepStuckProcessing(): Promise<void> {
    await this.requeueProcessingLists({ skipLocked: true });
  }

  private async requeueProcessingLists(opts: { skipLocked: boolean }): Promise<void> {
    try {
      const client = this.redis.getClient();
      const pattern = `${KEY_PREFIXES.agentProcessing}*`;
      let cursor = '0';

      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          SCAN_BATCH_SIZE,
        );
        cursor = nextCursor;

        for (const processingKey of keys) {
          const parentSessionId = processingKey.replace(KEY_PREFIXES.agentProcessing, '');
          const queueKey = KEY_PREFIXES.agentResults + parentSessionId;

          if (opts.skipLocked) {
            const locked = await this.redis.exists(KEY_PREFIXES.agentLock + parentSessionId);
            if (locked) continue; // delivery in flight — not stuck
          }

          // Move all items back to result queue
          let moved = 0;
          while (true) {
            const item = await this.redis.lmove(processingKey, queueKey, 'RIGHT', 'LEFT');
            if (item === null) break;
            moved++;
          }

          if (moved === 0) continue;

          logger.info({ parentSessionId, moved }, 'Requeued processing results for re-delivery');

          // Notify for re-delivery
          await this.pubsub.publish(PUBSUB_CHANNELS.agentResultReady, parentSessionId);
        }
      } while (cursor !== '0');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Error during processing results requeue');
    }
  }
}
