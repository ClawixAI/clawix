import type { ChatMessage, GenerationSettings, LLMUsage } from '@clawix/shared';

import type { BudgetTracker } from './budget-tracker.js';

/** Configuration for a reasoning loop run. */
export interface ReasoningLoopConfig {
  readonly maxIterations?: number; // default: 40
  readonly model?: string; // overrides provider default
  readonly settings?: GenerationSettings;
  readonly onProgress?: (hint: string) => void;
  /**
   * Shared budget tracker for the agent run. When provided, every LLM call
   * accumulates into the same counter; the loop hard-stops once the grace
   * limit is crossed. Omit for unbounded execution.
   */
  readonly budgetTracker?: BudgetTracker;
  /** Wall-clock timeout in milliseconds. Loop aborts if exceeded. */
  readonly timeoutMs?: number;
  /** External abort signal — loop checks this before each iteration. */
  readonly abortSignal?: AbortSignal;
}

/** Result of a completed reasoning loop. */
export interface LoopResult {
  readonly content: string | null;
  readonly messages: readonly ChatMessage[];
  readonly totalUsage: LLMUsage;
  readonly iterations: number;
  readonly hitMaxIterations: boolean;
  /** True when the loop stopped because the token budget grace limit was exceeded. */
  readonly hitTokenBudget: boolean;
  /** True when the loop stopped because the wall-clock timeout was exceeded. */
  readonly hitTimeout: boolean;
}
