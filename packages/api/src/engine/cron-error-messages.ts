export interface TranslateCronErrorContext {
  /** The effective timeout in milliseconds applied to the failed run. */
  readonly timeoutMs: number;
}

const FALLBACK_RAW_TRUNCATE = 200;
const UNKNOWN_REASON = 'the task failed for an unknown reason.';
const BUDGET_TEXT = 'the task ran out of its token budget before finishing.';
const CONTAINER_TEXT = 'the agent container failed to start or crashed.';

/**
 * Translate a raw `TaskRun.error` string into a user-friendly sentence.
 *
 * The raw error is normalized (lowercase + underscores → spaces) for matching,
 * but the original string is preserved when surfaced in the fallback message.
 */
export function translateCronError(
  rawError: string | null | undefined,
  ctx: TranslateCronErrorContext,
): string {
  if (rawError == null || rawError === '') {
    return UNKNOWN_REASON;
  }

  const normalized = rawError.toLowerCase().replace(/_/g, ' ');

  if (normalized === 'execution timeout' || normalized.includes('timed out')) {
    const minutes = Math.round(ctx.timeoutMs / 60_000);
    return `your scheduled task hit the ${minutes}-minute limit and was stopped.`;
  }

  if (normalized.includes('budget')) {
    return BUDGET_TEXT;
  }

  if (normalized.includes('container')) {
    return CONTAINER_TEXT;
  }

  const truncated =
    rawError.length > FALLBACK_RAW_TRUNCATE
      ? `${rawError.slice(0, FALLBACK_RAW_TRUNCATE)}…`
      : rawError;
  return `the task encountered an error: ${truncated}`;
}
