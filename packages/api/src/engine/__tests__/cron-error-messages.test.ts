import { describe, it, expect } from 'vitest';

import { translateCronError } from '../cron-error-messages.js';

describe('translateCronError', () => {
  it('returns unknown-reason text for null', () => {
    const result = translateCronError(null, { timeoutMs: 900_000 });
    expect(result).toBe('the task failed for an unknown reason.');
  });

  it('returns unknown-reason text for undefined', () => {
    const result = translateCronError(undefined, { timeoutMs: 900_000 });
    expect(result).toBe('the task failed for an unknown reason.');
  });

  it('returns unknown-reason text for empty string', () => {
    const result = translateCronError('', { timeoutMs: 900_000 });
    expect(result).toBe('the task failed for an unknown reason.');
  });

  it('returns timeout text for execution_timeout with 15 minute timeout', () => {
    const result = translateCronError('execution_timeout', { timeoutMs: 900_000 });
    expect(result).toBe('your scheduled task hit the 15-minute limit and was stopped.');
  });

  it('returns timeout text for "Agent run timed out" with 10 minute timeout', () => {
    const result = translateCronError('Agent run timed out', { timeoutMs: 600_000 });
    expect(result).toBe('your scheduled task hit the 10-minute limit and was stopped.');
  });

  it('returns timeout text for any error containing "timed out" (case-insensitive)', () => {
    const result = translateCronError('Tool TIMED OUT after 30s', { timeoutMs: 900_000 });
    expect(result).toBe('your scheduled task hit the 15-minute limit and was stopped.');
  });

  it('returns budget text for "token_budget_exceeded" (underscore variant)', () => {
    const result = translateCronError('token_budget_exceeded', { timeoutMs: 900_000 });
    expect(result).toBe('the task ran out of its token budget before finishing.');
  });

  it('returns budget text for "Token budget exceeded"', () => {
    const result = translateCronError('Token budget exceeded', { timeoutMs: 900_000 });
    expect(result).toBe('the task ran out of its token budget before finishing.');
  });

  it('returns container text for container errors', () => {
    const result = translateCronError('container start failed', { timeoutMs: 900_000 });
    expect(result).toBe('the agent container failed to start or crashed.');
  });

  it('returns fallback text with raw error for unrecognized errors', () => {
    const result = translateCronError('something unknown blew up', { timeoutMs: 900_000 });
    expect(result).toBe('the task encountered an error: something unknown blew up');
  });

  it('truncates fallback raw error to 200 chars with ellipsis', () => {
    const longError = 'X'.repeat(500);
    const result = translateCronError(longError, { timeoutMs: 900_000 });
    expect(result).toBe(`the task encountered an error: ${'X'.repeat(200)}…`);
    expect(result.length).toBeLessThanOrEqual(
      `the task encountered an error: ${'X'.repeat(200)}…`.length,
    );
  });

  it('preserves original (non-normalized) raw error in fallback message', () => {
    const result = translateCronError('Weird_Error_With_Underscores', { timeoutMs: 900_000 });
    expect(result).toBe('the task encountered an error: Weird_Error_With_Underscores');
  });

  it('rounds non-integer minute values', () => {
    const result = translateCronError('execution_timeout', { timeoutMs: 90_000 });
    // 90_000 / 60_000 = 1.5 → round to 2
    expect(result).toBe('your scheduled task hit the 2-minute limit and was stopped.');
  });
});
