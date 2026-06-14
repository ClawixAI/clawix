import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import type {
  CreateAgentDefinitionInput,
  PaginatedResponse,
  PaginationInput,
  UpdateAgentDefinitionInput,
} from '@clawix/shared';
import { listProviders } from '@clawix/shared';
import type { AgentDefinition, AgentRun } from '../generated/prisma/client.js';
import { AgentDefinitionRepository } from '../db/agent-definition.repository.js';
import { AgentRunRepository } from '../db/agent-run.repository.js';
import { UserAgentRepository } from '../db/user-agent.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationFanoutService } from '../notifications/notifications.fanout.js';

@Injectable()
export class AgentsService {
  constructor(
    private readonly agentDefRepo: AgentDefinitionRepository,
    private readonly agentRunRepo: AgentRunRepository,
    private readonly userAgentRepo: UserAgentRepository,
    private readonly userRepo: UserRepository,
    private readonly policyRepo: PolicyRepository,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationFanoutService,
  ) {}

  async listAgents(
    pagination: PaginationInput,
    role?: 'primary' | 'worker',
    options?: { includeCreatedBy?: boolean },
  ): Promise<PaginatedResponse<AgentDefinition>> {
    if (role) {
      return this.agentDefRepo.findByRole(role, pagination);
    }
    return this.agentDefRepo.findAll(pagination, options);
  }

  async getAgent(id: string, userId?: string, userRole?: string): Promise<AgentDefinition> {
    const agent = await this.agentDefRepo.findById(id);
    if (userRole === 'admin' || !userId) {
      return agent;
    }
    if (agent.isOfficial || agent.createdById === userId) {
      return agent;
    }
    const assigned = await this.userAgentRepo.existsForUser(userId, id);
    if (!assigned) {
      throw new ForbiddenException('You do not have access to this agent');
    }
    return agent;
  }

  async createAgent(
    input: CreateAgentDefinitionInput,
    createdById?: string,
    userRole?: string,
  ): Promise<AgentDefinition> {
    // Only admins may create Public (official) agents; force false otherwise
    // so non-admins can't escalate by setting the flag in the request body.
    const isOfficial = userRole === 'admin' ? (input.isOfficial ?? false) : false;
    // Enforce the per-policy agent quota for regular users. Admins (who create
    // official/template agents) are exempt.
    if (createdById && userRole !== 'admin') {
      await this.enforceAgentLimit(createdById);
    }
    return this.agentDefRepo.create({ ...input, createdById, isOfficial });
  }

  /**
   * Throw `BadRequestException` if the user already owns the maximum number of
   * agents permitted by their policy (`Policy.maxAgents`).
   */
  private async enforceAgentLimit(userId: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    const policy = await this.policyRepo.findById(user.policyId);
    const count = await this.agentDefRepo.countByCreator(userId);
    if (count >= policy.maxAgents) {
      throw new BadRequestException(
        `Agent limit reached: your plan allows at most ${policy.maxAgents} agents`,
      );
    }
  }

  async updateAgent(
    id: string,
    input: UpdateAgentDefinitionInput & { readonly isActive?: boolean },
    userId?: string,
    userRole?: string,
  ): Promise<AgentDefinition> {
    if (userRole !== 'admin') {
      const existing = await this.agentDefRepo.findById(id);
      if (existing.isOfficial || existing.createdById !== userId) {
        throw new ForbiddenException('You can only edit your own custom agent definitions');
      }
    }
    return this.agentDefRepo.update(id, input);
  }

  async deleteAgent(id: string, userId?: string, userRole?: string): Promise<AgentDefinition> {
    if (userRole !== 'admin') {
      const existing = await this.agentDefRepo.findById(id);
      if (existing.isOfficial || existing.createdById !== userId) {
        throw new ForbiddenException('You can only delete your own custom agent definitions');
      }
    }
    return this.agentDefRepo.delete(id);
  }

  async listAgentRuns(
    agentDefinitionId: string,
    pagination: PaginationInput,
    userId?: string,
    userRole?: string,
  ): Promise<PaginatedResponse<AgentRun>> {
    const scopeUserId = userRole === 'admin' ? undefined : userId;
    return this.agentRunRepo.findByAgentDefinitionId(agentDefinitionId, pagination, scopeUserId);
  }

