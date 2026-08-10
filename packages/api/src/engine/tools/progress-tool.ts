/**
 * report_progress — sub-agent-side tool that pushes a short progress note to
 * the parent's channel. Complements the executor's automatic 30s tool-activity
 * heartbeat with model-initiated updates ("halfway through the dataset").
 *
 * Transient by design: delivered as a channel frame via channelResponseReady,
 * never persisted to session history (same contract as the heartbeat).
 */
import { createLogger } from '@clawix/shared';

import type { Tool, ToolResult } from '../tool.js';
import { PUBSUB_CHANNELS } from '../../cache/cache.constants.js';

const logger = createLogger('engine:tools:report-progress');

/** Minimum interval between reports; calls inside the window are dropped. */
export const PROGRESS_MIN_INTERVAL_MS = 10_000;
/** Hard cap on a single progress note. */
export const PROGRESS_MAX_CHARS = 500;

/** Structural slice of RedisPubSubService. */
interface ProgressPublisher {
  publish(channel: string, message: unknown): Promise<unknown>;
}

/** Create the `report_progress` tool for a sub-agent run. */
export function createReportProgressTool(opts: {
  readonly pubsub: ProgressPublisher;
  readonly sessionId: string;
  readonly agentName: string;
}): Tool {
  let lastEmit = 0;

  return {
    name: 'report_progress',
    description:
      'Send a one-line progress note to the user while you keep working (e.g. "processed 3 of 5 files"). ' +
      `Throttled to one note per ${PROGRESS_MIN_INTERVAL_MS / 1000}s; keep it under ${PROGRESS_MAX_CHARS} characters. ` +
      'Not for results — return those normally at the end of your run.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Short progress note for the user.' },
      },
      required: ['text'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const raw = params['text'] as string;
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { output: 'report_progress requires non-empty text.', isError: true };
      }

      const now = Date.now();
      if (now - lastEmit < PROGRESS_MIN_INTERVAL_MS) {
        return {
          output: `Progress note dropped — throttled to one per ${PROGRESS_MIN_INTERVAL_MS / 1000}s. Keep working; report again later.`,
          isError: false,
        };
      }
      lastEmit = now;

      const text = raw.trim().slice(0, PROGRESS_MAX_CHARS);
      try {
        await opts.pubsub.publish(PUBSUB_CHANNELS.channelResponseReady, {
          sessionId: opts.sessionId,
          output: `_${opts.agentName} progress: ${text}_`,
        });
      } catch (err: unknown) {
        logger.debug({ sessionId: opts.sessionId, err }, 'Progress publish failed');
        return {
          output: 'Progress note could not be delivered (transient). Keep working.',
          isError: false,
        };
      }

      return { output: 'Progress note sent to the user.', isError: false };
    },
  };
}
