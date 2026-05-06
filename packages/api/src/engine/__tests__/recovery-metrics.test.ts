import { beforeEach, describe, expect, it } from 'vitest';
import {
  agentErrorTotal,
  recoveryActionTotal,
  recoveryOutcomeTotal,
  toolLoopAbortedTotal,
  wireRecoveryMetrics,
} from '../recovery-metrics.js';
import type { RecoveryEvent } from '../recovery-loop.types.js';

function getCount(metric: { hashMap: Record<string, { value: number }> }): number {
  return Object.values(metric.hashMap).reduce((sum, entry) => sum + entry.value, 0);
}

describe('recovery-metrics', () => {
  beforeEach(() => {
    agentErrorTotal.reset();
    recoveryActionTotal.reset();
    recoveryOutcomeTotal.reset();
    toolLoopAbortedTotal.reset();
  });

  it('increments recovery_action_total on a recovery_action event', () => {
    const event: RecoveryEvent = {
      type: 'recovery_action',
      action: 'retry',
      category: 'overloaded',
      attempt: 1,
      delayMs: 500,
      provider: 'anthropic',
    };
    wireRecoveryMetrics(event);
    const m = recoveryActionTotal as unknown as { hashMap: Record<string, { value: number }> };
    expect(getCount(m)).toBe(1);
  });

  it('increments recovery_outcome_total on a recovery_succeeded event', () => {
    wireRecoveryMetrics({
      type: 'recovery_succeeded',
      category: 'rate_limit',
      attempt: 2,
      action: 'retry',
      provider: 'openai',
    });
    const m = recoveryOutcomeTotal as unknown as { hashMap: Record<string, { value: number }> };
    expect(getCount(m)).toBe(1);
  });

  it('increments recovery_outcome_total with the reason on recovery_exhausted', () => {
    wireRecoveryMetrics({
      type: 'recovery_exhausted',
      category: 'context_overflow',
      attempt: 1,
      reason: 'compress_failed',
      provider: 'anthropic',
    });
    const m = recoveryOutcomeTotal as unknown as { hashMap: Record<string, { value: number }> };
    const entries = Object.values(m.hashMap);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.value).toBe(1);
  });

  it('does not throw on events with missing optional fields', () => {
    expect(() =>
      wireRecoveryMetrics({
        type: 'recovery_action',
        action: 'compress',
        category: 'context_overflow',
        attempt: 1,
      }),
    ).not.toThrow();
  });
});
