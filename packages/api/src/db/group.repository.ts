import { Injectable } from '@nestjs/common';

import { NotFoundError } from '@clawix/shared';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import { type Group, type GroupMember, Prisma } from '../generated/prisma/client.js';
import type { GroupMemberRole } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginatedResponse, buildPaginationArgs, handlePrismaError } from './utils.js';

const memberUserSelect = { id: true, name: true, email: true } as const;

type GroupWithDetails = Prisma.GroupGetPayload<{
  include: {
    members: {
      include: { user: { select: typeof memberUserSelect } };
    };
    _count: { select: { members: true } };
  };
}>;

type GroupMemberWithUser = Prisma.GroupMemberGetPayload<{
  include: { user: { select: typeof memberUserSelect } };
}>;

@Injectable()
export class GroupRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<GroupWithDetails> {
    const group = await this.prisma.group.findFirst({
      // Soft-deleted groups are invisible to every read path; the only way
      // back is an admin restore (deferred).
      where: { id, deletedAt: null },
      include: {
        members: {
          include: { user: { select: memberUserSelect } },
          orderBy: { joinedAt: 'asc' },
        },
        _count: { select: { members: true } },
      },
    });

    if (!group) {
      throw new NotFoundError('Group', id);
    }

    return group;
  }

  async findAll(pagination: PaginationInput): Promise<PaginatedResponse<GroupWithDetails>> {
    const paginationArgs = buildPaginationArgs(pagination);
    const where = { deletedAt: null };

    const [data, total] = await Promise.all([
      this.prisma.group.findMany({
        ...paginationArgs,
        where,
        include: {
          _count: { select: { members: true } },
          members: {
            where: { role: 'OWNER' },
            take: 1,
            include: { user: { select: memberUserSelect } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.group.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async create(data: {
    readonly name: string;
    readonly description?: string;
    readonly createdById: string;
  }): Promise<Group> {
    try {
      return await this.prisma.group.create({
        data: {
          name: data.name,
          description: data.description,
          createdById: data.createdById,
          members: {
            create: {
              userId: data.createdById,
              role: 'OWNER',
            },
          },
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Group');
    }
  }

  async update(
    id: string,
    data: { readonly name?: string; readonly description?: string | null },
  ): Promise<Group> {
    try {
      return await this.prisma.group.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Group');
    }
  }

  /**
   * Soft-delete: stamps `deletedAt` so listings hide the group. The group
   * identity, members, invites, and audit references all survive — recovery /
   * shared-workspace features can lean on them later.
   *
   * Note: legacy MemoryShare revocation was removed when the MemoryShare
   * table was dropped (post-Phase-5 backfill). WikiShare is the current
   * sharing primitive and is not coupled to group soft-delete lifecycle.
   */
  async delete(id: string): Promise<Group> {
    try {
      return await this.prisma.group.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    } catch (error) {
      handlePrismaError(error, 'Group');
    }
  }

  /**
   * Inverse of `delete()`. Clears the group's `deletedAt` so listings show
   * the group again.
   */
  async restore(id: string): Promise<Group> {
    try {
      const existing = await this.prisma.group.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError('Group', id);
      return await this.prisma.group.update({
        where: { id },
        data: { deletedAt: null },
      });
    } catch (error) {
      handlePrismaError(error, 'Group');
    }
  }

  /** Admin-only listing of soft-deleted groups, newest first. */
  async findDeleted(pagination: PaginationInput): Promise<PaginatedResponse<GroupWithDetails>> {
    const paginationArgs = buildPaginationArgs(pagination);
    const where = { deletedAt: { not: null } };

    const [data, total] = await Promise.all([
      this.prisma.group.findMany({
        ...paginationArgs,
        where,
        include: {
          members: {
            include: { user: { select: memberUserSelect } },
            orderBy: { joinedAt: 'asc' },
          },
          _count: { select: { members: true } },
        },
        orderBy: { deletedAt: 'desc' },
      }),
      this.prisma.group.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async listMembers(groupId: string): Promise<GroupMemberWithUser[]> {
    return this.prisma.groupMember.findMany({
      where: { groupId },
      include: { user: { select: memberUserSelect } },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async addMember(groupId: string, userId: string, role: GroupMemberRole): Promise<GroupMember> {
    try {
      return await this.prisma.groupMember.create({
        data: { groupId, userId, role },
      });
    } catch (error) {
      handlePrismaError(error, 'GroupMember');
    }
  }

  async removeMember(groupId: string, userId: string): Promise<GroupMember> {
    try {
      return await this.prisma.groupMember.delete({
        where: { groupId_userId: { groupId, userId } },
      });
    } catch (error) {
      handlePrismaError(error, 'GroupMember');
    }
  }

  async updateMemberRole(
    groupId: string,
    userId: string,
    role: GroupMemberRole,
  ): Promise<GroupMember> {
    try {
      return await this.prisma.groupMember.update({
        where: { groupId_userId: { groupId, userId } },
        data: { role },
      });
    } catch (error) {
      handlePrismaError(error, 'GroupMember');
    }
  }

  async listMembershipsForUser(userId: string) {
    return this.prisma.groupMember.findMany({
      // Hide memberships whose group has been soft-deleted. The membership
      // row itself stays so audit history can still resolve the join.
      where: { userId, group: { deletedAt: null } },
      include: {
        group: {
          include: { _count: { select: { members: true } } },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async isOwner(groupId: string, userId: string): Promise<boolean> {
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    return membership?.role === 'OWNER';
  }
}
