import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@clawix/shared';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import type { UserAgentModel } from '../generated/prisma/models.js';

import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginatedResponse, buildPaginationArgs, handlePrismaError } from './utils.js';

type UserAgent = UserAgentModel;

interface CreateUserAgentInput {
  readonly userId: string;
  readonly agentDefinitionId: string;
  readonly workspacePath: string;
  readonly lastSessionId?: string;
}

interface UpdateUserAgentInput {
  readonly agentDefinitionId?: string;
  readonly workspacePath?: string;
  readonly lastSessionId?: string | null;
}

export interface UserAgentWithDetails {
  readonly id: string;
  readonly userId: string;
  readonly agentDefinitionId: string;
  readonly workspacePath: string;
  readonly lastSessionId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
  readonly agentDefinition: {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly provider: string;
    readonly model: string;
    readonly isActive: boolean;
    readonly isOfficial: boolean;
    readonly createdById: string | null;
  };
}

@Injectable()
export class UserAgentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<UserAgent> {
    const userAgent = await this.prisma.userAgent.findUnique({
      where: { id },
    });

    if (!userAgent) {
      throw new NotFoundError('UserAgent', id);
    }

    return userAgent;
  }

  async findAll(pagination: PaginationInput): Promise<PaginatedResponse<UserAgent>> {
    const paginationArgs = buildPaginationArgs(pagination);

    const [data, total] = await Promise.all([
      this.prisma.userAgent.findMany({
        ...paginationArgs,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.userAgent.count(),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findByUserId(userId: string): Promise<UserAgent | null> {
    return this.prisma.userAgent.findFirst({
      where: { userId, agentDefinition: { role: 'primary' } },
    });
  }

  async existsForUser(userId: string, agentDefinitionId: string): Promise<boolean> {
    const count = await this.prisma.userAgent.count({
      where: { userId, agentDefinitionId },
    });
    return count > 0;
  }

  async create(data: CreateUserAgentInput): Promise<UserAgent> {
    try {
      return await this.prisma.userAgent.create({
        data: {
          userId: data.userId,
          agentDefinitionId: data.agentDefinitionId,
          workspacePath: data.workspacePath,
          ...(data.lastSessionId !== undefined ? { lastSessionId: data.lastSessionId } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'UserAgent');
    }
  }

  async update(id: string, data: UpdateUserAgentInput): Promise<UserAgent> {
    try {
      return await this.prisma.userAgent.update({
        where: { id },
        data: {
          ...(data.agentDefinitionId !== undefined
            ? { agentDefinitionId: data.agentDefinitionId }
            : {}),
          ...(data.workspacePath !== undefined ? { workspacePath: data.workspacePath } : {}),
          ...(data.lastSessionId !== undefined ? { lastSessionId: data.lastSessionId } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'UserAgent');
    }
  }

  async findAllWithDetails(): Promise<UserAgentWithDetails[]> {
    return this.prisma.userAgent.findMany({
      include: {
        user: { select: { id: true, name: true, email: true } },
        agentDefinition: {
          select: {
            id: true,
            name: true,
            role: true,
            provider: true,
            model: true,
            isActive: true,
            isOfficial: true,
            createdById: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }) as unknown as UserAgentWithDetails[];
  }

  async findAllByUserIdWithDetails(userId: string): Promise<UserAgentWithDetails[]> {
    return this.prisma.userAgent.findMany({
      where: { userId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        agentDefinition: {
          select: {
            id: true,
            name: true,
            role: true,
            provider: true,
            model: true,
            isActive: true,
            isOfficial: true,
            createdById: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }) as unknown as UserAgentWithDetails[];
  }

  async delete(id: string): Promise<UserAgent> {
    try {
      return await this.prisma.userAgent.delete({ where: { id } });
    } catch (error: unknown) {
      handlePrismaError(error, 'UserAgent');
    }
  }
}