  async listUserAgents(userId: string, userRole: string) {
    if (userRole === 'admin') {
      return this.userAgentRepo.findAllWithDetails();
    }
    return this.userAgentRepo.findAllByUserIdWithDetails(userId);
  }

  async createSubAgent(
    input: {
      readonly userId: string;
      readonly name: string;
      readonly description?: string;
      readonly systemPrompt: string;
      readonly provider: string;
      readonly model: string;
      readonly maxTokensPerRun?: number;
    },
    createdById?: string,
  ) {
    // Find user's primary agent to get workspace path
    const primaryUserAgent = await this.userAgentRepo.findByUserId(input.userId);
    const workspacePath = primaryUserAgent?.workspacePath ?? `users/${input.userId}/workspace`;

    // Create the agent definition with role=worker
    const agentDef = await this.agentDefRepo.create({
      name: input.name,
      description: input.description,
      systemPrompt: input.systemPrompt,
      provider: input.provider,
      model: input.model,
      maxTokensPerRun: input.maxTokensPerRun,
      role: 'worker',
      isOfficial: false,
      createdById,
    });

    // Create the user-agent binding with same workspace as primary
    const userAgent = await this.userAgentRepo.create({
      userId: input.userId,
      agentDefinitionId: agentDef.id,
      workspacePath,
    });

    return { agentDefinition: agentDef, userAgent };
  }

  async assignUserAgent(input: { readonly userId: string; readonly agentDefinitionId: string }) {
    const primaryUserAgent = await this.userAgentRepo.findByUserId(input.userId);
    const workspacePath = primaryUserAgent?.workspacePath ?? `users/${input.userId}/workspace`;

    const created = await this.userAgentRepo.create({
      userId: input.userId,
      agentDefinitionId: input.agentDefinitionId,
      workspacePath,
    });
    await this.notifyAgentAssigned(input.userId, input.agentDefinitionId);
    return created;
  }

  async updateUserAgent(id: string, input: { readonly agentDefinitionId: string }) {
    const updated = await this.userAgentRepo.update(id, {
      agentDefinitionId: input.agentDefinitionId,
    });
    await this.notifyAgentAssigned(updated.userId, input.agentDefinitionId);
    return updated;
  }

  private async notifyAgentAssigned(userId: string, agentDefinitionId: string): Promise<void> {
    // Best-effort: pull the agent's name for a friendlier notification body.
    let agentName: string | null = null;
    try {
      const agent = await this.agentDefRepo.findById(agentDefinitionId);
      agentName = agent?.name ?? null;
    } catch {
      // Repo throws if not found; we'd rather notify with the id than crash.
    }
    await this.notifications.create({
      recipientId: userId,
      type: 'PRIMARY_AGENT_ASSIGNED',
      payload: { agentDefinitionId, agentName },
    });
  }

  async deleteUserAgent(id: string) {
    return this.userAgentRepo.delete(id);
  }

  async listConfiguredProviders() {
    // Fetch all enabled provider configs from DB
    const configs = await this.prisma.providerConfig.findMany({
      where: { isEnabled: true },
      select: { provider: true, displayName: true },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    });

    // Build a map of configured provider names for quick lookup
    const configuredNames = new Set(configs.map((c) => c.provider));

    // Get built-in providers that are configured
    const builtinProviders = listProviders()
      .filter((p) => p.name !== 'custom' && configuredNames.has(p.name))
      .map((p) => ({
        name: p.name,
        displayName: p.displayName,
        defaultModel: p.defaultModel,
        models: (p.pricing ?? []).map((m) => m.model),
      }));

    // Get custom providers (in DB but not in built-in list)
    const builtinNames = new Set(listProviders().map((p) => p.name));
    const customProviders = configs
      .filter((c) => !builtinNames.has(c.provider))
      .map((c) => ({
        name: c.provider,
        displayName: c.displayName,
        defaultModel: '',
        models: [] as string[], // Empty array allows custom model input in UI
      }));

    return [...builtinProviders, ...customProviders];
  }
}
