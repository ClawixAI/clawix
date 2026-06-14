import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@clawix/shared';

import {
  Prisma,
  type AuditLog,
  type McpConnection,
  type McpConnectionStatus,
  type McpOAuthToken,
  type McpServer,
  type McpTool,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { handlePrismaError } from './utils.js';

export interface CreateMcpServerData {
  readonly slug: string;
  readonly name: string;
  readonly transportType: 'http' | 'sse';
  readonly url: string;
  readonly authType: 'none' | 'header' | 'oauth';
  readonly authHeaderName?: string | null;
  readonly credentialFormat?: string | null;
  readonly oauthAuthorizeUrl?: string | null;
  readonly oauthTokenUrl?: string | null;
  readonly oauthScopes?: string | null;
  readonly oauthClientId?: string | null;
  readonly oauthClientSecretEnc?: string | null;
  readonly oauthAutoDiscover?: boolean;
  readonly setupInstructionsMd?: string;
  readonly createdByUserId: string;
}

export interface CatalogToolData {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Prisma.InputJsonValue;
  readonly scanFlagged: boolean;
  readonly scanReason?: string | null;
}

export type McpConnectionWithTools = McpConnection & { tools: McpTool[] };
export type McpServerForRun = McpServer & { connections: McpConnectionWithTools[] };

@Injectable()
export class McpServerRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- servers (admin-owned, global) ----

  async create(data: CreateMcpServerData): Promise<McpServer> {
    try {
      return await this.prisma.mcpServer.create({ data });
    } catch (error) {
      handlePrismaError(error, 'McpServer');
    }
  }

  async findById(id: string): Promise<McpServer> {
    const row = await this.prisma.mcpServer.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('McpServer', id);
    return row;
  }

  async listAll(): Promise<readonly (McpServer & { _count: { connections: number } })[]> {
    return this.prisma.mcpServer.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { connections: true } } },
    });
  }

  async listEnabled(): Promise<readonly McpServer[]> {
    return this.prisma.mcpServer.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } });
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      enabled: boolean;
      url: string;
      authHeaderName: string | null;
      credentialFormat: string;
      setupInstructionsMd: string;
      oauthAuthorizeUrl: string | null;
      oauthTokenUrl: string | null;
      oauthScopes: string | null;
      oauthClientId: string | null;
      oauthClientSecretEnc: string | null;
      oauthAutoDiscover: boolean;
      oauthResource: string | null;
      oauthDiscoveredAt: Date | null;
    }>,
  ): Promise<McpServer> {
    try {
      return await this.prisma.mcpServer.update({ where: { id }, data });
    } catch (error) {
      handlePrismaError(error, 'McpServer');
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.mcpServer.delete({ where: { id } });
    } catch (error) {
      handlePrismaError(error, 'McpServer');
    }
  }

  // ---- catalog (per-connection) ----

  async findToolsByConnection(mcpConnectionId: string): Promise<readonly McpTool[]> {
    return this.prisma.mcpTool.findMany({
      where: { mcpConnectionId },
      orderBy: { name: 'asc' },
    });
  }

  /** Replace a connection's cached catalog atomically and stamp lastDiscoveredAt. */
  async replaceConnectionCatalog(
    mcpConnectionId: string,
    tools: readonly CatalogToolData[],
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.mcpTool.deleteMany({ where: { mcpConnectionId } }),
      this.prisma.mcpTool.createMany({
        data: tools.map((t) => ({ ...t, mcpConnectionId })),
      }),
      this.prisma.mcpConnection.update({
        where: { id: mcpConnectionId },
        data: { lastDiscoveredAt: new Date(), status: 'active', lastError: null },
      }),
    ]);
  }

  // ---- connections (per-user) ----

  /** Create a connection and its discovered catalog in one transaction. */
  async createConnectionWithCatalog(
    data: { mcpServerId: string; userId: string; credentialEnc?: string | null },
    tools: readonly CatalogToolData[],
  ): Promise<McpConnection> {
    try {
      return await this.prisma.mcpConnection.create({
        data: {
          ...data,
          lastDiscoveredAt: new Date(),
          tools: { create: tools.map((t) => ({ ...t })) },
        },
      });
    } catch (error) {
      handlePrismaError(error, 'McpConnection');
    }
  }

  async findConnectionById(id: string): Promise<McpConnection> {
    const row = await this.prisma.mcpConnection.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('McpConnection', id);
    return row;
  }

  async findConnectionsByUser(userId: string): Promise<readonly McpConnection[]> {
    return this.prisma.mcpConnection.findMany({ where: { userId } });
  }

  async updateConnection(
    id: string,
    data: Partial<{
      credentialEnc: string;
      status: 'active' | 'disabled' | 'error' | 'reauth_required';
      lastError: string | null;
    }>,
  ): Promise<McpConnection> {
    try {
      return await this.prisma.mcpConnection.update({ where: { id }, data });
    } catch (error) {
      handlePrismaError(error, 'McpConnection');
    }
  }

  async deleteConnection(id: string): Promise<void> {
    try {
      await this.prisma.mcpConnection.delete({ where: { id } });
    } catch (error) {
      handlePrismaError(error, 'McpConnection');
    }
  }

  /** Set a connection's status (+ optional lastError). Used by the OAuth token manager. */
  async setConnectionStatus(
    id: string,
    status: McpConnectionStatus,
    lastError?: string,
  ): Promise<McpConnection> {
    try {
      return await this.prisma.mcpConnection.update({
        where: { id },
        data: { status, lastError: lastError ?? null },
      });
    } catch (error) {
      handlePrismaError(error, 'McpConnection');
    }
  }

  /** Resolve the server backing a connection (for OAuth refresh config). */
  async findServerForConnection(connectionId: string): Promise<McpServer | null> {
    const c = await this.prisma.mcpConnection.findUnique({
      where: { id: connectionId },
      include: { server: true },
    });
    return c?.server ?? null;
  }

  /**
   * Create-or-return the per-user connection for an OAuth server. New rows start
   * in `reauth_required` (a token must be attached before they go active).
   */
  async ensureConnection(serverId: string, userId: string): Promise<McpConnection> {
    const existing = await this.prisma.mcpConnection.findUnique({
      where: { mcpServerId_userId: { mcpServerId: serverId, userId } },
    });
    if (existing) return existing;
    try {
      return await this.prisma.mcpConnection.create({
        data: { mcpServerId: serverId, userId, status: 'reauth_required' },
      });
    } catch (error) {
      handlePrismaError(error, 'McpConnection');
    }
  }

  /** Persist a connection's curated tool tiers (normalized by the service). */
  async updateConnectionTiers(
    connectionId: string,
    tiers: Prisma.InputJsonValue,
  ): Promise<McpConnection> {
    try {
      return await this.prisma.mcpConnection.update({
        where: { id: connectionId },
        data: { tiers },
      });
    } catch (error) {
      handlePrismaError(error, 'McpConnection');
    }
  }

  // ---- OAuth tokens (per-connection) ----

  /** Read a connection's stored OAuth token (encrypted), or null. */
  async findOAuthToken(mcpConnectionId: string): Promise<McpOAuthToken | null> {
    return this.prisma.mcpOAuthToken.findUnique({ where: { mcpConnectionId } });
  }

  /** Upsert a connection's OAuth token (encrypted access/refresh + expiry/scope). */
  async upsertOAuthToken(
    mcpConnectionId: string,
    data: {
      accessTokenEnc: string;
      refreshTokenEnc: string | null;
      expiresAt: Date;
      scope: string;
    },
  ): Promise<McpOAuthToken> {
    try {
      return await this.prisma.mcpOAuthToken.upsert({
        where: { mcpConnectionId },
        create: { mcpConnectionId, ...data, lastRefreshedAt: null },
        update: { ...data, lastRefreshedAt: new Date() },
      });
    } catch (error) {
      handlePrismaError(error, 'McpOAuthToken');
    }
  }

  /**
   * Engine path: bound servers with cached catalogs AND the calling user's
   * connection (connections array is filtered to that user; 0 or 1 entries).
   */
  async findServersForRun(
    ids: readonly string[],
    userId: string,
  ): Promise<readonly McpServerForRun[]> {
    if (ids.length === 0) return [];
    return this.prisma.mcpServer.findMany({
      where: { id: { in: [...ids] } },
      include: { connections: { where: { userId }, include: { tools: true } } },
    });
  }

  /**
   * All enabled servers, each including the caller's connection (with cached
   * tools). Backs the auto-bind path: tools are derived from the connection's
   * `recommended` tier rather than a per-agent allowlist. Servers the user has
   * no connection to come back with `connections: []`.
   */
  async findEnabledServersForUser(userId: string): Promise<readonly McpServerForRun[]> {
    return this.prisma.mcpServer.findMany({
      where: { enabled: true },
      include: { connections: { where: { userId }, include: { tools: true } } },
    });
  }

  // ---- call log ----

  /** Cursor-paginated mcp.tool.call audit rows. userId narrows to one caller (user surface). */
  async findCalls(
    serverId: string,
    opts: { userId?: string; cursor?: string; take?: number } = {},
  ): Promise<{ items: readonly AuditLog[]; nextCursor: string | null }> {
    const take = opts.take ?? 50;
    const items = await this.prisma.auditLog.findMany({
      where: {
        action: 'mcp.tool.call',
        resource: 'mcp_server',
        resourceId: serverId,
        ...(opts.userId ? { userId: opts.userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > take;
    return {
      items: hasMore ? items.slice(0, take) : items,
      nextCursor: hasMore ? (items[take - 1]?.id ?? null) : null,
    };
  }
}
