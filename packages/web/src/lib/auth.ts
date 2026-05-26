import { apiFetch, ApiError } from './api';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  sub: string;
  email: string;
  role: string;
  // Mirrors the backend JWT field — the API signs `policyName` from the user's
  // `Policy` row (see packages/api/src/auth/auth.service.ts). The DB model is
  // `Policy`, not `Plan`, so the field name must match exactly or
  // `parseJwtPayload` returns null and login fails with "Invalid token received".
  policyName: string;
}

// Access token lives in memory only — never in localStorage. If the user
// reloads the tab, AuthProvider calls ensureAccessToken() which uses the
// httpOnly clawix_refresh cookie to mint a new access token.
//
// The clawix_has_session cookie (non-httpOnly) is a simple "yes, you have a
// refresh cookie" flag so we know whether to attempt a refresh on mount
// versus immediately redirecting to login.
let accessTokenCache: string | null = null;

const SESSION_COOKIE_NAME = 'clawix_has_session';
const LEGACY_ACCESS_KEY = 'clawix_access_token';
const LEGACY_REFRESH_KEY = 'clawix_refresh_token';

// One-shot migration: clear any tokens left in localStorage from before
// the cookie migration. Safe to keep indefinitely; eventually all live
// browsers will have flushed these.
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem(LEGACY_ACCESS_KEY);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
  } catch {
    // localStorage can throw in private browsing modes — ignore.
  }
}

function setSessionCookie(set: boolean): void {
  if (typeof window === 'undefined') return;
  if (set) {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${SESSION_COOKIE_NAME}=1; path=/; SameSite=Lax${secure}`;
  } else {
    document.cookie = `${SESSION_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

export function hasSessionCookie(): boolean {
  if (typeof window === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${SESSION_COOKIE_NAME}=1`));
}

/**
 * Returns the in-memory access token (and a placeholder refresh token to
 * preserve the existing TokenPair shape). The real refresh token lives in
 * the httpOnly clawix_refresh cookie and is never exposed to JS.
 *
 * Returns null when there is no access token in memory.
 */
export function getStoredTokens(): TokenPair | null {
  if (!accessTokenCache) return null;
  return { accessToken: accessTokenCache, refreshToken: '' };
}

/** Store the access token in memory and mark the session cookie. */
function rememberAccessToken(accessToken: string): void {
  accessTokenCache = accessToken;
  setSessionCookie(true);
}

export function clearTokens(): void {
  accessTokenCache = null;
  setSessionCookie(false);
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function parseJwtPayload(token: string): AuthUser | null {
  const decoded = decodeJwt(token);
  if (!decoded) return null;
  const sub = pickString(decoded, 'sub');
  const email = pickString(decoded, 'email');
  const role = pickString(decoded, 'role');
  const policyName = pickString(decoded, 'policyName');
  if (!sub || !email || !role || !policyName) return null;
  return { sub, email, role, policyName };
}

export function isTokenExpired(token: string): boolean {
  const decoded = decodeJwt(token);
  if (!decoded || typeof decoded['exp'] !== 'number') return true;
  return decoded['exp'] * 1000 < Date.now();
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const tokens = await apiFetch<TokenPair>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  rememberAccessToken(tokens.accessToken);
  const user = parseJwtPayload(tokens.accessToken);
  if (!user) throw new Error('Invalid token received');
  return user;
}

// Mutex prevents concurrent refresh calls from racing each other —
// the API rotates refresh tokens on every refresh, so only the first
// caller would succeed.
let refreshPromise: Promise<TokenPair | null> | null = null;

async function doRefresh(): Promise<TokenPair | null> {
  try {
    // Body is empty — the httpOnly cookie carries the refresh token.
    // Send '{}' so the Zod-validated refreshSchema receives an object.
    const tokens = await apiFetch<TokenPair>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    rememberAccessToken(tokens.accessToken);
    return tokens;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      clearTokens();
    }
    return null;
  }
}

export async function refreshTokens(): Promise<TokenPair | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function logout(): Promise<void> {
  // Body is empty — the httpOnly cookie carries the refresh token.
  await apiFetch('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  }).catch(() => {
    /* ignore logout failure — we still clear local state */
  });
  clearTokens();
}

/**
 * Returns a usable access token, refreshing via cookie if needed.
 *
 * Use this from any component that needs the bearer token (uploads,
 * websockets, etc). On a fresh page load the in-memory cache is empty;
 * if the session cookie is present, attempt a refresh.
 */
export async function ensureAccessToken(): Promise<string | null> {
  if (accessTokenCache && !isTokenExpired(accessTokenCache)) {
    return accessTokenCache;
  }
  if (!hasSessionCookie()) return null;
  const refreshed = await refreshTokens();
  return refreshed?.accessToken ?? null;
}

// Kept as the previous async name for backward compat with existing
// call sites (upload-zone, workspace, projector, use-chat).
export const getAccessToken = ensureAccessToken;

/**
 * Wrapper for authenticated API calls — auto-attaches JWT and refreshes if
 * expired. If the server returns 401 mid-flight (e.g. token expired between
 * the client-side expiry check and the request reaching the API), refresh
 * once and retry. Re-throws on the second 401 so callers can surface the
 * auth failure.
 */
export async function authFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await ensureAccessToken();
  if (!token) throw new ApiError(401, 'Not authenticated');
  try {
    return await apiFetch<T>(path, { ...options, accessToken: token });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const refreshed = await refreshTokens();
      if (refreshed?.accessToken) {
        return apiFetch<T>(path, { ...options, accessToken: refreshed.accessToken });
      }
    }
    throw err;
  }
}
