import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return {
    ApiError,
    apiFetch: vi.fn(),
  };
});

import { apiFetch, ApiError } from '../api';
import { parseJwtPayload, authFetch, clearTokens } from '../auth';

const mockedApiFetch = vi.mocked(apiFetch);

function signFakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.`;
}

describe('parseJwtPayload', () => {
  it('returns AuthUser for a payload with all required string fields', () => {
    const token = signFakeJwt({
      sub: 'u-1',
      email: 'a@b.test',
      role: 'admin',
      policyName: 'Standard',
    });
    expect(parseJwtPayload(token)).toEqual({
      sub: 'u-1',
      email: 'a@b.test',
      role: 'admin',
      policyName: 'Standard',
    });
  });

  it('returns null when sub is missing', () => {
    const token = signFakeJwt({ email: 'a@b.test', role: 'admin', policyName: 'Standard' });
    expect(parseJwtPayload(token)).toBeNull();
  });

  it('returns null when a field is the wrong type (number instead of string)', () => {
    const token = signFakeJwt({ sub: 'u-1', email: 42, role: 'admin', policyName: 'Standard' });
    expect(parseJwtPayload(token)).toBeNull();
  });

  it('returns null when a field is an empty string', () => {
    const token = signFakeJwt({ sub: 'u-1', email: '', role: 'admin', policyName: 'Standard' });
    expect(parseJwtPayload(token)).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(parseJwtPayload('not.a.jwt')).toBeNull();
    expect(parseJwtPayload('')).toBeNull();
  });
});

describe('authFetch — 401 retry after refresh', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    clearTokens();
    // Mark session cookie so ensureAccessToken attempts refresh on first call.
    document.cookie = 'clawix_has_session=1; path=/';
  });

  afterEach(() => {
    document.cookie = 'clawix_has_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('refreshes and retries once when the request returns 401', async () => {
    const goodToken = signFakeJwt({
      sub: 'u',
      email: 'a@b',
      role: 'admin',
      policyName: 'Standard',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    mockedApiFetch
      // First call: refresh (because cache is empty + session cookie set)
      .mockResolvedValueOnce({ accessToken: goodToken, refreshToken: '' })
      // Second call: actual /thing request — server says 401 (token expired mid-flight)
      .mockRejectedValueOnce(new ApiError(401, 'Token expired'))
      // Third call: refresh again (triggered by 401 handler)
      .mockResolvedValueOnce({ accessToken: goodToken, refreshToken: '' })
      // Fourth call: retried /thing request — succeeds
      .mockResolvedValueOnce({ ok: true });

    const result = await authFetch<{ ok: boolean }>('/thing');
    expect(result).toEqual({ ok: true });
    expect(mockedApiFetch).toHaveBeenCalledTimes(4);
  });

  it('rethrows the 401 if the post-401 refresh also fails', async () => {
    const goodToken = signFakeJwt({
      sub: 'u',
      email: 'a@b',
      role: 'admin',
      policyName: 'Standard',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    mockedApiFetch
      .mockResolvedValueOnce({ accessToken: goodToken, refreshToken: '' })
      .mockRejectedValueOnce(new ApiError(401, 'Token expired'))
      // Post-401 refresh: also 401 → returns null → original 401 rethrown
      .mockRejectedValueOnce(new ApiError(401, 'Refresh rejected'));

    await expect(authFetch('/thing')).rejects.toBeInstanceOf(ApiError);
  });

  it('does not retry on non-401 errors', async () => {
    const goodToken = signFakeJwt({
      sub: 'u',
      email: 'a@b',
      role: 'admin',
      policyName: 'Standard',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    mockedApiFetch
      .mockResolvedValueOnce({ accessToken: goodToken, refreshToken: '' })
      .mockRejectedValueOnce(new ApiError(500, 'Internal'));

    await expect(authFetch('/thing')).rejects.toMatchObject({ status: 500 });
    // Only the refresh + the failing call — no retry.
    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
  });
});
