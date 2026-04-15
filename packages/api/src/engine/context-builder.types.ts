import type { ChatMessage } from '@clawix/shared';

/** Fields from AgentDefinition needed by ContextBuilder. */
export interface ContextAgentDef {
  readonly name: string;
  readonly description: string | null;
  readonly systemPrompt: string;
}

/** Parameters for building enriched messages. */
export interface ContextBuildParams {
  readonly agentDef: ContextAgentDef;
  readonly history: readonly ChatMessage[];
  readonly input: string;
  readonly userId: string;
  /** Channel type. Defaults to 'internal'. */
  readonly channel?: string;
  /** External platform chat identifier (e.g., Telegram chat ID). Defaults to 'system'. */
  readonly chatId?: string;
  /** User display name. Defaults to 'System'. */
  readonly userName?: string;
  /** Resolved local workspace path for loading bootstrap files. */
  readonly workspacePath?: string;
  /** When true, skips bootstrap files and adds sub-agent framing to the system prompt. */
  readonly isSubAgent?: boolean;
  /** Available worker agents for the primary agent to spawn. Omit for sub-agents. */
  readonly workers?: readonly WorkerSummary[];
}

/** Lightweight summary of a worker agent injected into the primary agent's system prompt. */
export interface WorkerSummary {
  readonly name: string;
  readonly description: string | null;
}

/** Maximum estimated tokens for the MEMORY.md long-term narrative section. */
export const MEMORY_FILE_TOKEN_BUDGET = 1500;

/** Maximum estimated tokens for the daily notes section (last 3 days). */
export const DAILY_NOTES_TOKEN_BUDGET = 1000;

/** Number of days of daily notes to auto-load into context. */
export const DAILY_NOTES_DAYS = 3;

/** Maximum characters per individual memory item before truncation. */
export const MEMORY_ITEM_MAX_CHARS = 500;
