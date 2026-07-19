import { Injectable } from '@nestjs/common';

import type { UserToolApproval } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface UpsertInput {
  readonly userId: string;
  readonly toolName: string;
  readonly resourceKey: string;
  readonly decision: 'allowed' | 'denied';
}

/**
 * Repository for UserToolApproval data access.
 * Manages per-user standing decisions for tool and resource combinations.
 */
@Injectable()
export class UserToolApprovalRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create or update a user's tool approval decision.
   * Uses a compound unique key (userId, toolName, resourceKey).
   */
  async upsert(input: UpsertInput): Promise<UserToolApproval> {
    const { userId, toolName, resourceKey, decision } = input;
    return this.prisma.userToolApproval.upsert({
      where: { userId_toolName_resourceKey: { userId, toolName, resourceKey } },
      create: { userId, toolName, resourceKey, decision },
      update: { decision },
    });
  }

  /**
   * Find all approvals for a user across multiple resource keys
   * in a single query. Queries both specificity levels (specific + run-scope sentinel '').
   */
  async findForKeys(
    userId: string,
    toolName: string,
    resourceKeys: readonly string[],
  ): Promise<UserToolApproval[]> {
    return this.prisma.userToolApproval.findMany({
      where: { userId, toolName, resourceKey: { in: [...resourceKeys] } },
    });
  }

  /**
   * List all standing approvals for a user.
   */
  async listForUser(userId: string): Promise<UserToolApproval[]> {
    return this.prisma.userToolApproval.findMany({
      where: { userId },
    });
  }

  /**
   * Delete a specific approval by id, guarded by userId.
   * Returns true if a row was deleted, false if the id/userId mismatch
   * (prevents cross-user deletion).
   */
  async deleteById(id: string, userId: string): Promise<boolean> {
    const result = await this.prisma.userToolApproval.deleteMany({
      where: { id, userId },
    });
    return result.count === 1;
  }

  /**
   * Delete all approvals matching a specific resource key.
   * Returns true if at least one row was deleted.
   */
  async deleteByKey(userId: string, toolName: string, resourceKey: string): Promise<boolean> {
    const result = await this.prisma.userToolApproval.deleteMany({
      where: { userId, toolName, resourceKey },
    });
    return result.count > 0;
  }
}
