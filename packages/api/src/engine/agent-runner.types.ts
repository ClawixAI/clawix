import type { AgentStatus, TokenUsageRecord } from '@clawix/shared';

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
  /** External platform chat identifier (e.g., Telegram chat ID). Defaults to 'system'. */
  readonly chatId?: string;
  /** User display name. Defaults to 'System'. */
  readonly userName?: string;
  /** When true, this is a re-invocation triggered by sub-agent result delivery. Reuses existing session. */
  readonly isReinvocation?: boolean;
  /** Token budget for this run (inputTokens + outputTokens). Omit for no limit. */
  readonly tokenBudget?: number;
  /** Grace window as a percentage before hard kill. Default: 10. */
  readonly tokenGracePercent?: number;
  /** Wall-clock timeout for the entire agent run in milliseconds. Default: 300000 (5 min). */
  readonly timeoutMs?: number;
}

/** Result returned after an agent run completes (or fails). */
export interface RunResult {
  readonly agentRunId: string;
  readonly sessionId: string;
  readonly output: string | null;
  readonly status: AgentStatus;
  readonly tokenUsage: TokenUsageRecord;
  readonly responseMessageId?: string;
  readonly error?: string;
}
