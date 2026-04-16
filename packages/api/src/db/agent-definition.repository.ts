import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@clawix/shared';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import { type AgentDefinition, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginatedResponse, buildPaginationArgs, handlePrismaError } from './utils.js';

interface CreateAgentDefinitionData {
  readonly name: string;
  readonly description?: string;
  readonly systemPrompt?: string;
  readonly role?: 'primary' | 'worker';
  readonly provider?: string;
  readonly model?: string;
  readonly apiBaseUrl?: string | null;
  readonly skillIds?: string[];
  readonly maxTokensPerRun?: number;
  readonly containerConfig?: Prisma.InputJsonValue;
  readonly isOfficial?: boolean;
  readonly createdById?: string | null;
}

type UpdateAgentDefinitionData = Partial<CreateAgentDefinitionData> & {
  readonly isActive?: boolean;
};

@Injectable()
export class AgentDefinitionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find the first active agent definition matching the given name.
   * Returns null if not found (does NOT throw NotFoundError).
   */
  async findByName(name: string): Promise<AgentDefinition | null> {
    return this.prisma.agentDefinition.findFirst({
      where: { name, isActive: true },
    });
  }

  /**
   * Return all active agent definitions with role = 'worker'.
   */
  async findActiveWorkers(): Promise<AgentDefinition[]> {
    return this.prisma.agentDefinition.findMany({
      where: { role: 'worker', isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Find or create the built-in "default-worker" agent definition used
   * for anonymous sub-agent spawns.
   */
  async findOrCreateDefaultWorker(provider: string, model: string): Promise<AgentDefinition> {
    const existing = await this.prisma.agentDefinition.findFirst({
      where: { name: 'default-worker', role: 'worker' },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.agentDefinition.create({
      data: {
        name: 'default-worker',
        description: 'Default worker agent for anonymous sub-agent tasks',
        systemPrompt: 'Complete the assigned task thoroughly and report the result.',
        role: 'worker',
        provider,
        model,
        containerConfig: {
          image: process.env['AGENT_CONTAINER_IMAGE'] ?? 'clawix-agent:latest',
          cpuLimit: '0.5',
          memoryLimit: '512m',
          timeoutSeconds: 300,
          readOnlyRootfs: false,
          allowedMounts: [],
        },
      },
    });
  }

  async findById(id: string): Promise<AgentDefinition> {
    const agent = await this.prisma.agentDefinition.findUnique({ where: { id } });

    if (!agent) {
      throw new NotFoundError('AgentDefinition', id);
    }

    return agent;
  }

  async findByRole(
    role: 'primary' | 'worker',
    pagination: PaginationInput,
  ): Promise<PaginatedResponse<AgentDefinition>> {
    const { skip, take } = buildPaginationArgs(pagination);
    const where = { role };

    const [total, data] = await Promise.all([
      this.prisma.agentDefinition.count({ where }),
      this.prisma.agentDefinition.findMany({
        skip,
        take,
        where,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findAll(
    pagination: PaginationInput,
    options?: { includeCreatedBy?: boolean },
  ): Promise<PaginatedResponse<AgentDefinition>> {
    const { skip, take } = buildPaginationArgs(pagination);

    const [total, data] = await Promise.all([
      this.prisma.agentDefinition.count(),
      this.prisma.agentDefinition.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        ...(options?.includeCreatedBy
          ? { include: { createdBy: { select: { id: true, name: true, email: true } } } }
          : {}),
      }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findActive(pagination: PaginationInput): Promise<PaginatedResponse<AgentDefinition>> {
    const { skip, take } = buildPaginationArgs(pagination);
    const where = { isActive: true };

    const [total, data] = await Promise.all([
      this.prisma.agentDefinition.count({ where }),
      this.prisma.agentDefinition.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async create(data: CreateAgentDefinitionData): Promise<AgentDefinition> {
    try {
      return await this.prisma.agentDefinition.create({
        data: {
          name: data.name,
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.systemPrompt !== undefined ? { systemPrompt: data.systemPrompt } : {}),
          ...(data.role !== undefined ? { role: data.role } : {}),
          ...(data.provider !== undefined ? { provider: data.provider } : {}),
          ...(data.model !== undefined ? { model: data.model } : {}),
          ...(data.apiBaseUrl !== undefined ? { apiBaseUrl: data.apiBaseUrl } : {}),
          ...(data.skillIds !== undefined ? { skillIds: data.skillIds } : {}),
          ...(data.maxTokensPerRun !== undefined ? { maxTokensPerRun: data.maxTokensPerRun } : {}),
          ...(data.containerConfig !== undefined ? { containerConfig: data.containerConfig } : {}),
          ...(data.isOfficial !== undefined ? { isOfficial: data.isOfficial } : {}),
          ...(data.createdById !== undefined ? { createdById: data.createdById } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'AgentDefinition');
    }
  }

  async update(id: string, data: UpdateAgentDefinitionData): Promise<AgentDefinition> {
    try {
      return await this.prisma.agentDefinition.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.systemPrompt !== undefined ? { systemPrompt: data.systemPrompt } : {}),
          ...(data.role !== undefined ? { role: data.role } : {}),
          ...(data.provider !== undefined ? { provider: data.provider } : {}),
          ...(data.model !== undefined ? { model: data.model } : {}),
          ...(data.apiBaseUrl !== undefined ? { apiBaseUrl: data.apiBaseUrl } : {}),
          ...(data.skillIds !== undefined ? { skillIds: data.skillIds } : {}),
          ...(data.maxTokensPerRun !== undefined ? { maxTokensPerRun: data.maxTokensPerRun } : {}),
          ...(data.containerConfig !== undefined ? { containerConfig: data.containerConfig } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.isOfficial !== undefined ? { isOfficial: data.isOfficial } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'AgentDefinition');
    }
  }

  async delete(id: string): Promise<AgentDefinition> {
    try {
      return await this.prisma.agentDefinition.delete({ where: { id } });
    } catch (error: unknown) {
      handlePrismaError(error, 'AgentDefinition');
    }
  }
}
