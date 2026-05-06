/**
 * Type definitions for the classifier-driven recovery layer in the agent
 * runner. The classifier categorizes a thrown error and emits flags that
 * the recovery loop dispatches on. Two flags (rotatable, fallbackable) are
 * populated correctly today but consumed by deferred follow-up specs.
 */

import type { Logger } from 'pino';
import type { ChatMessage } from '@clawix/shared';

/* -------------------------- Categories & flags -------------------------- */

export type ErrorCategory =
  // Provider transient (retryable)
  | 'network'
  | 'timeout'
  | 'overloaded'
  | 'server_error'
  | 'rate_limit'
  // Provider permanent (recovery deferred)
  | 'auth'
  | 'billing'
  | 'model_not_found'
  | 'provider_policy'
  // Provider permanent (no recovery in v1)
  | 'context_overflow'
  | 'payload_too_large'
  | 'bad_request'
  // Non-provider
  | 'policy'
  | 'loop_aborted'
  | 'unknown';

export interface RecoveryFlags {
  readonly retryable: boolean;
  readonly compressible: boolean;
  readonly rotatable: boolean;
  readonly fallbackable: boolean;
}

export interface ClassifiedError {
  readonly category: ErrorCategory;
  /** User-safe display text. Never contains stack traces or provider internals. */
  readonly text: string;
  readonly flags: RecoveryFlags;
  /** Original error reference, for logging. Never sent to user. */
  readonly cause: unknown;
}

/* ----------------------------- Recovery loop ---------------------------- */

export interface RecoveryConfig {
  readonly maxRetries: number;
  readonly retryBackoffMs: readonly number[];
  readonly maxCompressions: number;
  readonly globalCap: number;
}

export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  maxRetries: 3,
  retryBackoffMs: [500, 1000, 2000],
  maxCompressions: 1,
  globalCap: 5,
};

export type RecoveryEventType = 'recovery_action' | 'recovery_exhausted' | 'recovery_succeeded';

export type RecoveryAction = 'retry' | 'compress';

export type RecoveryExhaustedReason = 'global_cap' | 'no_action' | 'compress_failed';

export interface RecoveryEvent {
  readonly type: RecoveryEventType;
  readonly category: ErrorCategory;
  readonly attempt: number;
  /** Present when type === 'recovery_action' or 'recovery_succeeded'. */
  readonly action?: RecoveryAction;
  /** Present when type === 'recovery_action' && action === 'retry'. */
  readonly delayMs?: number;
  /** Present when type === 'recovery_exhausted'. */
  readonly reason?: RecoveryExhaustedReason;
  /** Provider name; included for metric labels. */
  readonly provider?: string;
}

export interface RecoveryDeps {
  readonly classifier: (err: unknown) => ClassifiedError;
  readonly compressor: (messages: readonly ChatMessage[]) => Promise<readonly ChatMessage[]>;
  readonly onRecoveryEvent?: (e: RecoveryEvent) => void;
  readonly logger?: Logger;
  readonly provider?: string;
}
