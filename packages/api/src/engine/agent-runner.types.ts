import type { AgentStatus, InboundMessage, TokenUsageRecord } from '@clawix/shared';

import type { MessageStore } from './message-store/message-store.js';
import type { BudgetTracker } from './budget-tracker.js';
import type { ReasoningEvent } from './reasoning-loop.types.js';

/** Options for running an agent. */
export interface RunOptions {
  readonly agentDefinitionId: string;
  readonly input: string;
  readonly userId: string;
  readonly sessionId?: string;
  readonly onProgress?: (hint: string) => void;
  /** When true, the spawn tool is not registered (prevents sub-agents from spawning further agents). */
  readonly isSubAgent?: boolean;
  /** When true, mutating cron tool actions are blocked (prevents recursive scheduling). */
  readonly isScheduledTask?: boolean;
  /** Reuse an existing AgentRun record (for spawned tasks pre-created by the spawn tool). */
  readonly agentRunId?: string;
  /** Channel type: 'telegram' | 'slack' | 'whatsapp' | 'web' | 'internal'. Defaults to 'internal'. */
  readonly channel?: string;
  /**
   * DB Channel id used for channel-aware session resumption. When provided
   * (and no `sessionId` is given), the runner will resume the active session
   * for this user/agent/channel combination instead of creating a new one.
   */
  readonly channelId?: string;
  /** External platform chat identifier (e.g., Telegram chat ID). Defaults to 'system'. */
  readonly chatId?: string;
  /** User display name. Defaults to 'System'. */
  readonly userName?: string;
  /** Optional reply context from channel adapters (e.g., Telegram reply_to_message). */
  readonly replyContext?: InboundMessage['replyCtx'];
  /** When true, this is a re-invocation triggered by sub-agent result delivery. Reuses existing session. */
  readonly isReinvocation?: boolean;
  /**
   * Token budget for this run (inputTokens + outputTokens, cumulative across
   * primary + all spawned sub-agents). Null/omit for no limit. Ignored when
   * `budgetTracker` is provided (sub-agent path).
   */
  readonly tokenBudget?: number | null;
  /** Grace window as a percentage before hard kill. Default: 10. */
  readonly tokenGracePercent?: number;
  /**
   * Pre-existing budget tracker shared across the agent run. Sub-agents
   * receive the parent's tracker via the spawn tool so the run-wide ceiling
   * caps total cost across primary + sub-agents.
   */
  readonly budgetTracker?: BudgetTracker;
  /** Wall-clock timeout for the entire agent run in milliseconds. Default: 300000 (5 min). */
  readonly timeoutMs?: number;
  /** Caller-supplied persistence backend. When provided, agent-runner does NOT
   *  create or resume a Session — all transcript persistence flows through the store. */
  readonly messageStore?: MessageStore;
  /**
   * How to assemble the final output string.
   * - 'final' (default): only the last assistant response. Matches sub-agent / streaming-channel behavior.
   * - 'fullTranscript': concatenate all assistant text across the run. Use for cron firings so deliverables
   *   emitted before tool calls are not lost behind the agent's confirmation message.
   */
  readonly outputMode?: 'final' | 'fullTranscript';
  /**
   * Streaming event sink. When provided, the agent runner forwards it to
   * the underlying ReasoningLoop — but ONLY when the run is a primary
   * (non-sub-agent) run AND `agentDef.streamingEnabled` is true. In all
   * other cases the callback is dropped. See `RunResult.streamingUsed`.
   */
  readonly onEvent?: (event: ReasoningEvent) => void | Promise<void>;
}

/** Result returned after an agent run completes (or fails). */
export interface RunResult {
  readonly agentRunId: string;
  readonly sessionId: string | null;
  readonly output: string | null;
  readonly status: AgentStatus;
  readonly tokenUsage: TokenUsageRecord;
  readonly responseMessageId?: string;
  readonly error?: string;
  /**
   * True when the runner actually wired the caller's `onEvent` callback
   * through to the reasoning loop. Channel adapters use this to decide
   * whether to send a trailing single-message reply (when false) or skip
   * it because the user already received the content as streamed chunks
   * (when true).
   */
  readonly streamingUsed: boolean;
}
