import { Injectable, Optional } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import { decrypt as cryptoDecrypt, encrypt as cryptoEncrypt } from '../common/crypto.js';
import { McpServerRepository } from '../db/mcp-server.repository.js';
import { AuditLogRepository } from '../db/audit-log.repository.js';
import { NotificationRepository } from '../db/notification.repository.js';
import { RedisService } from '../cache/redis.service.js';
import { validateUrl } from '../engine/tools/web/ssrf-protection.js';

const logger = createLogger('mcp:token-manager');
const EXPIRY_SKEW_MS = 60_000;
const LOCK_TTL_S = 15;

/** Thrown when a connection's OAuth token can't be refreshed and the user must re-auth. */
export class ReauthRequiredError extends Error {
  constructor(public readonly connectionId: string) {
    super('MCP connection requires re-authentication');
    this.name = 'ReauthRequiredError';
  }
}

interface Deps {
  fetchFn?: typeof fetch;
  now?: () => number;
  encrypt?: (s: string) => string;
  decrypt?: (s: string) => string;
}

interface StoredToken {
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: Date;
  scope: string;
}

@Injectable()
export class McpTokenManager {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly enc: (s: string) => string;
  private readonly dec: (s: string) => string;

  constructor(
    private readonly repo: McpServerRepository,
    private readonly redis: RedisService,
    private readonly audit: AuditLogRepository,
    private readonly notifications: NotificationRepository,
    @Optional() deps: Deps = {},
  ) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.now = deps.now ?? ((): number => new Date().getTime());
    this.enc = deps.encrypt ?? cryptoEncrypt;
    this.dec = deps.decrypt ?? cryptoDecrypt;
  }

  /** Returns a fresh access token for the connection, refreshing under a lock if near expiry. */
  async getAccessToken(connectionId: string, userId: string): Promise<string> {
    let token = await this.repo.findOAuthToken(connectionId);
    if (!token) throw new ReauthRequiredError(connectionId);

    if (token.expiresAt.getTime() - this.now() >= EXPIRY_SKEW_MS) {
      return this.dec(token.accessTokenEnc);
    }

    const lockKey = `mcp:refresh:${connectionId}`;
    const locked = await this.redis.acquireLock(lockKey, LOCK_TTL_S);
    if (!locked) {
      // Someone else is refreshing — brief wait then re-read.
      await new Promise((r) => setTimeout(r, 500));
      token = await this.repo.findOAuthToken(connectionId);
      if (token && token.expiresAt.getTime() - this.now() >= EXPIRY_SKEW_MS) {
        return this.dec(token.accessTokenEnc);
      }
    }
    try {
      // Re-read inside the lock to avoid a double refresh.
      token = (await this.repo.findOAuthToken(connectionId)) ?? token;
      if (!token) throw new ReauthRequiredError(connectionId);
      if (token.expiresAt.getTime() - this.now() >= EXPIRY_SKEW_MS) {
        return this.dec(token.accessTokenEnc);
      }
      return await this.refresh(connectionId, userId, token);
    } finally {
      if (locked) await this.redis.releaseLock(lockKey);
    }
  }

  private async refresh(connectionId: string, userId: string, token: StoredToken): Promise<string> {
    if (!token.refreshTokenEnc) {
      await this.markReauth(connectionId, userId, 'no_refresh_token');
      throw new ReauthRequiredError(connectionId);
    }
    const server = await this.repo.findServerForConnection(connectionId);
    if (!server?.oauthTokenUrl || !server.oauthClientId) {
      await this.markReauth(connectionId, userId, 'missing_oauth_config');
      throw new ReauthRequiredError(connectionId);
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.dec(token.refreshTokenEnc),
      client_id: server.oauthClientId,
    });
    if (server.oauthClientSecretEnc) {
      body.set('client_secret', this.dec(server.oauthClientSecretEnc));
    }
    // RFC 8707: keep the resource indicator bound across refreshes.
    if (server.oauthResource) body.set('resource', server.oauthResource);

    // SSRF guard the token endpoint before every outbound refresh (an admin
    // could have configured an internal oauthTokenUrl).
    await validateUrl(server.oauthTokenUrl, { allowlistEnv: 'MCP_INTERNAL_ALLOWLIST' });
    const res = await this.fetchFn(server.oauthTokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
    };
    if (!res.ok || !json.access_token) {
      if (json.error === 'invalid_grant' || res.status === 400 || res.status === 401) {
        await this.markReauth(connectionId, userId, json.error ?? `http_${res.status}`);
        throw new ReauthRequiredError(connectionId);
      }
      throw new Error(`MCP token refresh failed: ${res.status} ${json.error ?? ''}`);
    }

    const expiresAt = new Date(this.now() + (json.expires_in ?? 3600) * 1000);
    await this.repo.upsertOAuthToken(connectionId, {
      accessTokenEnc: this.enc(json.access_token),
      // Rotation: keep the new refresh token if returned, else keep the old one.
      refreshTokenEnc: json.refresh_token ? this.enc(json.refresh_token) : token.refreshTokenEnc,
      expiresAt,
      scope: json.scope ?? token.scope,
    });
    await this.audit.create({
      userId,
      action: 'mcp.oauth.refresh',
      resource: 'mcp_connection',
      resourceId: connectionId,
      details: {},
    });
    return json.access_token;
  }

  private async markReauth(connectionId: string, userId: string, reason: string): Promise<void> {
    await this.repo.setConnectionStatus(connectionId, 'reauth_required', reason);
    await this.audit.create({
      userId,
      action: 'mcp.oauth.reauth_required',
      resource: 'mcp_connection',
      resourceId: connectionId,
      details: { reason },
    });
    await this.notifications
      .create({
        recipientId: userId,
        type: 'MCP_SERVER_ATTENTION',
        payload: {
          connectionId,
          reason,
          title: 'MCP re-authentication required',
          body: `A connected MCP server needs you to sign in again (${reason}).`,
        },
      })
      .catch(() => undefined);
    logger.warn({ connectionId, reason }, 'MCP connection flagged reauth_required');
  }
}
