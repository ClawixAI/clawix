import { describe, it, expect, beforeEach } from 'vitest';

import { McpServerRepository } from '../mcp-server.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('McpServerRepository.findEnabledServersForUser', () => {
  let repo: McpServerRepository;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repo = new McpServerRepository(mockPrisma as unknown as PrismaService);
  });

  it('queries enabled servers including only the caller connection + tools', async () => {
    mockPrisma.mcpServer.findMany.mockResolvedValue([]);

    await repo.findEnabledServersForUser('user-1');

    expect(mockPrisma.mcpServer.findMany).toHaveBeenCalledWith({
      where: { enabled: true },
      include: { connections: { where: { userId: 'user-1' }, include: { tools: true } } },
    });
  });

  it('returns the rows prisma yields', async () => {
    const rows = [{ id: 'srv1' }];
    mockPrisma.mcpServer.findMany.mockResolvedValue(rows);

    const result = await repo.findEnabledServersForUser('user-1');

    expect(result).toBe(rows);
  });
});

describe('McpServerRepository OAuth token', () => {
  let repo: McpServerRepository;
  let mockPrisma: MockPrismaService;
  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repo = new McpServerRepository(mockPrisma as unknown as PrismaService);
  });

  it('upsertOAuthToken upserts by connection id', async () => {
    mockPrisma.mcpOAuthToken.upsert.mockResolvedValue({ mcpConnectionId: 'c1' });
    await repo.upsertOAuthToken('c1', {
      accessTokenEnc: 'a',
      refreshTokenEnc: 'r',
      expiresAt: new Date(0),
      scope: 's',
    });
    expect(mockPrisma.mcpOAuthToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mcpConnectionId: 'c1' } }),
    );
  });

  it('findOAuthToken reads by connection id', async () => {
    mockPrisma.mcpOAuthToken.findUnique.mockResolvedValue({ mcpConnectionId: 'c1' });
    const r = await repo.findOAuthToken('c1');
    expect(mockPrisma.mcpOAuthToken.findUnique).toHaveBeenCalledWith({
      where: { mcpConnectionId: 'c1' },
    });
    expect(r?.mcpConnectionId).toBe('c1');
  });

  it('setConnectionStatus updates status + lastError', async () => {
    mockPrisma.mcpConnection.update.mockResolvedValue({ id: 'c1' });
    await repo.setConnectionStatus('c1', 'reauth_required', 'invalid_grant');
    expect(mockPrisma.mcpConnection.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'reauth_required', lastError: 'invalid_grant' },
    });
  });

  it('findServerForConnection returns the joined server', async () => {
    mockPrisma.mcpConnection.findUnique.mockResolvedValue({ id: 'c1', server: { id: 'srv1' } });
    const r = await repo.findServerForConnection('c1');
    expect(mockPrisma.mcpConnection.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
      include: { server: true },
    });
    expect(r?.id).toBe('srv1');
  });
});

describe('McpServerRepository OAuth server fields + ensureConnection', () => {
  let repo: McpServerRepository;
  let mockPrisma: MockPrismaService;
  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repo = new McpServerRepository(mockPrisma as unknown as PrismaService);
  });

  it('create persists oauth server fields', async () => {
    mockPrisma.mcpServer.create.mockResolvedValue({ id: 'srv1' });
    await repo.create({
      slug: 'gw',
      name: 'GW',
      transportType: 'http',
      url: 'http://gw/mcp/',
      authType: 'oauth',
      oauthAuthorizeUrl: 'https://authz',
      oauthTokenUrl: 'https://token',
      oauthScopes: 'openid',
      oauthClientId: 'cid',
      oauthClientSecretEnc: 'enc',
      createdByUserId: 'u1',
    });
    expect(mockPrisma.mcpServer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          oauthAuthorizeUrl: 'https://authz',
          oauthTokenUrl: 'https://token',
          oauthScopes: 'openid',
          oauthClientId: 'cid',
          oauthClientSecretEnc: 'enc',
        }),
      }),
    );
  });

  it('ensureConnection returns the existing connection if present', async () => {
    mockPrisma.mcpConnection.findUnique.mockResolvedValue({ id: 'c1' });
    const r = await repo.ensureConnection('srv1', 'u1');
    expect(r.id).toBe('c1');
    expect(mockPrisma.mcpConnection.create).not.toHaveBeenCalled();
  });

  it('ensureConnection creates a reauth_required connection if absent', async () => {
    mockPrisma.mcpConnection.findUnique.mockResolvedValue(null);
    mockPrisma.mcpConnection.create.mockResolvedValue({ id: 'c2', status: 'reauth_required' });
    const r = await repo.ensureConnection('srv1', 'u1');
    expect(r.id).toBe('c2');
    expect(mockPrisma.mcpConnection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mcpServerId: 'srv1',
          userId: 'u1',
          status: 'reauth_required',
        }),
      }),
    );
  });
});
