import { ForbiddenException, Injectable } from '@nestjs/common';

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
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AgentsService {
  constructor(
    private readonly agentDefRepo: AgentDefinitionRepository,
    private readonly agentRunRepo: AgentRunRepository,
    private readonly userAgentRepo: UserAgentRepository,
    private readonly prisma: PrismaService,
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

  async getAgent(id: string): Promise<AgentDefinition> {
    return this.agentDefRepo.findById(id);
  }

  async createAgent(
    input: CreateAgentDefinitionInput,
    createdById?: string,
  ): Promise<AgentDefinition> {
    return this.agentDefRepo.create({ ...input, createdById });
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
  ): Promise<PaginatedResponse<AgentRun>> {
    return this.agentRunRepo.findByAgentDefinitionId(agentDefinitionId, pagination);
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

    return this.userAgentRepo.create({
      userId: input.userId,
      agentDefinitionId: input.agentDefinitionId,
      workspacePath,
    });
  }

  async updateUserAgent(id: string, input: { readonly agentDefinitionId: string }) {
    return this.userAgentRepo.update(id, { agentDefinitionId: input.agentDefinitionId });
  }

  async deleteUserAgent(id: string) {
    return this.userAgentRepo.delete(id);
  }

  async listConfiguredProviders() {
    // Only return providers that have been configured with an API key
    const configs = await this.prisma.providerConfig.findMany({
      where: { isEnabled: true },
      select: { provider: true },
    });
    const configuredNames = new Set(configs.map((c) => c.provider));

    return listProviders()
      .filter((p) => p.name !== 'custom' && configuredNames.has(p.name))
      .map((p) => ({
        name: p.name,
        displayName: p.displayName,
        defaultModel: p.defaultModel,
        models: (p.pricing ?? []).map((m) => m.model),
      }));
  }
}
