/**
 * SubAgentResultPublisher — single place every sub-agent outcome goes through
 * on its way back to the parent agent.
 *
 * Shared by TaskExecutorService (normal completion/failure/watchdog paths,
 * queue-full rejection) and StaleRunReaperService (orphaned runs with no
 * in-process controller), so no lifecycle path can end a child run without
 * a delivery landing in the parent session's Redis result queue.
 */

import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import { AgentRunRepository } from '../db/agent-run.repository.js';
import { AgentDefinitionRepository } from '../db/agent-definition.repository.js';
import { RedisService } from '../cache/redis.service.js';
import { RedisPubSubService } from '../cache/redis-pubsub.service.js';
import { KEY_PREFIXES, DEFAULT_TTL, PUBSUB_CHANNELS } from '../cache/cache.constants.js';

const logger = createLogger('engine:sub-agent-result-publisher');

/** Attempts for the critical queue write before dead-lettering. */
const PUBLISH_MAX_ATTEMPTS = 3;
/** Backoff base between publish attempts (250ms, then 500ms). */
const PUBLISH_RETRY_BASE_MS = 250;

/** Shape of a result payload stored in the Redis result queue. */
export interface SubAgentResultPayload {
  readonly agentRunId: string;
  readonly parentAgentRunId: string;
  readonly agentName: string;
  readonly output: string | null;
  readonly status: 'completed' | 'failed';
  readonly error: string | null;
  /** Failed delivery attempts so far; set by the delivery retry path. */
  readonly deliveryAttempts?: number;
}

/** Outcome of a finished sub-agent run, as seen by the parent. */
export interface SubAgentOutcome {
  readonly status: 'completed' | 'failed';
  readonly output: string | null;
  readonly error: string | null;
}

@Injectable()
export class SubAgentResultPublisher {
  constructor(
    private readonly agentRunRepo: AgentRunRepository,
    private readonly agentDefRepo: AgentDefinitionRepository,
    private readonly redis: RedisService,
    private readonly pubsub: RedisPubSubService,
  ) {}

  /**
   * If the given run is a child (has parentAgentRunId), push its outcome onto
   * the parent session's result queue and notify via pub/sub. No-op for
   * primary runs. Never throws — a publish failure is logged, not propagated.
   */
  async publishOutcome(agentRunId: string, outcome: SubAgentOutcome): Promise<void> {
    try {
      const childRun = await this.agentRunRepo.findById(agentRunId);
      if (!childRun.parentAgentRunId) return;

      const parentRun = await this.agentRunRepo.findById(childRun.parentAgentRunId);
      const agentDef = await this.agentDefRepo.findById(childRun.agentDefinitionId);

      const parentSessionId = parentRun.sessionId;
      if (!parentSessionId) {
        logger.warn(
          { agentRunId, parentAgentRunId: childRun.parentAgentRunId },
          'Skipping result publish for sessionless parent AgentRun',
        );
        return;
      }

      const payload: SubAgentResultPayload = {
        agentRunId,
        parentAgentRunId: childRun.parentAgentRunId,
        agentName: agentDef.name,
        output: outcome.output,
        status: outcome.status,
        error: outcome.error,
      };

      const queueKey = KEY_PREFIXES.agentResults + parentSessionId;
      const serialized = JSON.stringify(payload);

      // The lpush is the WS-A guarantee's critical write: if it never lands,
      // the parent simply never hears about this child. Retry it with a short
      // backoff before giving up; the queue item is written at most once (the
      // loop breaks on the first success).
      let enqueued = false;
      for (let attempt = 1; attempt <= PUBLISH_MAX_ATTEMPTS; attempt++) {
        try {
          await this.redis.lpush(queueKey, serialized);
          enqueued = true;
          break;
        } catch (pushErr: unknown) {
          const message = pushErr instanceof Error ? pushErr.message : String(pushErr);
          if (attempt === PUBLISH_MAX_ATTEMPTS) {
            // Dead letter: the full payload lands in the log so an operator
            // (or a future reconciler) can replay it — the run row is already
            // terminal in the DB, so this log line is the only trace.
            logger.error(
              { agentRunId, parentSessionId, payload: serialized, deadLetter: true },
              `Sub-agent outcome LOST after ${PUBLISH_MAX_ATTEMPTS} enqueue attempts: ${message}`,
            );
            return;
          }
          logger.warn(
            { agentRunId, parentSessionId, attempt, error: message },
            'Sub-agent outcome enqueue failed; retrying',
          );
          await new Promise((resolve) => setTimeout(resolve, PUBLISH_RETRY_BASE_MS * attempt));
        }
      }
      if (!enqueued) return;

      // Post-enqueue housekeeping is best-effort and must not re-run the
      // lpush: TTL refreshes only shorten cleanup, and the pub/sub wake-up
      // has two backstops (the periodic delivery sweep and the parent-run
      // completion hook), so losing either is tolerable.
      try {
        await this.redis.expire(queueKey, DEFAULT_TTL.agentResults);
        await this.redis.expire(
          KEY_PREFIXES.agentProcessing + parentSessionId,
          DEFAULT_TTL.agentResults,
        );
        await this.pubsub.publish(PUBSUB_CHANNELS.agentResultReady, parentSessionId);
      } catch (postErr: unknown) {
        const message = postErr instanceof Error ? postErr.message : String(postErr);
        logger.warn(
          { agentRunId, parentSessionId, error: message },
          'Outcome enqueued but TTL/wake-up failed; sweep will pick it up',
        );
      }

      logger.info(
        { agentRunId, parentSessionId, status: outcome.status },
        'Published sub-agent outcome',
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ agentRunId, error: message }, 'Failed to publish sub-agent outcome');
    }
  }

  /** Convenience wrapper for the failure paths (rejection, watchdog, reaper). */
  async publishFailure(agentRunId: string, error: Error): Promise<void> {
    await this.publishOutcome(agentRunId, {
      status: 'failed',
      output: null,
      error: error.message,
    });
  }
}
