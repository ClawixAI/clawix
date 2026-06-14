/**
 * MCP orchestration.
 *
 * Admin: import (validate URL → persist metadata only → audit), update
 * (enabled toggle), delete. No discovery, no credential held by the admin.
 * User: list catalog, connect (validate → discover with the USER's credential
 * → scan → persist connection + per-connection catalog → encrypt → audit),
 * per-connection refresh, disconnect, tools, call log.
 *
 * Credentials are encrypted before persistence and never returned.
 */
import { Injectable, Optional } from '@nestjs/common';
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
  createLogger,
  listProviders,
} from '@clawix/shared';
import { RedisService } from '../cache/redis.service.js';
import { createPkcePair, randomUrlToken } from './oauth-pkce.js';
import type {
  ChatMessage,
  ConnectMcpInput,
  ImportMcpServerInput,
  McpToolTiers,
  UpdateMcpConnectionInput,
  UpdateMcpServerInput,
} from '@clawix/shared';

import { Prisma } from '../generated/prisma/client.js';
import type { McpConnection, McpServer, McpTool } from '../generated/prisma/client.js';
import { McpServerRepository } from '../db/mcp-server.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { AuditLogRepository } from '../db/audit-log.repository.js';
import { ProviderConfigService } from '../provider-config/provider-config.service.js';
import { createProvider } from '../engine/providers/provider-factory.js';
import { decrypt, encrypt } from '../common/crypto.js';
import { scanContextContent } from '../engine/prompt-injection-scanner.js';
import { validateUrl } from '../engine/tools/web/ssrf-protection.js';
import { McpClientService, type DiscoveredTool } from './mcp-client.service.js';
import { McpOAuthDiscoveryService } from './mcp-oauth-discovery.service.js';
import { normalizeTiers, parseTiersJson } from './tier-utils.js';

const logger = createLogger('mcp:service');

/** Kebab-case a display name into a tool-name-safe slug (max 20 chars). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
    .replace(/-+$/g, '');
}

export interface McpServerDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly transportType: string;
  readonly url: string;
  readonly authType: string;
  readonly authHeaderName: string | null;
  readonly credentialFormat: string | null;
  readonly setupInstructionsMd: string;
  readonly oauthAuthorizeUrl: string | null;
  readonly oauthTokenUrl: string | null;
  readonly oauthScopes: string | null;
  readonly oauthClientId: string | null;
  readonly oauthAutoDiscover: boolean;
}

/** Admin view: includes connection count. The admin holds no credential. */
export interface AdminMcpServerDto extends McpServerDto {
  readonly createdByUserId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly connectionCount: number;
}

function toDto(row: McpServer): McpServerDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    enabled: row.enabled,
    transportType: row.transportType,
    url: row.url,
    authType: row.authType,
    authHeaderName: row.authHeaderName,
    credentialFormat: row.credentialFormat,
    setupInstructionsMd: row.setupInstructionsMd,
    // OAuth config (no secret) — lets the admin edit dialog prefill these.
    oauthAuthorizeUrl: row.oauthAuthorizeUrl,
    oauthTokenUrl: row.oauthTokenUrl,
    oauthScopes: row.oauthScopes,
    oauthClientId: row.oauthClientId,
    oauthAutoDiscover: row.oauthAutoDiscover,
  };
}

function toAdminDto(row: McpServer & { _count: { connections: number } }): AdminMcpServerDto {
  return {
    ...toDto(row),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    connectionCount: row._count.connections,
  };
}

export interface McpConnectionDto {
  readonly id: string;
  readonly mcpServerId: string;
  readonly status: string;
  readonly lastError: string | null;
  readonly tiers: McpToolTiers | null;
}

function toConnectionDto(row: McpConnection): McpConnectionDto {
  return {
    id: row.id,
    mcpServerId: row.mcpServerId,
    status: row.status,
    lastError: row.lastError,
    tiers: (row.tiers as McpToolTiers | null) ?? null,
  };
}

interface McpServiceDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
}

