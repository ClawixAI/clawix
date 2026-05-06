/**
 * Classifier-driven recovery layer for the agent runner. Wraps a single
 * provider.chat() call. On failure, classifies the error and dispatches
 * one of: retry (with backoff), compress (transform messages and retry),
 * or surface (no applicable action / budget exhausted).
 *
 * Replaces ResilientLLMProvider. See spec §4.
 */

import { createLogger } from '@clawix/shared';
import type { ChatMessage, ChatOptions, LLMProvider, LLMResponse } from '@clawix/shared';

import {
  DEFAULT_RECOVERY_CONFIG,
  type RecoveryConfig,
  type RecoveryDeps,
  type RecoveryEvent,
} from './recovery-loop.types.js';

const defaultLogger = createLogger('engine:recovery-loop');

interface RecoveryResult {
  readonly response: LLMResponse;
  readonly messages: readonly ChatMessage[];
}

async function delayWithJitter(baseMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (baseMs <= 0) return;
  const jittered = baseMs + Math.random() * baseMs * 0.5;
  return new Promise<void>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, jittered);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run provider.chat() with classifier-driven recovery. The returned
 * `messages` array is the (possibly compressed) sequence used for the
 * successful call — the reasoning loop reassigns its outer `messages`
 * variable so subsequent iterations use it.
 *
 * NOTE on streaming (spec §6): in v1 the LLMProvider contract returns the
 * full response from provider.chat() — there is no token-level streaming
 * for the recovery loop to short-circuit against. The reasoning-loop's
 * onEvent emits AFTER provider.chat() returns. The mid-stream guard in
 * spec §6 is preserved as forward-looking design intent; when token-level
 * streaming lands in the provider contract, add streamStarted detection
 * here at that time. For now: every error is pre-stream.
 */
export async function runWithRecovery(
  provider: LLMProvider,
  messages: readonly ChatMessage[],
  options: ChatOptions,
  deps: RecoveryDeps,
  config: RecoveryConfig = DEFAULT_RECOVERY_CONFIG,
): Promise<RecoveryResult> {
  const logger = deps.logger ?? defaultLogger;

  let currentMessages: readonly ChatMessage[] = messages;
  let retryCount = 0;
  let compressCount = 0;
  let totalActions = 0;

  let lastAction: 'retry' | 'compress' | undefined;
  let lastCategory: RecoveryEvent['category'] | undefined;

  for (;;) {
    try {
      const response = await provider.chat(currentMessages, options);
      if (totalActions > 0) {
        emit(deps, {
          type: 'recovery_succeeded',
          category: lastCategory ?? 'unknown',
          attempt: totalActions,
          action: lastAction,
          provider: deps.provider,
        });
      }
      return { response, messages: currentMessages };
    } catch (err) {
      // Cancellation: propagate immediately, no recovery.
      if (options.abortSignal?.aborted) throw err;

      const classified = deps.classifier(err);
      totalActions += 1;
      lastCategory = classified.category;

      // Global safety cap: at most `globalCap` recovery actions per run. The
      // check fires AFTER incrementing totalActions, so totalActions==globalCap+1
      // triggers the cap. With default globalCap=5 this allows at most 5 actions
      // (one of each: 3 retries + 1 compress = 4 in normal usage; cap fires only
      // in unexpected loops).
      if (totalActions > config.globalCap) {
        emit(deps, {
          type: 'recovery_exhausted',
          category: classified.category,
          attempt: totalActions,
          reason: 'global_cap',
          provider: deps.provider,
        });
        logger.warn(
          { category: classified.category, totalActions },
          'recovery_exhausted: global_cap',
        );
        throw err;
      }

      // Retry path.
      if (classified.flags.retryable && retryCount < config.maxRetries) {
        const delayMs = config.retryBackoffMs[retryCount] ?? 0;
        retryCount += 1;
        lastAction = 'retry';
        emit(deps, {
          type: 'recovery_action',
          action: 'retry',
          category: classified.category,
          attempt: totalActions,
          delayMs,
          provider: deps.provider,
        });
        logger.warn(
          { category: classified.category, attempt: totalActions, delayMs },
          'recovery_action: retry',
        );
        try {
          await delayWithJitter(delayMs, options.abortSignal);
        } catch {
          // Aborted mid-backoff: re-check the signal and propagate the original
          // error (the one that triggered this retry attempt).
          if (options.abortSignal?.aborted) throw err;
          // Otherwise (shouldn't happen — only abort-throws here), surface anyway.
          throw err;
        }
        continue;
      }

      // Compress path.
      if (classified.flags.compressible && compressCount < config.maxCompressions) {
        let compressed: readonly ChatMessage[];
        try {
          compressed = await deps.compressor(currentMessages);
        } catch (compressErr) {
          emit(deps, {
            type: 'recovery_exhausted',
            category: classified.category,
            attempt: totalActions,
            reason: 'compress_failed',
            provider: deps.provider,
          });
          logger.warn(
            { compressErr, category: classified.category },
            'recovery_exhausted: compress_failed',
          );
          throw err; // surface ORIGINAL provider error
        }
        currentMessages = compressed;
        compressCount += 1;
        lastAction = 'compress';
        emit(deps, {
          type: 'recovery_action',
          action: 'compress',
          category: classified.category,
          attempt: totalActions,
          provider: deps.provider,
        });
        logger.info(
          { category: classified.category, attempt: totalActions },
          'recovery_action: compress',
        );
        continue;
      }

      // No applicable recovery action with budget left.
      emit(deps, {
        type: 'recovery_exhausted',
        category: classified.category,
        attempt: totalActions,
        reason: 'no_action',
        provider: deps.provider,
      });
      logger.warn({ category: classified.category }, 'recovery_exhausted: no_action');
      throw err;
    }
  }
}

function emit(deps: RecoveryDeps, event: RecoveryEvent): void {
  if (deps.onRecoveryEvent) deps.onRecoveryEvent(event);
}
