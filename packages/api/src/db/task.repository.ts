import { Injectable } from '@nestjs/common';

import { NotFoundError } from '@clawix/shared';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import { type Task, Prisma } from '../generated/prisma/client.js';
import type { TaskStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginatedResponse, buildPaginationArgs, handlePrismaError } from './utils.js';

@Injectable()
export class TaskRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({
      where: { id },
    });

    if (!task) {
      throw new NotFoundError('Task', id);
    }

    return task;
  }

  async findAll(pagination: PaginationInput): Promise<PaginatedResponse<Task>> {
    const paginationArgs = buildPaginationArgs(pagination);

    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        ...paginationArgs,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.task.count(),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findEnabled(): Promise<readonly Task[]> {
    return this.prisma.task.findMany({
      where: { enabled: true },
    });
  }

  async create(data: {
    readonly agentDefinitionId: string;
    readonly name: string;
    readonly schedule: Prisma.InputJsonValue;
    readonly prompt: string;
    readonly channelId?: string | null;
    readonly enabled?: boolean;
    readonly createdByUserId?: string;
  }): Promise<Task> {
    try {
      return await this.prisma.task.create({
        data: {
          agentDefinitionId: data.agentDefinitionId,
          name: data.name,
          schedule: data.schedule,
          prompt: data.prompt,
          channelId: data.channelId ?? null,
          enabled: data.enabled ?? true,
          createdByUserId: data.createdByUserId ?? undefined,
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Task');
    }
  }

  async update(
    id: string,
    data: {
      readonly name?: string;
      readonly schedule?: Prisma.InputJsonValue;
      readonly prompt?: string;
      readonly channelId?: string | null;
      readonly enabled?: boolean;
    },
  ): Promise<Task> {
    try {
      return await this.prisma.task.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.schedule !== undefined ? { schedule: data.schedule } : {}),
          ...(data.prompt !== undefined ? { prompt: data.prompt } : {}),
          ...(data.channelId !== undefined ? { channelId: data.channelId } : {}),
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Task');
    }
  }

  async updateLastRun(id: string, status: TaskStatus, timestamp: Date): Promise<Task> {
    try {
      return await this.prisma.task.update({
        where: { id },
        data: {
          lastRunAt: timestamp,
          lastStatus: status,
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Task');
    }
  }

  async delete(id: string): Promise<Task> {
    try {
      return await this.prisma.task.delete({
        where: { id },
      });
    } catch (error) {
      handlePrismaError(error, 'Task');
    }
  }

  async findDue(now: Date, limit: number): Promise<readonly Task[]> {
    return this.prisma.task.findMany({
      // A task is "due" only if it has no in-flight TaskRun.
      // Why: nextRunAt is updated only after the run completes/fails (in
      // cron-task-processor), so a long run leaves the task continuously due
      // to the scheduler, causing the same task to be re-dispatched every
      // poll interval (~30 s) and stacking up duplicate TaskRun rows.
      where: {
        enabled: true,
        nextRunAt: { lte: now },
        taskRuns: { none: { status: 'running' } },
      },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
  }

  async findByUser(userId: string): Promise<readonly Task[]> {
    return this.prisma.task.findMany({
      where: { createdByUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveCountByUser(userId: string): Promise<number> {
    return this.prisma.task.count({
      where: { createdByUserId: userId, enabled: true },
    });
  }

  async findRunningCountByUser(userId: string): Promise<number> {
    return this.prisma.task.count({
      where: {
        createdByUserId: userId,
        taskRuns: { some: { status: 'running' } },
      },
    });
  }

  async incrementFailures(id: string): Promise<Task> {
    try {
      return await this.prisma.task.update({
        where: { id },
        data: { consecutiveFailures: { increment: 1 } },
      });
    } catch (error) {
      handlePrismaError(error, 'Task');
    }
  }

  async resetFailures(id: string): Promise<Task> {
    try {
      return await this.prisma.task.update({
        where: { id },
        data: { consecutiveFailures: 0, disabledReason: null },
      });
    } catch (error) {
      handlePrismaError(error, 'Task');
    }
  }

  async autoDisable(id: string, reason: string): Promise<Task> {
    try {
      return await this.prisma.task.update({
        where: { id },
        data: { enabled: false, disabledReason: reason },
      });
    } catch (error) {
      handlePrismaError(error, 'Task');
    }
  }

  async updateNextRunAt(id: string, nextRunAt: Date | null): Promise<Task> {
    try {
      return await this.prisma.task.update({
        where: { id },
        data: { nextRunAt },
      });
    } catch (error) {
      handlePrismaError(error, 'Task');
    }
  }
}
