import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AgentsService } from '../agents.service.js';
import type { AgentDefinitionRepository } from '../../db/agent-definition.repository.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';
import type { UserAgentRepository } from '../../db/user-agent.repository.js';
import type { UserRepository } from '../../db/user.repository.js';
import type { PolicyRepository } from '../../db/policy.repository.js';
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
  agentCount?: number;
  maxAgents?: number;
  agentDefUpdate?: ReturnType<typeof vi.fn>;
}) {
  const agentDefRepo = {
    findById: vi.fn().mockResolvedValue(opts.agentDef ?? makeAgent()),
    create: vi.fn().mockImplementation(async (data: Record<string, unknown>) => makeAgent(data)),
    countByCreator: vi.fn().mockResolvedValue(opts.agentCount ?? 0),
    update: opts.agentDefUpdate ?? vi.fn().mockResolvedValue(makeAgent()),
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

  const userRepo = {
    findById: vi.fn().mockResolvedValue({ id: ownerId, policyId: 'policy-1' }),
  } as unknown as UserRepository;

  const policyRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'policy-1', maxAgents: opts.maxAgents ?? 5 }),
  } as unknown as PolicyRepository;

  const prisma = {} as unknown as PrismaService;
  const notifications = {
    create: vi.fn().mockResolvedValue(undefined),
  } as unknown as import('../../notifications/notifications.fanout.js').NotificationFanoutService;

  const service = new AgentsService(
    agentDefRepo,
    agentRunRepo,
    userAgentRepo,
    userRepo,
    policyRepo,
    prisma,
    notifications,
  );
  return { service, agentDefRepo, agentRunRepo, userAgentRepo, userRepo, policyRepo };
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

describe('AgentsService.createAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const input = {
    name: 'My Agent',
    description: '',
    systemPrompt: 'sys',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
  };

  it('creates the agent when the user is below their policy agent limit', async () => {
    const { service, agentDefRepo } = makeService({ agentCount: 2, maxAgents: 5 });

    await expect(service.createAgent(input, ownerId, 'user')).resolves.toBeDefined();
    expect(agentDefRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Agent', createdById: ownerId }),
    );
  });

  it('rejects with BadRequestException when the user is at their policy agent limit', async () => {
    const { service, agentDefRepo } = makeService({ agentCount: 5, maxAgents: 5 });

    await expect(service.createAgent(input, ownerId, 'user')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(agentDefRepo.create).not.toHaveBeenCalled();
  });

  it('does not enforce the agent limit for admins', async () => {
    const { service, agentDefRepo, policyRepo } = makeService({ agentCount: 99, maxAgents: 5 });

    await expect(service.createAgent(input, adminId, 'admin')).resolves.toBeDefined();
    expect(agentDefRepo.create).toHaveBeenCalled();
    expect(policyRepo.findById).not.toHaveBeenCalled();
  });
});

describe('AgentsService.updateAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards toolConfig to the repository update call', async () => {
    const agentDefUpdate = vi.fn().mockResolvedValue(makeAgent());
    const { service } = makeService({ agentDefUpdate });

    const toolConfig = {
      mcp: { servers: [{ serverId: 'srv-1', enabledTools: ['search'] }] },
    };
    await service.updateAgent(agentId, { toolConfig }, ownerId, 'user');

    expect(agentDefUpdate).toHaveBeenCalledWith(agentId, expect.objectContaining({ toolConfig }));
  });

  it('allows admin to update any agent with toolConfig', async () => {
    const agentDefUpdate = vi.fn().mockResolvedValue(makeAgent());
    const { service } = makeService({ agentDefUpdate });

    const toolConfig = { mcp: { servers: [] } };
    await service.updateAgent(agentId, { toolConfig }, adminId, 'admin');

    expect(agentDefUpdate).toHaveBeenCalledWith(agentId, expect.objectContaining({ toolConfig }));
  });

  it('throws ForbiddenException when non-owner tries to update', async () => {
    const { service } = makeService({});
    await expect(
      service.updateAgent(agentId, { name: 'hacked' }, otherUserId, 'user'),
    ).rejects.toBeInstanceOf(ForbiddenException);
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
