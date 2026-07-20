import { Injectable } from '@nestjs/common';

import type { ApprovalRequest, ApprovalStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface CreateInput {
  readonly userId: string;
  readonly agentRunId: string;
  readonly sessionId?: string | null;
  readonly toolName: string;
  readonly paramsSummary: Prisma.InputJsonValue;
  readonly status?: ApprovalStatus;
  readonly scope?: string;
  readonly resolutionReason?: string;
  readonly memoryStore?: string;
  readonly memoryKey?: string;
  readonly resolvedAt?: Date;
}

/**
 * Repository for ApprovalRequest data access.
 * Provides atomic status transitions and expiration utilities.
 */
@Injectable()
export class ApprovalRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateInput): Promise<ApprovalRequest> {
    return this.prisma.approvalRequest.create({
      data: {
        userId: input.userId,
        agentRunId: input.agentRunId,
        sessionId: input.sessionId ?? null,
        toolName: input.toolName,
        paramsSummary: input.paramsSummary,
        status: input.status ?? 'PENDING',
        scope: input.scope,
        resolutionReason: input.resolutionReason,
        memoryStore: input.memoryStore,
        memoryKey: input.memoryKey,
        resolvedAt: input.resolvedAt,
      },
    });
  }

  async findById(id: string): Promise<ApprovalRequest | null> {
    return this.prisma.approvalRequest.findUnique({
      where: { id },
    });
  }

  async listPendingForUser(userId: string): Promise<ApprovalRequest[]> {
    return this.prisma.approvalRequest.findMany({
      where: { userId, status: 'PENDING' },
    });
  }

  /**
   * Atomically transition a request from one status to another.
   * The `from` status acts as a guard — returns true only if the row
   * matched the id AND was in the `from` status.
   */
  async transitionStatus(
    id: string,
    from: ApprovalStatus,
    patch: {
      status: ApprovalStatus;
      scope?: string;
      resolutionReason?: string;
      memoryStore?: string;
      memoryKey?: string;
    },
  ): Promise<boolean> {
    const result = await this.prisma.approvalRequest.updateMany({
      where: { id, status: from },
      data: { ...patch, resolvedAt: new Date() },
    });
    return result.count === 1;
  }

  /**
   * Expire all pending requests in a startup sweep.
   * Returns the count of rows updated.
   */
  async expireAllPending(reason: string): Promise<number> {
    const result = await this.prisma.approvalRequest.updateMany({
      where: { status: 'PENDING' },
      data: { status: 'EXPIRED', resolutionReason: reason, resolvedAt: new Date() },
    });
    return result.count;
  }
}
