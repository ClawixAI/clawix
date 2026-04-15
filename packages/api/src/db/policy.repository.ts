import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@clawix/shared';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import { type Policy, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginatedResponse, buildPaginationArgs, handlePrismaError } from './utils.js';

interface CreatePolicyData {
  readonly name: string;
  readonly description?: string | null;
  readonly maxTokenBudget?: number | null;
  readonly maxAgents?: number;
  readonly maxSkills?: number;
  readonly maxMemoryItems?: number;
  readonly maxGroupsOwned?: number;
  readonly allowedProviders?: string[];
  readonly cronEnabled?: boolean;
  readonly maxScheduledTasks?: number;
  readonly minCronIntervalSecs?: number;
  readonly maxTokensPerCronRun?: number | null;
  readonly features?: Prisma.InputJsonValue;
}

type UpdatePolicyData = Partial<CreatePolicyData> & {
  readonly isActive?: boolean;
};

@Injectable()
export class PolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Policy> {
    const policy = await this.prisma.policy.findUnique({ where: { id } });

    if (!policy) {
      throw new NotFoundError('Policy', id);
    }

    return policy;
  }

  async findAll(pagination: PaginationInput): Promise<PaginatedResponse<Policy>> {
    const { skip, take } = buildPaginationArgs(pagination);

    const [total, data] = await Promise.all([
      this.prisma.policy.count(),
      this.prisma.policy.findMany({ skip, take, orderBy: { createdAt: 'desc' } }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findByName(name: string): Promise<Policy | null> {
    return this.prisma.policy.findUnique({ where: { name } });
  }

  async findActive(pagination: PaginationInput): Promise<PaginatedResponse<Policy>> {
    const { skip, take } = buildPaginationArgs(pagination);
    const where = { isActive: true };

    const [total, data] = await Promise.all([
      this.prisma.policy.count({ where }),
      this.prisma.policy.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async create(data: CreatePolicyData): Promise<Policy> {
    try {
      return await this.prisma.policy.create({
        data: {
          name: data.name,
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.maxTokenBudget !== undefined ? { maxTokenBudget: data.maxTokenBudget } : {}),
          ...(data.maxAgents !== undefined ? { maxAgents: data.maxAgents } : {}),
          ...(data.maxSkills !== undefined ? { maxSkills: data.maxSkills } : {}),
          ...(data.maxMemoryItems !== undefined ? { maxMemoryItems: data.maxMemoryItems } : {}),
          ...(data.maxGroupsOwned !== undefined ? { maxGroupsOwned: data.maxGroupsOwned } : {}),
          ...(data.allowedProviders !== undefined
            ? { allowedProviders: data.allowedProviders }
            : {}),
          ...(data.cronEnabled !== undefined ? { cronEnabled: data.cronEnabled } : {}),
          ...(data.maxScheduledTasks !== undefined ? { maxScheduledTasks: data.maxScheduledTasks } : {}),
          ...(data.minCronIntervalSecs !== undefined ? { minCronIntervalSecs: data.minCronIntervalSecs } : {}),
          ...(data.maxTokensPerCronRun !== undefined ? { maxTokensPerCronRun: data.maxTokensPerCronRun } : {}),
          ...(data.features !== undefined ? { features: data.features } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'Policy');
    }
  }

  async update(id: string, data: UpdatePolicyData): Promise<Policy> {
    try {
      return await this.prisma.policy.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.maxTokenBudget !== undefined ? { maxTokenBudget: data.maxTokenBudget } : {}),
          ...(data.maxAgents !== undefined ? { maxAgents: data.maxAgents } : {}),
          ...(data.maxSkills !== undefined ? { maxSkills: data.maxSkills } : {}),
          ...(data.maxMemoryItems !== undefined ? { maxMemoryItems: data.maxMemoryItems } : {}),
          ...(data.maxGroupsOwned !== undefined ? { maxGroupsOwned: data.maxGroupsOwned } : {}),
          ...(data.allowedProviders !== undefined
            ? { allowedProviders: data.allowedProviders }
            : {}),
          ...(data.cronEnabled !== undefined ? { cronEnabled: data.cronEnabled } : {}),
          ...(data.maxScheduledTasks !== undefined ? { maxScheduledTasks: data.maxScheduledTasks } : {}),
          ...(data.minCronIntervalSecs !== undefined ? { minCronIntervalSecs: data.minCronIntervalSecs } : {}),
          ...(data.maxTokensPerCronRun !== undefined ? { maxTokensPerCronRun: data.maxTokensPerCronRun } : {}),
          ...(data.features !== undefined ? { features: data.features } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'Policy');
    }
  }

  async delete(id: string): Promise<Policy> {
    try {
      return await this.prisma.policy.delete({ where: { id } });
    } catch (error: unknown) {
      handlePrismaError(error, 'Policy');
    }
  }
}
