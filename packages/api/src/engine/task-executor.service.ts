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

import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import type { AgentRunnerService } from './agent-runner.service.js';
import type { RunResult } from './agent-runner.types.js';
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
import { AgentDefinitionRepository } from '../db/agent-definition.repository.js';

const logger = createLogger('engine:task-executor');

// ------------------------------------------------------------------ //
//  Types                                                              //
// ------------------------------------------------------------------ //

interface SubmitOptions {
  readonly agentDefinitionId: string;
  readonly input: string;
  readonly userId: string;
  readonly sessionId: string;
}

interface QueueItem {
  readonly agentRunId: string;
  readonly options: SubmitOptions;
}

/** Shape of a result payload stored in the Redis result queue. */
interface ResultPayload {
  readonly agentRunId: string;
  readonly parentAgentRunId: string;
  readonly agentName: string;
  readonly output: string | null;
  readonly status: 'completed' | 'failed';
  readonly error: string | null;
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
export class TaskExecutorService implements OnModuleInit {
  private readonly maxConcurrent: number;
  private readonly maxPending: number;
  private readonly maxReinvocations: number;
  private readonly pendingQueue: QueueItem[] = [];
  private activeCount_ = 0;

  constructor(
    @Inject('AgentRunnerService')
    private readonly agentRunner: AgentRunnerService,
    private readonly agentRunRepo: AgentRunRepository,
    private readonly sessionRepo: SessionRepository,
    private readonly redis: RedisService,
    private readonly pubsub: RedisPubSubService,
    private readonly agentDefRepo: AgentDefinitionRepository,
  ) {
    this.maxConcurrent = parseInt(process.env['MAX_CONCURRENT_AGENTS'] ?? '10', 10);
    this.maxPending = parseInt(process.env['MAX_PENDING_AGENTS'] ?? '100', 10);
    const rawReinvocations = parseInt(process.env['MAX_REINVOCATIONS'] ?? '10', 10);
    this.maxReinvocations = rawReinvocations > 0 ? rawReinvocations : 10;
  }

  // ---------------------------------------------------------------- //
  //  Public properties                                               //
  // ---------------------------------------------------------------- //

  /** Number of tasks currently running. */
  get activeCount(): number {
    return this.activeCount_;
  }