@Injectable()
export class McpService {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly repo: McpServerRepository,
    private readonly client: McpClientService,
    private readonly users: UserRepository,
    private readonly policies: PolicyRepository,
    private readonly audit: AuditLogRepository,
    private readonly providerConfig: ProviderConfigService,
    private readonly redis: RedisService,
    private readonly discovery: McpOAuthDiscoveryService,
    @Optional() deps: McpServiceDeps = {},
  ) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.now = deps.now ?? ((): number => Date.now());
  }

  private oauthCallbackUrl(): string {
    const u = process.env['MCP_OAUTH_CALLBACK_URL'];
    if (!u) throw new ValidationError('MCP_OAUTH_CALLBACK_URL is not configured');
    return u;
  }

  /** Throws ForbiddenError unless the caller's policy has allowMcp. */
  async assertMcpAllowed(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    const policy = await this.policies.findById(user.policyId);
    if (!policy.allowMcp) {
      throw new ForbiddenError('MCP is not enabled for your plan');
    }
  }

  // ====================================================================
  //  Admin surface (RBAC enforced at controller level)
  // ====================================================================

  async importServer(adminUserId: string, input: ImportMcpServerInput): Promise<McpServerDto> {
    const slug = slugify(input.name);
    if (!slug) {
      throw new ValidationError('Server name must contain at least one alphanumeric character');
    }
    // SSRF/URL guard only — no tools/list, no credential. validateUrl makes no
    // HTTP call (DNS + range check), so it cannot verify reachability; that is
    // the connecting user's concern.
    await validateUrl(input.url, { allowlistEnv: 'MCP_INTERNAL_ALLOWLIST' });
    // SSRF guard the OAuth endpoints too — they are fetched server-side at
    // callback (token exchange) and refresh time.
    if (input.authType === 'oauth') {
      if (input.oauthAuthorizeUrl) {
        await validateUrl(input.oauthAuthorizeUrl, { allowlistEnv: 'MCP_INTERNAL_ALLOWLIST' });
      }
      if (input.oauthTokenUrl) {
        await validateUrl(input.oauthTokenUrl, { allowlistEnv: 'MCP_INTERNAL_ALLOWLIST' });
      }
    }

    const server = await this.repo.create({
      slug,
      name: input.name,
      transportType: input.transportType,
      url: input.url,
      authType: input.authType,
      authHeaderName: input.authHeaderName ?? null,
      credentialFormat: input.credentialFormat ?? null,
      // OAuth config (only meaningful for authType=oauth); secret encrypted at rest.
      oauthAuthorizeUrl: input.oauthAuthorizeUrl ?? null,
      oauthTokenUrl: input.oauthTokenUrl ?? null,
      oauthScopes: input.oauthScopes ?? null,
      oauthClientId: input.oauthClientId ?? null,
      oauthClientSecretEnc: input.oauthClientSecret ? encrypt(input.oauthClientSecret) : null,
      oauthAutoDiscover: input.oauthAutoDiscover ?? false,
      setupInstructionsMd: input.setupInstructionsMd ?? '',
      createdByUserId: adminUserId,
    });
    await this.audit.create({
      userId: adminUserId,
      action: 'mcp.server.import',
      resource: 'mcp_server',
      resourceId: server.id,
      details: { url: input.url },
    });
    logger.info({ serverId: server.id }, 'MCP server imported (metadata only)');
    return toDto(server);
  }

  async adminListServers(): Promise<readonly AdminMcpServerDto[]> {
    const rows = await this.repo.listAll();
    return rows.map(toAdminDto);
  }

  async updateServer(
    adminUserId: string,
    id: string,
    input: UpdateMcpServerInput,
  ): Promise<McpServerDto> {
    // SSRF-guard any URL the admin is changing (endpoint + OAuth endpoints).
    if (input.url !== undefined) {
      await validateUrl(input.url, { allowlistEnv: 'MCP_INTERNAL_ALLOWLIST' });
    }
    if (input.oauthAuthorizeUrl !== undefined) {
      await validateUrl(input.oauthAuthorizeUrl, { allowlistEnv: 'MCP_INTERNAL_ALLOWLIST' });
    }
    if (input.oauthTokenUrl !== undefined) {
      await validateUrl(input.oauthTokenUrl, { allowlistEnv: 'MCP_INTERNAL_ALLOWLIST' });
    }
    const updated = await this.repo.update(id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.authHeaderName !== undefined ? { authHeaderName: input.authHeaderName } : {}),
      ...(input.credentialFormat !== undefined ? { credentialFormat: input.credentialFormat } : {}),
      ...(input.setupInstructionsMd !== undefined
        ? { setupInstructionsMd: input.setupInstructionsMd }
        : {}),
      ...(input.oauthAuthorizeUrl !== undefined
        ? { oauthAuthorizeUrl: input.oauthAuthorizeUrl }
        : {}),
      ...(input.oauthTokenUrl !== undefined ? { oauthTokenUrl: input.oauthTokenUrl } : {}),
      ...(input.oauthScopes !== undefined ? { oauthScopes: input.oauthScopes } : {}),
      ...(input.oauthClientId !== undefined ? { oauthClientId: input.oauthClientId } : {}),
      ...(input.oauthAutoDiscover !== undefined
        ? { oauthAutoDiscover: input.oauthAutoDiscover }
        : {}),
      // Only rotate the secret when a new one is supplied (blank = keep existing).
      ...(input.oauthClientSecret
        ? { oauthClientSecretEnc: encrypt(input.oauthClientSecret) }
        : {}),
    });
    await this.audit.create({
      userId: adminUserId,
      action: 'mcp.server.update',
      resource: 'mcp_server',
      resourceId: id,
      details: { fields: Object.keys(input) },
    });
    return toDto(updated);
  }

  async deleteServer(adminUserId: string, id: string): Promise<void> {
    await this.repo.findById(id); // 404 before audit
    await this.repo.delete(id);
    await this.audit.create({
      userId: adminUserId,
      action: 'mcp.server.delete',
      resource: 'mcp_server',
      resourceId: id,
      details: {},
    });
  }

  async adminGetCalls(serverId: string, cursor?: string) {
    await this.repo.findById(serverId);
    return this.safeFindCalls(serverId, { cursor });
  }

  // ====================================================================
  //  User surface (policy.allowMcp enforced here)
  // ====================================================================

  /** Enabled catalog + the caller's connection per server (null = not connected). */
  async listServers(
    userId: string,
  ): Promise<readonly (McpServerDto & { connection: McpConnectionDto | null })[]> {
    await this.assertMcpAllowed(userId);
    const [servers, connections] = await Promise.all([
      this.repo.listEnabled(),
      this.repo.findConnectionsByUser(userId),
    ]);
    const byServer = new Map(connections.map((c) => [c.mcpServerId, c]));
    return servers.map((s) => ({
      ...toDto(s),
      connection: byServer.has(s.id) ? toConnectionDto(byServer.get(s.id)!) : null,
    }));
  }

  async connect(
    userId: string,
    serverId: string,
    input: ConnectMcpInput,
  ): Promise<McpConnectionDto> {
    await this.assertMcpAllowed(userId);
    const server = await this.repo.findById(serverId);
    if (!server.enabled) {
      throw new ConflictError('This MCP server is disabled by an administrator');
    }
    if (server.authType === 'header' && !input.credential) {
      throw new ValidationError('This server requires a credential to connect');
    }

    // Discover with the USER's credential — this both verifies connectivity and
    // produces the per-user catalog. A failure here surfaces inline.
    const discovered = await this.client.discover({
      url: server.url,
      transportType: server.transportType,
      authHeaderName: server.authHeaderName,
      credential: input.credential ?? null,
    });

    const connection = await this.repo.createConnectionWithCatalog(
      {
        mcpServerId: serverId,
        userId,
        credentialEnc: input.credential ? encrypt(input.credential) : null,
      },
      discovered.map(scanTool),
    );
    await this.audit.create({
      userId,
      action: 'mcp.connection.create',
      resource: 'mcp_connection',
      resourceId: connection.id,
      details: { serverId, toolCount: discovered.length },
    });
    return toConnectionDto(connection);
  }

  // ====================================================================
  //  OAuth connect flow (authType=oauth) — Authorization Code + PKCE
  // ====================================================================

  /** Build the provider authorize URL and stash PKCE+state in Redis (TTL 600s, single-use). */
  async startOAuth(userId: string, serverId: string): Promise<string> {
    await this.assertMcpAllowed(userId);
    let server = await this.repo.findById(serverId);
    if (server.authType !== 'oauth') {
      throw new ValidationError('Server is not configured for OAuth');
    }
    // Spec-native servers self-configure on first connect: discover PRM → AS
    // metadata → (DCR) and cache the authorize/token URLs + scopes + client.
    if (server.oauthAutoDiscover && !server.oauthDiscoveredAt) {
      server = await this.ensureDiscovered(server, userId);
    }
    if (!server.oauthAuthorizeUrl || !server.oauthClientId || !server.oauthScopes) {
      throw new ValidationError('Server is not configured for OAuth');
    }
    // Ensure a connection row exists (pending/reauth) to attach the token to.
    const connection = await this.repo.ensureConnection(serverId, userId);

    const { codeVerifier, codeChallenge } = createPkcePair();
    const state = randomUrlToken();
    await this.redis.set(
      `mcp:oauth:state:${state}`,
      { userId, serverId, connectionId: connection.id, codeVerifier },
      { ttlSeconds: 600 },
    );

    const p = new URLSearchParams({
      response_type: 'code',
      client_id: server.oauthClientId,
      redirect_uri: this.oauthCallbackUrl(),
      scope: server.oauthScopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });
    // RFC 8707: bind the authorization to the specific protected resource.
    if (server.oauthResource) p.set('resource', server.oauthResource);
    await this.audit.create({
      userId,
      action: 'mcp.oauth.connect',
      resource: 'mcp_server',
      resourceId: serverId,
      details: { phase: 'start' },
    });
    return `${server.oauthAuthorizeUrl}?${p.toString()}`;
  }

  /**
   * Run spec-native OAuth discovery for an auto-discover server and cache the
   * result on the server row. Redis-locked so two concurrent first-connects
   * don't both run Dynamic Client Registration. Re-reads under the lock and
   * returns early if another request already discovered.
   */
  private async ensureDiscovered(server: McpServer, userId: string): Promise<McpServer> {
    const lockKey = `mcp:discover:${server.id}`;
    const locked = await this.redis.acquireLock(lockKey, 30);
    if (!locked) {
      // Another request holds the discovery lock — never run discovery (and DCR)
      // concurrently. Poll for its result, then ask the caller to retry if it
      // hasn't landed yet rather than registering a second client.
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const fresh = await this.repo.findById(server.id);
        if (fresh.oauthDiscoveredAt) return fresh;
      }
      throw new ConflictError('OAuth discovery is already in progress; please retry shortly');
    }
    try {
      const fresh = await this.repo.findById(server.id);
      if (fresh.oauthDiscoveredAt) return fresh;
      const result = await this.discovery.discover({
        serverUrl: fresh.url,
        redirectUri: this.oauthCallbackUrl(),
        fallbackClientId: fresh.oauthClientId,
        fallbackClientSecret: fresh.oauthClientSecretEnc
          ? decrypt(fresh.oauthClientSecretEnc)
          : null,
        fallbackScopes: fresh.oauthScopes,
        clientName: 'Clawix',
      });
      const updated = await this.repo.update(fresh.id, {
        oauthAuthorizeUrl: result.authorizeUrl,
        oauthTokenUrl: result.tokenUrl,
        oauthScopes: result.scopes,
        oauthClientId: result.clientId,
        ...(result.clientSecret ? { oauthClientSecretEnc: encrypt(result.clientSecret) } : {}),
        oauthResource: result.resource,
        oauthDiscoveredAt: new Date(this.now()),
      });
      await this.audit.create({
        userId,
        action: 'mcp.oauth.discover',
        resource: 'mcp_server',
        resourceId: fresh.id,
        details: { tokenUrl: result.tokenUrl, dcr: !fresh.oauthClientId },
      });
      logger.info({ serverId: fresh.id }, 'MCP OAuth config discovered and cached');
      return updated;
    } finally {
      if (locked) await this.redis.releaseLock(lockKey);
    }
  }

  /** Public callback: validate one-time state, exchange code, persist token, discover catalog. */
  async handleOAuthCallback(state: string, code: string): Promise<{ serverId: string }> {
    const key = `mcp:oauth:state:${state}`;
    const ctx = await this.redis.get<{
      userId: string;
      serverId: string;
      connectionId: string;
      codeVerifier: string;
    }>(key);
    if (!ctx) throw new ValidationError('Invalid or expired OAuth state');
    await this.redis.del(key); // single-use

    const server = await this.repo.findById(ctx.serverId);
    if (!server.oauthTokenUrl || !server.oauthClientId) {
      throw new ValidationError('Server is not configured for OAuth');
    }
    await validateUrl(server.oauthTokenUrl, { allowlistEnv: 'MCP_INTERNAL_ALLOWLIST' });

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.oauthCallbackUrl(),
      client_id: server.oauthClientId,
      code_verifier: ctx.codeVerifier,
    });
    if (server.oauthClientSecretEnc) {
      body.set('client_secret', decrypt(server.oauthClientSecretEnc));
    }
    // RFC 8707: echo the resource indicator on the token request.
    if (server.oauthResource) body.set('resource', server.oauthResource);

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
      throw new ValidationError(`OAuth token exchange failed: ${json.error ?? res.status}`);
    }

    await this.repo.upsertOAuthToken(ctx.connectionId, {
      accessTokenEnc: encrypt(json.access_token),
      refreshTokenEnc: json.refresh_token ? encrypt(json.refresh_token) : null,
      expiresAt: new Date(this.now() + (json.expires_in ?? 3600) * 1000),
      scope: json.scope ?? server.oauthScopes ?? '',
    });

    // Discover catalog with the new token and mark the connection active.
    const discovered = await this.client.discover({
      url: server.url,
      transportType: server.transportType,
      authHeaderName: 'Authorization',
      credential: `Bearer ${json.access_token}`,
    });
    await this.repo.replaceConnectionCatalog(ctx.connectionId, discovered.map(scanTool));
    await this.repo.setConnectionStatus(ctx.connectionId, 'active');
    await this.audit.create({
      userId: ctx.userId,
      action: 'mcp.oauth.connect',
      resource: 'mcp_connection',
      resourceId: ctx.connectionId,
      details: { phase: 'complete', tools: discovered.length },
    });
    return { serverId: ctx.serverId };
  }

  private async getOwnConnection(userId: string, connectionId: string): Promise<McpConnection> {
    const connection = await this.repo.findConnectionById(connectionId);
    if (connection.userId !== userId) {
      throw new ForbiddenError('Not your MCP connection');
    }
    return connection;
  }

  async updateConnection(
    userId: string,
    connectionId: string,
    input: UpdateMcpConnectionInput,
  ): Promise<McpConnectionDto> {
    const connection = await this.getOwnConnection(userId, connectionId);
    const updated = await this.repo.updateConnection(connection.id, {
      // A fresh credential clears the prior error state: default the row back
      // to 'active' and wipe lastError. An explicit input.status still wins.
      ...(input.credential
        ? { credentialEnc: encrypt(input.credential), status: 'active', lastError: null }
        : {}),
      ...(input.status ? { status: input.status } : {}),
    });
    await this.audit.create({
      userId,
      action: 'mcp.connection.update',
      resource: 'mcp_connection',
      resourceId: connectionId,
      details: { fields: Object.keys(input) },
    });
    return toConnectionDto(updated);
  }

  async deleteConnection(userId: string, connectionId: string): Promise<void> {
    await this.getOwnConnection(userId, connectionId);
    await this.repo.deleteConnection(connectionId);
    await this.audit.create({
      userId,
      action: 'mcp.connection.delete',
      resource: 'mcp_connection',
      resourceId: connectionId,
      details: {},
    });
  }

  async refreshConnection(userId: string, connectionId: string): Promise<readonly McpTool[]> {
    await this.assertMcpAllowed(userId);
    const connection = await this.getOwnConnection(userId, connectionId);
    const server = await this.repo.findById(connection.mcpServerId);
    const discovered = await this.client.discover({
      url: server.url,
      transportType: server.transportType,
      authHeaderName: server.authHeaderName,
      credential: connection.credentialEnc ? decrypt(connection.credentialEnc) : null,
    });
    await this.repo.replaceConnectionCatalog(connectionId, discovered.map(scanTool));
    await this.audit.create({
      userId,
      action: 'mcp.connection.refresh',
      resource: 'mcp_connection',
      resourceId: connectionId,
      details: { toolCount: discovered.length },
    });
    return this.repo.findToolsByConnection(connectionId);
  }

  async listTools(userId: string, serverId: string): Promise<readonly McpTool[]> {
    await this.assertMcpAllowed(userId);
    await this.repo.findById(serverId); // 404 if server gone
    const connections = await this.repo.findConnectionsByUser(userId);
    const own = connections.find((c) => c.mcpServerId === serverId);
    return own ? this.repo.findToolsByConnection(own.id) : [];
  }

  /** Caller-scoped call log. */
  async getCalls(userId: string, serverId: string, cursor?: string) {
    await this.assertMcpAllowed(userId);
    return this.safeFindCalls(serverId, { userId, cursor });
  }

  // ====================================================================
  //  Tool tiering (per connection) — human-curated, agent-agnostic auto-sort
  // ====================================================================

  /** Owner-checked, allowMcp-gated connection + its cached catalog names. */
  private async loadOwnConnectionCatalog(userId: string, connectionId: string) {
    await this.assertMcpAllowed(userId);
    const connection = await this.getOwnConnection(userId, connectionId); // throws ForbiddenError
    const catalog = await this.repo.findToolsByConnection(connection.id);
    return { connection, catalogNames: catalog.map((t) => t.name), catalog };
  }

  /** Stored tiers for the caller's connection, or null. Owner-only. */
  async getConnectionTiers(userId: string, connectionId: string): Promise<McpToolTiers | null> {
    await this.assertMcpAllowed(userId);
    const connection = await this.getOwnConnection(userId, connectionId);
    return (connection.tiers as McpToolTiers | null) ?? null;
  }

  /**
   * Persist a human-curated tier assignment for the caller's connection.
   * Normalized against the connection's catalog (precedence
   * recommended > optional > off; omitted catalog tools fall to off; unknown
   * names dropped). Owner-only, audited. Suggestion ≠ grant — TOFU preserved.
   */
  async setTiers(
    userId: string,
    connectionId: string,
    rawTiers: McpToolTiers,
  ): Promise<McpToolTiers> {
    const { connection, catalogNames } = await this.loadOwnConnectionCatalog(userId, connectionId);
    const tiers = normalizeTiers(rawTiers, catalogNames);
    await this.repo.updateConnectionTiers(connection.id, tiers as unknown as Prisma.InputJsonValue);
    await this.audit.create({
      userId,
      action: 'mcp.tiers.set',
      resource: 'mcp_connection',
      resourceId: connection.id,
      details: { recommended: tiers.recommended.length, optional: tiers.optional.length },
    });
    return tiers;
  }

  /**
   * Ask the org's default provider to sort the connection's catalog into
   * recommended/optional/off (agent-agnostic — general usefulness). Validated
   * against the catalog, persisted, audited with token usage. No default
   * provider / empty model / provider failure / unparseable → return all-off,
   * do NOT persist, never throw. Manual tiering always works without a provider.
   */
  async autoSortTiers(userId: string, connectionId: string): Promise<McpToolTiers> {
    const { connection, catalog, catalogNames } = await this.loadOwnConnectionCatalog(
      userId,
      connectionId,
    );
    const allOff: McpToolTiers = { recommended: [], optional: [], off: catalogNames };
    try {
      const providerName = await this.providerConfig.getDefaultProviderName();
      if (!providerName) return allOff;
      const model = listProviders().find((s) => s.name === providerName)?.defaultModel ?? '';
      if (!model) return allOff;
      const { apiKey, apiBaseUrl } = await this.providerConfig.resolveProvider(providerName);
      const provider = createProvider(providerName, apiKey, apiBaseUrl ?? undefined, model);
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            'You classify third-party tools by general usefulness for an AI agent. ' +
            'recommended = common, safe/read-oriented; off = destructive, admin, or rarely needed; ' +
            'optional = everything else. Reply with ONLY JSON: {"recommended":[],"optional":[],"off":[]} ' +
            'using exact tool names.',
        },
        {
          role: 'user',
          content: `Tools:\n${catalog.map((t) => `- ${t.name}: ${t.description}`).join('\n')}`,
        },
      ];
      const res = await provider.chat(messages, { model, settings: { temperature: 0 } });
      const tiers = normalizeTiers(parseTiersJson(res.content), catalogNames);
      await this.repo.updateConnectionTiers(
        connection.id,
        tiers as unknown as Prisma.InputJsonValue,
      );
      await this.audit.create({
        userId,
        action: 'mcp.tiers.autosort',
        resource: 'mcp_connection',
        resourceId: connection.id,
        details: {
          inputTokens: res.usage?.inputTokens ?? 0,
          outputTokens: res.usage?.outputTokens ?? 0,
          recommended: tiers.recommended.length,
        },
      });
      return tiers;
    } catch (err) {
      logger.warn(
        { connectionId, err: err instanceof Error ? err.message : String(err) },
        'MCP tier auto-sort failed; returning all-off',
      );
      return allOff;
    }
  }

  /** Maps a stale/invalid client-supplied cursor to an empty page instead of a 500. */
  private async safeFindCalls(serverId: string, opts: { userId?: string; cursor?: string }) {
    try {
      return await this.repo.findCalls(serverId, opts);
    } catch (err) {
      if (opts.cursor) {
        logger.warn(
          { serverId, err: err instanceof Error ? err.message : String(err) },
          'stale call-log cursor',
        );
        return { items: [], nextCursor: null };
      }
      throw err;
    }
  }
}

/** Scan a discovered tool's description for prompt-injection markers. */
function scanTool(t: DiscoveredTool) {
  const scan = scanContextContent(t.description, `mcp-tool:${t.name}`);
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as never,
    scanFlagged: scan.blocked,
    scanReason: scan.blocked ? scan.findings.join(', ') : null,
  };
}
