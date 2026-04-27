/**
 * ResilientLLMProvider — wraps any LLMProvider with retry + jitter backoff
 * for transient errors (rate limits, server errors, network timeouts).
 */

import type { ChatMessage, ChatOptions, LLMProvider, LLMResponse } from '@clawix/shared';
import { createLogger } from '@clawix/shared';

const logger = createLogger('engine:resilience');

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Configuration for retry behaviour. */
export interface RetryConfig {
  /** Number of retries after the initial attempt. */
  readonly maxRetries: number;
  /**
   * Base delay in milliseconds for each retry attempt.
   * Array length must equal maxRetries.  Set entries to 0 in tests.
   */
  readonly backoffMs: readonly number[];
  /** Substrings (case-insensitive) that identify a transient error. */
  readonly transientPatterns: readonly string[];
}

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

/** Default retry configuration shipped with Clawix. */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  backoffMs: [500, 1000, 2000],
  transientPatterns: [
    'status 429',
    'rate limit',
    'rate_limit',
    'status 500',
    'status 502',
    'status 503',
    'status 504',
    'overloaded',
    'timeout',
    'ETIMEDOUT',
    'ECONNRESET',
    'connection',
    'server error',
    'internal server error',
  ],
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Returns `true` when the error message matches a known transient pattern.
 * Matching is case-insensitive substring search.
 *
 * @param message - The error message to test.
 * @param patterns - Override pattern list (defaults to DEFAULT_RETRY_CONFIG.transientPatterns).
 */
export function isTransientError(
  message: string,
  patterns: readonly string[] = DEFAULT_RETRY_CONFIG.transientPatterns,
): boolean {
  const lower = message.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

/** Sleeps for `ms` milliseconds, adding up to 50 % random jitter. */
async function delayWithJitter(baseMs: number): Promise<void> {
  if (baseMs <= 0) return;
  const jittered = baseMs + Math.random() * baseMs * 0.5;
  await new Promise<void>((resolve) => setTimeout(resolve, jittered));
}

/* ------------------------------------------------------------------ */
/*  ResilientLLMProvider                                               */
/* ------------------------------------------------------------------ */

/**
 * Decorates an `LLMProvider` with retry logic.
 *
 * On every transient failure the provider waits `backoffMs[attempt]`
 * (plus ≤50 % random jitter) before retrying.  Non-transient errors
 * are re-thrown immediately without consuming any retry budget.
 */
export class ResilientLLMProvider implements LLMProvider {
  private readonly inner: LLMProvider;
  private readonly config: RetryConfig;

  constructor(inner: LLMProvider, config?: Partial<RetryConfig>) {
    this.inner = inner;
    this.config = {
      ...DEFAULT_RETRY_CONFIG,
      ...config,
      // Merge arrays explicitly so partial overrides work correctly.
      backoffMs: config?.backoffMs ?? DEFAULT_RETRY_CONFIG.backoffMs,
      transientPatterns: config?.transientPatterns ?? DEFAULT_RETRY_CONFIG.transientPatterns,
    };
  }

  /** Delegates to the inner provider's name. */
  get name(): string {
    return this.inner.name;
  }

  /**
   * Sends a chat request, retrying on transient errors up to `maxRetries` times.
   */
  async chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      try {
        return await this.inner.chat(messages, options);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        // If the caller's abort signal has fired, the error is intentional
        // cancellation — propagate immediately without retrying. Otherwise
        // a timeout/cancel would just trigger N retries before bubbling up.
        if (options?.abortSignal?.aborted) {
          throw err;
        }

        if (!isTransientError(message, this.config.transientPatterns)) {
          // Not a transient error — propagate immediately.
          throw err;
        }

        lastError = err;
        const retriesLeft = this.config.maxRetries - attempt;

        if (retriesLeft === 0) {
          break;
        }

        const baseMs = this.config.backoffMs[attempt] ?? 0;
        logger.warn(
          {
            attempt,
            retriesLeft,
            errorMessage: message,
            delayMs: baseMs,
          },
          'Transient LLM error — retrying',
        );

        await delayWithJitter(baseMs);
      }
    }

    throw lastError;
  }
}
