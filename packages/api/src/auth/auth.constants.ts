export const JWT_ACCESS_EXPIRY = '15m';
export const JWT_REFRESH_EXPIRY = '7d';
export const REFRESH_TOKEN_PREFIX = 'refresh_token:';
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const BCRYPT_SALT_ROUNDS_DEFAULT = 12;

// Progressive login delay (per-email)
export const LOGIN_FAIL_PREFIX = 'login_fail:';
export const LOGIN_FAIL_TTL_SECONDS = 3600; // 1 hour
export const MAX_DELAY_SECONDS = 30;

// Refresh token cookie
export const REFRESH_COOKIE_NAME = 'clawix_refresh';
// AuthController is mounted at `/auth` (no /api/v1 prefix); cookie path must
// match so the browser sends it on /auth/refresh and /auth/logout.
export const REFRESH_COOKIE_PATH = '/auth';
export const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds
