import { describe, it, expect, vi } from 'vitest';

// The refresh path SSRF-guards the token URL; stub it so unit tests don't do real DNS.
vi.mock('../../engine/tools/web/ssrf-protection.js', () => ({
  validateUrl: vi.fn().mockResolvedValue({ resolvedIp: '203.0.113.1', protocol: 'https:' }),
}));

import { McpTokenManager, ReauthRequiredError } from '../mcp-token-manager.service.js';

const FIXED_NOW = new Date('2026-06-10T00:00:00Z').getTime();

// helper: the manager uses injected encrypt/decrypt; for the test inject identity.
function encStub(s: string): string {
  return s;
}

function build() {
  const repo = {
    findOAuthToken: vi.fn(),
    upsertOAuthToken: vi.fn().mockResolvedValue(undefined),
    setConnectionStatus: vi.fn().mockResolvedValue(undefined),
    findServerForConnection: vi.fn(),
  };
  const redis = { acquireLock: vi.fn().mockResolvedValue(true), releaseLock: vi.fn() };
  const audit = { create: vi.fn().mockResolvedValue(undefined) };
  const notifications = { create: vi.fn().mockResolvedValue(undefined) };
  const fetchFn = vi.fn();
  const mgr = new McpTokenManager(
    repo as never,
    redis as never,
    audit as never,
    notifications as never,
    {
      fetchFn: fetchFn as never,
      now: () => FIXED_NOW,
      encrypt: encStub,
      decrypt: encStub,
    },
  );
  return { mgr, repo, redis, audit, notifications, fetchFn };
}

describe('McpTokenManager', () => {
  it('returns the stored access token when it is not near expiry', async () => {
    const { mgr, repo, fetchFn } = build();
    repo.findOAuthToken.mockResolvedValue({
      accessTokenEnc: encStub('good'),
      refreshTokenEnc: encStub('r'),
      expiresAt: new Date(FIXED_NOW + 5 * 60_000),
      scope: 's',
    });
    const t = await mgr.getAccessToken('c1', 'user-1');
    expect(t).toBe('good');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refreshes when within the 60s skew and persists the rotated token', async () => {
    const { mgr, repo, fetchFn } = build();
    repo.findOAuthToken.mockResolvedValue({
      accessTokenEnc: encStub('old'),
      refreshTokenEnc: encStub('r0'),
      expiresAt: new Date(FIXED_NOW + 30_000),
      scope: 's',
    });
    repo.findServerForConnection.mockResolvedValue({
      oauthTokenUrl: 'https://token',
      oauthClientId: 'id',
      oauthClientSecretEnc: null,
    });
    fetchFn.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new',
        refresh_token: 'r1',
        expires_in: 3600,
        scope: 's',
      }),
    });
    const t = await mgr.getAccessToken('c1', 'user-1');
    expect(t).toBe('new');
    expect(repo.upsertOAuthToken).toHaveBeenCalled();
  });

  it('marks reauth_required + notifies on invalid_grant', async () => {
    const { mgr, repo, fetchFn, notifications } = build();
    repo.findOAuthToken.mockResolvedValue({
      accessTokenEnc: encStub('old'),
      refreshTokenEnc: encStub('r0'),
      expiresAt: new Date(FIXED_NOW - 1000),
      scope: 's',
    });
    repo.findServerForConnection.mockResolvedValue({
      oauthTokenUrl: 'https://token',
      oauthClientId: 'id',
      oauthClientSecretEnc: null,
    });
    fetchFn.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
    });
    await expect(mgr.getAccessToken('c1', 'user-1')).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(repo.setConnectionStatus).toHaveBeenCalledWith(
      'c1',
      'reauth_required',
      expect.any(String),
    );
    expect(notifications.create).toHaveBeenCalled();
  });
});
