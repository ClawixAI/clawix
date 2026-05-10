import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

import { AgentsService } from '../agents.service.js';
import type { AgentDefinitionRepository } from '../../db/agent-definition.repository.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';
import type { UserAgentRepository } from '../../db/user-agent.repository.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

const ownerId = 'user-owner';
const otherUserId = 'user-other';
const adminId = 'user-admin';
const agentId = 'agent-1';

function makeAgent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: agentId,
    name: 'Worker A',
    role: 'worker',
    isOfficial: false,
    createdById: ownerId,
    isActive: true,
    description: '',
    systemPrompt: 'sys',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    skillIds: [],
    maxTokensPerRun: 100000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(opts: {
  agentDef?: ReturnType<typeof makeAgent>;
  existsForUser?: boolean;
  findByAgentDefinitionId?: ReturnType<typeof vi.fn>;
}) {
  const agentDefRepo = {
    findById: vi.fn().mockResolvedValue(opts.agentDef ?? makeAgent()),
  } as unknown as AgentDefinitionRepository;

  const agentRunRepo = {
    findByAgentDefinitionId:
      opts.findByAgentDefinitionId ??
      vi.fn().mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      }),
  } as unknown as AgentRunRepository;

  const userAgentRepo = {
    existsForUser: vi.fn().mockResolvedValue(opts.existsForUser ?? false),
  } as unknown as UserAgentRepository;

  const prisma = {} as unknown as PrismaService;
  const notifications = {
    create: vi.fn().mockResolvedValue(undefined),
  } as unknown as import('../../notifications/notifications.fanout.js').NotificationFanoutService;

  const service = new AgentsService(
    agentDefRepo,
    agentRunRepo,
    userAgentRepo,
    prisma,
    notifications,
  );
  return { service, agentDefRepo, agentRunRepo, userAgentRepo };
}

// ------------------------------------------------------------------ //
//  Tests                                                              //
// ------------------------------------------------------------------ //

describe('AgentsService.getAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin can read any agent', async () => {
    const { service } = makeService({});
    await expect(service.getAgent(agentId, adminId, 'admin')).resolves.toBeDefined();
  });

  it('owner can read their custom agent', async () => {
    const { service } = makeService({});
    await expect(service.getAgent(agentId, ownerId, 'user')).resolves.toBeDefined();
  });

  it('any user can read an official agent', async () => {
    const { service } = makeService({ agentDef: makeAgent({ isOfficial: true }) });
    await expect(service.getAgent(agentId, otherUserId, 'user')).resolves.toBeDefined();
  });

  it('assigned user can read someone else’s custom agent', async () => {
    const { service } = makeService({ existsForUser: true });
    await expect(service.getAgent(agentId, otherUserId, 'user')).resolves.toBeDefined();
  });

  it('throws ForbiddenException when user is neither owner, official, nor assigned', async () => {
    const { service } = makeService({ existsForUser: false });
    await expect(service.getAgent(agentId, otherUserId, 'user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('AgentsService.listAgentRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes userId to the repository for non-admin callers', async () => {
    const findByAgentDefinitionId = vi.fn().mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
    });
    const { service } = makeService({ findByAgentDefinitionId });

    await service.listAgentRuns(agentId, { page: 1, limit: 10 }, otherUserId, 'user');

    expect(findByAgentDefinitionId).toHaveBeenCalledWith(
      agentId,
      { page: 1, limit: 10 },
      otherUserId,
    );
  });

  it('omits userId scoping for admin callers', async () => {
    const findByAgentDefinitionId = vi.fn().mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
    });
    const { service } = makeService({ findByAgentDefinitionId });

    await service.listAgentRuns(agentId, { page: 1, limit: 10 }, adminId, 'admin');

    expect(findByAgentDefinitionId).toHaveBeenCalledWith(
      agentId,
      { page: 1, limit: 10 },
      undefined,
    );
  });
});