  /** Number of tasks waiting in the queue. */
  get pendingCount(): number {
    return this.pendingQueue.length;
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
    if (this.activeCount_ >= this.maxConcurrent) {
      // No active slots — try to queue
      if (this.pendingQueue.length >= this.maxPending) {
        // Queue is full — reject immediately
        logger.warn({ agentRunId }, 'Task queue full; rejecting task');
        this.agentRunRepo
          .update(agentRunId, {
            status: 'failed',
            error: 'Task queue is full; task rejected',
            completedAt: new Date(),
          })
          .catch((err: unknown) => {
            logger.error({ agentRunId, err }, 'Failed to mark rejected AgentRun as failed');
          });
        return;
      }

      logger.debug({ agentRunId }, 'Queuing task (concurrency limit reached)');
      this.pendingQueue.push({ agentRunId, options });
      return;
    }

    this.drain();
    // If we still had a slot free, drain will handle starting this item — but
    // because submit() is synchronous and the item isn't in the queue yet, we
    // start it directly.
    //
    // Actually: push first, then drain so drain can pull from queue uniformly.
    // However we want direct start when below limit; keep it simple:
    this.pendingQueue.push({ agentRunId, options });
    this.drain();
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

        for (const run of pendingRuns) {
          try {
            const session = await this.sessionRepo.findById(run.sessionId);

            this.submit(run.id, {
              agentDefinitionId: run.agentDefinitionId,
              input: run.input,
              userId: session.userId,
              sessionId: run.sessionId,
            });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(
              { agentRunId: run.id, error: message },
              'Failed to recover pending AgentRun',
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
  }

  // ---------------------------------------------------------------- //
  //  Private methods                                                 //
  // ---------------------------------------------------------------- //

  /**
   * Drain the pending queue by starting tasks while concurrency slots are available.
   */
  private drain(): void {
    while (this.activeCount_ < this.maxConcurrent && this.pendingQueue.length > 0) {
      const item = this.pendingQueue.shift();
      if (!item) break;

      this.activeCount_++;
      // Fire-and-forget; errors handled inside executeTask
      void this.executeTask(item);
    }
  }

  /**
   * Execute a single task via AgentRunnerService.
   *
   * Decrements the active counter and drains the queue when done.
   * On completion (success or failure), publishes result to Redis if this is a child agent.
   */
  private async executeTask(item: QueueItem): Promise<void> {
    const { agentRunId, options } = item;

    logger.debug({ agentRunId }, 'Starting task execution');

    try {
      const result = await this.agentRunner.run({
        ...options,
        isSubAgent: true,
        agentRunId,
      });

      logger.info({ agentRunId }, 'Task completed successfully');
      await this.publishResultIfChild(agentRunId, result);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ agentRunId, error: error.message }, 'Task execution failed');
      await this.publishFailureIfChild(agentRunId, error);
    } finally {
      this.activeCount_--;
      this.drain();
    }
  }

  // ---------------------------------------------------------------- //
  //  Result publishing                                                //
  // ---------------------------------------------------------------- //

  /**
   * If the completed agent run is a child (has parentAgentRunId), publish its
   * result to the parent's Redis result queue and notify via pub/sub.
   */
  private async publishResultIfChild(agentRunId: string, result: RunResult): Promise<void> {
    try {
      const childRun = await this.agentRunRepo.findById(agentRunId);
      if (!childRun.parentAgentRunId) return;

      const parentRun = await this.agentRunRepo.findById(childRun.parentAgentRunId);
      const agentDef = await this.agentDefRepo.findById(childRun.agentDefinitionId);

      const payload: ResultPayload = {
        agentRunId,
        parentAgentRunId: childRun.parentAgentRunId,
        agentName: agentDef.name,
        output: result.output,
        status: 'completed',
        error: null,
      };

      const parentSessionId = parentRun.sessionId;
      const queueKey = KEY_PREFIXES.agentResults + parentSessionId;
      await this.redis.lpush(queueKey, JSON.stringify(payload));
      await this.redis.expire(queueKey, DEFAULT_TTL.agentResults);
      await this.redis.expire(
        KEY_PREFIXES.agentProcessing + parentSessionId,
        DEFAULT_TTL.agentResults,
      );
      await this.pubsub.publish(PUBSUB_CHANNELS.agentResultReady, parentSessionId);

      logger.info({ agentRunId, parentSessionId }, 'Published sub-agent result');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ agentRunId, error: message }, 'Failed to publish sub-agent result');
    }
  }

