import { describe, it, expect } from 'vitest';

import { BudgetTracker } from '../budget-tracker.js';

import type { LLMUsage } from '@clawix/shared';

function usage(inputTokens: number, outputTokens: number): LLMUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    model: 'test-model',
    estimatedCostUsd: 0,
  };
}

describe('BudgetTracker', () => {
  it('defaults seeded usage to zero', () => {
    const tracker = new BudgetTracker(1000, 10);
    expect(tracker.used).toBe(0);
  });

  it('seeds cumulative usage from a prior-spend value (crash recovery)', () => {
    const tracker = new BudgetTracker(1000, 10, 600);
    expect(tracker.used).toBe(600);

    // New spend accumulates on top of the seeded baseline.
    tracker.record(usage(100, 50));
    expect(tracker.used).toBe(750);
  });

  it('honours the seeded baseline when evaluating soft/hard stops', () => {
    // Budget 1000, grace 10% → hard ceiling 1100. Seed already past the soft
    // budget so a recovered sibling does not get a fresh full allowance.
    const tracker = new BudgetTracker(1000, 10, 1050);
    expect(tracker.shouldInjectGrace()).toBe(true);
    expect(tracker.isOverGrace()).toBe(false);

    tracker.record(usage(60, 0)); // now 1110, past the hard ceiling
    expect(tracker.isOverGrace()).toBe(true);
  });

  it('ignores the seed for enforcement when budget is null (observability only)', () => {
    const tracker = new BudgetTracker(null, 10, 5000);
    expect(tracker.used).toBe(5000);
    expect(tracker.isOverGrace()).toBe(false);
    expect(tracker.shouldInjectGrace()).toBe(false);
  });
});
