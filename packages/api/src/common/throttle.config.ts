import type { ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../auth/auth.types.js';

/**
 * Rate limit tiers per policy name.
 * Requests per 60-second window.
 */
const POLICY_LIMITS: Readonly<Record<string, number>> = {
  Standard: 30,
  Extended: 120,
  Unrestricted: 600,
};

const DEFAULT_LIMIT = 30;
const DEFAULT_TTL_MS = 60_000;

/** Shared window for auth endpoints. */
export const AUTH_THROTTLE_TTL_MS = 60_000;

/**
 * Login: strict limit + punitive block to deter password brute-force.
 * Each attempt consumes credentials, so 5/min with a 5-min lockout fits
 * the threat model.
 */
export const LOGIN_THROTTLE_LIMIT = 5;
export const LOGIN_THROTTLE_BLOCK_MS = 300_000;

/**
 * Refresh: relaxed limit, no block. The endpoint already requires a valid
 * refresh token, so it is not a brute-force surface. The dashboard may fire
 * several refreshes in quick succession (parallel API calls on page load,
 * multiple open tabs), and a 5-min lockout after a transient burst makes
 * the app unusable for legitimate users.
 */
export const REFRESH_THROTTLE_LIMIT = 30;

/**
 * Resolvable limit function: reads the user's policyName from the JWT payload
 * and returns the corresponding rate limit. Falls back to DEFAULT_LIMIT
 * for unauthenticated requests or unknown policies.
 */
export function resolvePolicyLimit(context: ExecutionContext): number {
  const req = context.switchToHttp().getRequest<Record<string, unknown>>();
  const user = req['user'] as JwtPayload | undefined;
  if (user?.policyName && user.policyName in POLICY_LIMITS) {
    return POLICY_LIMITS[user.policyName]!;
  }
  return DEFAULT_LIMIT;
}

/**
 * Resolvable TTL function: all policies share the same window.
 * Can be extended per-policy if needed.
 */
export function resolvePolicyTtl(_context: ExecutionContext): number {
  return DEFAULT_TTL_MS;
}
