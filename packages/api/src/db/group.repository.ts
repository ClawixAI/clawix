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
    const group = await this.prisma.group.findUnique({
      where: { id },
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

    const [data, total] = await Promise.all([
      this.prisma.group.findMany({
        ...paginationArgs,
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
      this.prisma.group.count(),
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

  async delete(id: string): Promise<Group> {
    try {
      return await this.prisma.group.delete({
        where: { id },
      });
    } catch (error) {
      handlePrismaError(error, 'Group');
    }
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
}
