import type { ChatMessage, GenerationSettings, LLMUsage } from '@clawix/shared';

import type { BudgetTracker } from './budget-tracker.js';

/**
 * Streaming event emitted from the reasoning loop. Consumed by channel
 * adapters to render multi-message progress (see `MessageRouterService`).
 */
export type ReasoningEvent =
  | {
      readonly type: 'assistant_chunk';
      /** Non-empty assistant content from this iteration. */
      readonly content: string;
      /**
       * True when this iteration produced no tool calls — i.e. the model's
       * happy-path closing chunk. Best-effort hint only: NOT guaranteed to
       * fire on degraded termination (token-budget hard-stop, abort signal,
       * error finish reason). Consumers needing a definitive end-of-stream
       * signal should rely on `LoopResult.hitTokenBudget` / `hitTimeout` /
       * `iterations` from the run's resolved promise rather than this flag.
       */
      readonly isFinal: boolean;
    }
  | {
      readonly type: 'tool_started';
      readonly name: string;
      readonly args: Readonly<Record<string, unknown>>;
    };

/** Configuration for a reasoning loop run. */
export interface ReasoningLoopConfig {
  readonly maxIterations?: number; // default: 40
  readonly model?: string; // overrides provider default
  readonly settings?: GenerationSettings;
  readonly onProgress?: (hint: string) => void;
  /**
   * Typed event channel. Fired with `assistant_chunk` after each iteration
   * that produces non-empty model content, and with `tool_started` before
   * each tool execution. Awaited so back-pressure from a slow channel
   * adapter pauses the loop. Omit for non-streaming runs.
   */
  readonly onEvent?: (event: ReasoningEvent) => void | Promise<void>;
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
