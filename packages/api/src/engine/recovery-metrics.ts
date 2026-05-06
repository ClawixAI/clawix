/**
 * Prometheus counters for the recovery layer. Wired into the recovery
 * loop via the `onRecoveryEvent` dependency so the loop itself stays
 * pure (testable without a metrics registry).
 */

import { Counter } from 'prom-client';
import type { RecoveryEvent } from './recovery-loop.types.js';

export const agentErrorTotal = new Counter({
  name: 'clawix_agent_error_total',
  help: 'Agent run errors by classifier category',
  labelNames: ['category', 'provider'],
});

export const recoveryActionTotal = new Counter({
  name: 'clawix_recovery_action_total',
  help: 'Recovery actions taken by the runner (retry, compress)',
  labelNames: ['action', 'category', 'provider'],
});

export const recoveryOutcomeTotal = new Counter({
  name: 'clawix_recovery_outcome_total',
  help: 'Final outcome of a recovery loop',
  labelNames: ['outcome', 'category', 'provider'],
});

export const toolLoopAbortedTotal = new Counter({
  name: 'clawix_tool_loop_aborted_total',
  help: 'Tool-loop guard aborts (3 consecutive identical failures)',
  labelNames: ['tool_name'],
});

const UNKNOWN_PROVIDER = 'unknown';

/**
 * Translate a RecoveryEvent into Prometheus counter increments. Pass this
 * function as `onRecoveryEvent` when calling `runWithRecovery`.
 */
export function wireRecoveryMetrics(event: RecoveryEvent): void {
  const provider = event.provider ?? UNKNOWN_PROVIDER;
  switch (event.type) {
    case 'recovery_action':
      if (event.action) {
        recoveryActionTotal.inc({ action: event.action, category: event.category, provider });
      }
      return;
    case 'recovery_succeeded':
      recoveryOutcomeTotal.inc({ outcome: 'succeeded', category: event.category, provider });
      return;
    case 'recovery_exhausted':
      recoveryOutcomeTotal.inc({
        outcome: `exhausted_${event.reason ?? 'unknown'}`,
        category: event.category,
        provider,
      });
      return;
    default: {
      const _exhaustive: never = event.type;
      void _exhaustive;
      return;
    }
  }
}
