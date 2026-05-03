import { Injectable } from '@nestjs/common';

import { NotFoundError } from '@clawix/shared';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import { type Channel, Prisma } from '../generated/prisma/client.js';
import type { ChannelType } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginatedResponse, buildPaginationArgs, handlePrismaError } from './utils.js';

@Injectable()
export class ChannelRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Channel> {
    const channel = await this.prisma.channel.findUnique({
      where: { id },
    });

    if (!channel) {
      throw new NotFoundError('Channel', id);
    }

    return channel;
  }

  async findAll(pagination: PaginationInput): Promise<PaginatedResponse<Channel>> {
    const paginationArgs = buildPaginationArgs(pagination);

    const [data, total] = await Promise.all([
      this.prisma.channel.findMany({
        ...paginationArgs,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.channel.count(),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findActive(): Promise<readonly Channel[]> {
    return this.prisma.channel.findMany({
      where: { isActive: true },
    });
  }

  async findByType(type: ChannelType): Promise<readonly Channel[]> {
    return this.prisma.channel.findMany({
      where: { type },
    });
  }

  async create(data: {
    readonly type: ChannelType;
    readonly name: string;
    readonly config?: Prisma.InputJsonValue;
  }): Promise<Channel> {
    try {
      return await this.prisma.channel.create({
        data: {
          type: data.type,
          name: data.name,
          config: data.config ?? {},
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Channel');
    }
  }

  async update(
    id: string,
    data: {
      readonly name?: string;
      readonly config?: Prisma.InputJsonValue;
      readonly isActive?: boolean;
      readonly toolProgressMode?: string | null;
    },
  ): Promise<Channel> {
    try {
      return await this.prisma.channel.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.config !== undefined ? { config: data.config } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.toolProgressMode !== undefined
            ? { toolProgressMode: data.toolProgressMode }
            : {}),
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Channel');
    }
  }

  async delete(id: string): Promise<Channel> {
    try {
      return await this.prisma.channel.delete({
        where: { id },
      });
    } catch (error) {
      handlePrismaError(error, 'Channel');
    }
  }
}
