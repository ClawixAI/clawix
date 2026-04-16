import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@clawix/shared';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import type { TokenUsage } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginatedResponse, buildPaginationArgs, handlePrismaError } from './utils.js';

interface CreateTokenUsageData {
  readonly agentRunId: string;
  readonly userId: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd?: number;
}

interface TokenUsageSum {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalTokens: number;
  readonly totalEstimatedCostUsd: number;
}

interface TokenUsageByModel {
  readonly model: string;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
}

@Injectable()
export class TokenUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<TokenUsage> {
    const result = await this.prisma.tokenUsage.findUnique({ where: { id } });

    if (!result) {
      throw new NotFoundError('TokenUsage', id);
    }

    return result;
  }

  async findByUserId(
    userId: string,
    pagination: PaginationInput,
  ): Promise<PaginatedResponse<TokenUsage>> {
    const { skip, take } = buildPaginationArgs(pagination);
    const where = { userId };

    const [data, total] = await Promise.all([
      this.prisma.tokenUsage.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tokenUsage.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findByAgentRunId(agentRunId: string): Promise<TokenUsage[]> {
    return this.prisma.tokenUsage.findMany({
      where: { agentRunId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date,
    pagination: PaginationInput,
  ): Promise<PaginatedResponse<TokenUsage>> {
    const { skip, take } = buildPaginationArgs(pagination);
    const where = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    const [data, total] = await Promise.all([
      this.prisma.tokenUsage.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tokenUsage.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async create(data: CreateTokenUsageData): Promise<TokenUsage> {
    try {
      return await this.prisma.tokenUsage.create({
        data: {
          agentRunId: data.agentRunId,
          userId: data.userId,
          model: data.model,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          totalTokens: data.totalTokens,
          ...(data.estimatedCostUsd !== undefined
            ? { estimatedCostUsd: data.estimatedCostUsd }
            : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'TokenUsage');
    }
  }

  async sumByUserId(userId: string, startDate: Date, endDate: Date): Promise<TokenUsageSum> {
    const result = await this.prisma.tokenUsage.aggregate({
      where: {
        userId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
      },
    });

    return {
      totalInputTokens: result._sum.inputTokens ?? 0,
      totalOutputTokens: result._sum.outputTokens ?? 0,
      totalTokens: result._sum.totalTokens ?? 0,
      totalEstimatedCostUsd: result._sum.estimatedCostUsd ?? 0,
    };
  }

  async sumAllUsers(
    startDate: Date,
    endDate: Date,
  ): Promise<
    {
      userId: string;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
      totalEstimatedCostUsd: number;
    }[]
  > {
    const results = await this.prisma.tokenUsage.groupBy({
      by: ['userId'],
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
      },
    });

    return results.map((row) => ({
      userId: row.userId,
      totalInputTokens: row._sum.inputTokens ?? 0,
      totalOutputTokens: row._sum.outputTokens ?? 0,
      totalTokens: row._sum.totalTokens ?? 0,
      totalEstimatedCostUsd: row._sum.estimatedCostUsd ?? 0,
    }));
  }

  async sumByUserGroupedByAgent(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<
    {
      agentDefinitionId: string;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
      totalEstimatedCostUsd: number;
    }[]
  > {
    const results = await this.prisma.$queryRaw<
      {
        agent_definition_id: string;
        total_input: bigint;
        total_output: bigint;
        total_tokens: bigint;
        total_cost: number;
      }[]
    >`
      SELECT
        ar."agentDefinitionId" as agent_definition_id,
        COALESCE(SUM(tu."inputTokens"), 0) as total_input,
        COALESCE(SUM(tu."outputTokens"), 0) as total_output,
        COALESCE(SUM(tu."totalTokens"), 0) as total_tokens,
        COALESCE(SUM(tu."estimatedCostUsd"), 0) as total_cost
      FROM "TokenUsage" tu
      JOIN "AgentRun" ar ON tu."agentRunId" = ar."id"
      WHERE tu."userId" = ${userId}
        AND tu."createdAt" >= ${startDate}
        AND tu."createdAt" <= ${endDate}
      GROUP BY ar."agentDefinitionId"
      ORDER BY total_tokens DESC
    `;

    return results.map((row) => ({
      agentDefinitionId: row.agent_definition_id,
      totalInputTokens: Number(row.total_input),
      totalOutputTokens: Number(row.total_output),
      totalTokens: Number(row.total_tokens),
      totalEstimatedCostUsd: Number(row.total_cost),
    }));
  }

  async dailyUsage(
    startDate: Date,
    endDate: Date,
    userId?: string,
  ): Promise<
    {
      date: string;
      totalTokens: number;
      totalEstimatedCostUsd: number;
    }[]
  > {
    if (userId) {
      const results = await this.prisma.$queryRaw<
        {
          date: string;
          total_tokens: bigint;
          total_cost: number;
        }[]
      >`
        SELECT
          TO_CHAR("createdAt", 'YYYY-MM-DD') as date,
          COALESCE(SUM("totalTokens"), 0) as total_tokens,
          COALESCE(SUM("estimatedCostUsd"), 0) as total_cost
        FROM "TokenUsage"
        WHERE "createdAt" >= ${startDate}
          AND "createdAt" <= ${endDate}
          AND "userId" = ${userId}
        GROUP BY TO_CHAR("createdAt", 'YYYY-MM-DD')
        ORDER BY date ASC
      `;
      return results.map((row) => ({
        date: row.date,
        totalTokens: Number(row.total_tokens),
        totalEstimatedCostUsd: Number(row.total_cost),
      }));
    }

    const results = await this.prisma.$queryRaw<
      {
        date: string;
        total_tokens: bigint;
        total_cost: number;
      }[]
    >`
      SELECT
        TO_CHAR("createdAt", 'YYYY-MM-DD') as date,
        COALESCE(SUM("totalTokens"), 0) as total_tokens,
        COALESCE(SUM("estimatedCostUsd"), 0) as total_cost
      FROM "TokenUsage"
      WHERE "createdAt" >= ${startDate}
        AND "createdAt" <= ${endDate}
      GROUP BY TO_CHAR("createdAt", 'YYYY-MM-DD')
      ORDER BY date ASC
    `;
    return results.map((row) => ({
      date: row.date,
      totalTokens: Number(row.total_tokens),
      totalEstimatedCostUsd: Number(row.total_cost),
    }));
  }

  async sumByModel(startDate: Date, endDate: Date): Promise<readonly TokenUsageByModel[]> {
    const results = await this.prisma.tokenUsage.groupBy({
      by: ['model'],
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        totalTokens: true,
        estimatedCostUsd: true,
      },
    });

    return results.map((row) => ({
      model: row.model,
      totalTokens: row._sum.totalTokens ?? 0,
      totalCostUsd: row._sum.estimatedCostUsd ?? 0,
    }));
  }
}
