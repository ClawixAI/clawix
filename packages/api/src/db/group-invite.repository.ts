import { Injectable } from '@nestjs/common';

import type { GroupInvite, GroupInviteStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface CreateInput {
  readonly groupId: string;
  readonly inviteeId: string;
  readonly invitedById: string;
}

interface TransitionInput {
  readonly id: string;
  readonly fromStatus: GroupInviteStatus;
  readonly toStatus: GroupInviteStatus;
}

const summaryInclude = {
  group: { select: { id: true, name: true } },
  invitee: { select: { id: true, name: true, email: true } },
  invitedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.GroupInviteInclude;

export type GroupInviteSummary = Prisma.GroupInviteGetPayload<{ include: typeof summaryInclude }>;

/**
 * Repository for `GroupInvite` workflow rows. Status transitions go through
 * `transitionStatus` which uses an atomic `updateMany` with a status guard
 * so racing actors (e.g. two windows of the same user clicking Accept) can't
 * both succeed.
 */
@Injectable()
export class GroupInviteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateInput): Promise<GroupInvite> {
    return this.prisma.groupInvite.create({
      data: {
        groupId: input.groupId,
        inviteeId: input.inviteeId,
        invitedById: input.invitedById,
      },
    });
  }

  async findById(id: string): Promise<GroupInvite | null> {
    return this.prisma.groupInvite.findUnique({ where: { id } });
  }

  async findExistingPending(groupId: string, inviteeId: string): Promise<GroupInvite | null> {
    return this.prisma.groupInvite.findFirst({
      where: { groupId, inviteeId, status: 'PENDING' },
    });
  }

  async listPendingByInvitee(inviteeId: string): Promise<readonly GroupInviteSummary[]> {
    return this.prisma.groupInvite.findMany({
      where: { inviteeId, status: 'PENDING' },
      include: summaryInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listSentByUser(invitedById: string): Promise<readonly GroupInviteSummary[]> {
    return this.prisma.groupInvite.findMany({
      where: { invitedById },
      include: summaryInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPendingByGroup(groupId: string): Promise<readonly GroupInviteSummary[]> {
    return this.prisma.groupInvite.findMany({
      where: { groupId, status: 'PENDING' },
      include: summaryInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Atomic state transition. Returns true if the row was in `fromStatus` and
   * was updated; false if the row had already moved on (race lost / stale).
   */
  async transitionStatus(input: TransitionInput): Promise<boolean> {
    const result = await this.prisma.groupInvite.updateMany({
      where: { id: input.id, status: input.fromStatus },
      data: { status: input.toStatus, reviewedAt: new Date() },
    });
    return result.count === 1;
  }
}