  /**
   * If the failed agent run is a child, publish a failure result to the parent's queue.
   */
  private async publishFailureIfChild(agentRunId: string, error: Error): Promise<void> {
    try {
      const childRun = await this.agentRunRepo.findById(agentRunId);
      if (!childRun.parentAgentRunId) return;

      const parentRun = await this.agentRunRepo.findById(childRun.parentAgentRunId);
      const agentDef = await this.agentDefRepo.findById(childRun.agentDefinitionId);

      const payload: ResultPayload = {
        agentRunId,
        parentAgentRunId: childRun.parentAgentRunId,
        agentName: agentDef.name,
        output: null,
        status: 'failed',
        error: error.message,
      };

      const parentSessionId = parentRun.sessionId;
      const queueKey = KEY_PREFIXES.agentResults + parentSessionId;
      await this.redis.lpush(queueKey, JSON.stringify(payload));
      await this.redis.expire(queueKey, DEFAULT_TTL.agentResults);
      await this.redis.expire(
        KEY_PREFIXES.agentProcessing + parentSessionId,
        DEFAULT_TTL.agentResults,
      );
      await this.pubsub.publish(PUBSUB_CHANNELS.agentResultReady, parentSessionId);

      logger.info({ agentRunId, parentSessionId }, 'Published sub-agent failure result');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ agentRunId, error: message }, 'Failed to publish sub-agent failure result');
    }
  }

  // ---------------------------------------------------------------- //
  //  Result delivery                                                  //
  // ---------------------------------------------------------------- //

  /**
   * Attempt to acquire a per-session lock and deliver pending results to the parent agent.
   */
  private async tryDeliverResults(parentSessionId: string): Promise<void> {
    const lockKey = KEY_PREFIXES.agentLock + parentSessionId;
    const acquired = await this.redis.setNx(lockKey, '1', DEFAULT_TTL.agentLock);
    if (!acquired) {
      logger.debug({ parentSessionId }, 'Lock held; skipping delivery');
      return;
    }

    try {
      await this.deliverResults(parentSessionId);

      // Final check inside lock: catch results that arrived between last LMOVE and now
      const remaining = await this.redis.llen(KEY_PREFIXES.agentResults + parentSessionId);
      if (remaining > 0) {
        await this.deliverResults(parentSessionId);
      }
    } finally {
      await this.redis.del(lockKey);
    }
  }

  /**
   * Loop: move results from the queue to a processing list, then re-invoke the parent agent
   * for each result.
   */
  private async deliverResults(parentSessionId: string): Promise<void> {
    const queueKey = KEY_PREFIXES.agentResults + parentSessionId;
    const processingKey = KEY_PREFIXES.agentProcessing + parentSessionId;
    const reinvokeCountKey = KEY_PREFIXES.agentReinvokeCount + parentSessionId;

    while (true) {
      // Atomically move one item from results queue to processing list
      const raw = await this.redis.lmove(queueKey, processingKey, 'RIGHT', 'LEFT');
      if (raw === null) break;

      // Check reinvocation cap
      const count = await this.redis.incr(reinvokeCountKey);
      if (count === 1) {
        await this.redis.expire(reinvokeCountKey, DEFAULT_TTL.agentReinvokeCount);
      }
      if (count > this.maxReinvocations) {
        logger.warn(
          { parentSessionId, count, max: this.maxReinvocations },
          'Reinvocation cap reached; moving result back to queue',
        );
        // Move back to queue and stop
        await this.redis.lpush(queueKey, raw);
        await this.redis.lrem(processingKey, 1, raw);
        break;
      }

      try {
        const result = JSON.parse(raw) as ResultPayload;
        const parentRun = await this.agentRunRepo.findById(result.parentAgentRunId);
        const session = await this.sessionRepo.findById(parentRun.sessionId);

        // Count remaining items for the injection message
        const pendingCount = await this.redis.llen(queueKey);
        const input = this.formatResultInjection(result, pendingCount);

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

        // Success — remove from processing list
        await this.redis.lrem(processingKey, 1, raw);

        logger.info(
          { parentSessionId, childRunId: result.agentRunId },
          'Delivered sub-agent result to parent',
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { parentSessionId, error: message },
          'Failed to deliver result to parent; leaving in processing list for recovery',
        );
        break;
      }
    }
  }

  /**
   * Format the result injection string that is sent to the parent agent.
   */
  private formatResultInjection(result: ResultPayload, pendingCount: number): string {
    const statusLine =
      result.status === 'completed'
        ? (result.output ?? '(no output)')
        : `Error: ${result.error ?? 'Unknown error'}`;

    return [
      '[Sub-Agent Result]',
      `Agent: ${result.agentName} (task ${result.agentRunId})`,
      `Status: ${result.status}`,
      '',
      statusLine,
      '',
      '---',
      `You have ${pendingCount} more pending results in queue.`,
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

          logger.info({ parentSessionId }, 'Recovering processing results');

          // Move all items back to result queue

          while (true) {
            const item = await this.redis.lmove(processingKey, queueKey, 'RIGHT', 'LEFT');
            if (item === null) break;
          }

          // Notify for re-delivery
          await this.pubsub.publish(PUBSUB_CHANNELS.agentResultReady, parentSessionId);
        }
      } while (cursor !== '0');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Error during processing results recovery');
    }
  }
}
