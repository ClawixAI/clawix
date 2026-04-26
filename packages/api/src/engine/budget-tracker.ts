import type { LLMUsage } from '@clawix/shared';

/**
 * Shared token-budget tracker.
 *
 * A single tracker instance is created at the top of an agent run (e.g. by the
 * cron task processor) and passed by reference to the reasoning loop and any
 * sub-agents spawned during the run. All `record()` calls accumulate into the
 * same `used` counter, so the budget caps total spend across the run as a
 * whole — not per-loop.
 *
 * `budget === null` means "no enforcement"; the tracker still accumulates
 * `used` for observability but never reports a soft- or hard-stop condition.
 */
export class BudgetTracker {
  /** Cumulative input + output tokens across every recorded LLM call. */
  private used_ = 0;
  /** True once a "wrap up" system message has been injected by some loop. */
  private graceInjected_ = false;

  readonly budget: number | null;
  readonly graceLimit: number | null;
  readonly gracePercent: number;

  constructor(budget: number | null, gracePercent: number) {
    this.budget = budget;
    this.gracePercent = gracePercent;
    this.graceLimit = budget === null ? null : Math.ceil(budget * (1 + gracePercent / 100));
  }

  /** Total tokens consumed across all recorded calls. */
  get used(): number {
    return this.used_;
  }

  /** Whether some loop has already injected the "wrap up" grace message. */
  get graceInjected(): boolean {
    return this.graceInjected_;
  }

  /** Accumulate one LLM call's usage into the shared counter. */
  record(usage: LLMUsage): void {
    this.used_ += usage.inputTokens + usage.outputTokens;
  }

  /** Past the hard-stop ceiling — the loop must break immediately. */
  isOverGrace(): boolean {
    return this.graceLimit !== null && this.used_ >= this.graceLimit;
  }

  /** Past the soft budget but not yet the hard ceiling. */
  shouldInjectGrace(): boolean {
    return (
      this.budget !== null &&
      !this.graceInjected_ &&
      this.used_ >= this.budget &&
      !this.isOverGrace()
    );
  }

  /** Mark grace as injected so subsequent loops don't repeat the message. */
  markGraceInjected(): void {
    this.graceInjected_ = true;
  }
}
