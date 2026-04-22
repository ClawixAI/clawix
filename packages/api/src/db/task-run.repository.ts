import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@clawix/shared';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import { type TaskRun, Prisma } from '../generated/prisma/client.js';
import type { TaskStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginatedResponse, buildPaginationArgs, handlePrismaError } from './utils.js';

interface CreateTaskRunData {
  readonly taskId: string;
  readonly status?: TaskStatus;
  readonly output?: string;
  readonly error?: string;
  readonly tokenUsage?: Prisma.InputJsonValue;
}

interface UpdateTaskRunData {
  readonly status?: TaskStatus;
  readonly output?: string;
  readonly error?: string;
  readonly tokenUsage?: Prisma.InputJsonValue;
  readonly completedAt?: Date;
  readonly durationMs?: number;
}

@Injectable()
export class TaskRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<TaskRun> {
    const result = await this.prisma.taskRun.findUnique({ where: { id } });

    if (!result) {
      throw new NotFoundError('TaskRun', id);
    }

    return result;
  }

  async findAll(pagination: PaginationInput): Promise<PaginatedResponse<TaskRun>> {
    const { skip, take } = buildPaginationArgs(pagination);

    const [data, total] = await Promise.all([
      this.prisma.taskRun.findMany({
        skip,
        take,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.taskRun.count(),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findByTaskId(
    taskId: string,
    pagination: PaginationInput,
  ): Promise<PaginatedResponse<TaskRun>> {
    const { skip, take } = buildPaginationArgs(pagination);
    const where = { taskId };

    const [data, total] = await Promise.all([
      this.prisma.taskRun.findMany({
        where,
        skip,
        take,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.taskRun.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findLatestByTaskId(taskId: string): Promise<TaskRun | null> {
    return this.prisma.taskRun.findFirst({
      where: { taskId },
      orderBy: { startedAt: 'desc' },
    });
  }

  async create(data: CreateTaskRunData): Promise<TaskRun> {
    try {
      return await this.prisma.taskRun.create({
        data: {
          taskId: data.taskId,
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.output !== undefined ? { output: data.output } : {}),
          ...(data.error !== undefined ? { error: data.error } : {}),
          ...(data.tokenUsage !== undefined ? { tokenUsage: data.tokenUsage } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'TaskRun');
    }
  }

  async update(id: string, data: UpdateTaskRunData): Promise<TaskRun> {
    try {
      return await this.prisma.taskRun.update({
        where: { id },
        data: {
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.output !== undefined ? { output: data.output } : {}),
          ...(data.error !== undefined ? { error: data.error } : {}),
          ...(data.tokenUsage !== undefined ? { tokenUsage: data.tokenUsage } : {}),
          ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
          ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'TaskRun');
    }
  }

  /**
   * Mark TaskRuns stuck in 'running' status (older than staleThresholdMs) as failed.
   * Used on startup to recover from orphaned runs caused by process crashes.
   * Returns the number of rows updated.
   */
  async markOrphanedRuns(staleThresholdMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleThresholdMs);
    const now = new Date();

    const result = await this.prisma.taskRun.updateMany({
      where: {
        status: 'running',
        startedAt: { lt: cutoff },
      },
      data: {
        status: 'failed',
        error: 'orphaned_by_restart',
        completedAt: now,
      },
    });

    return result.count;
  }

  async findByTaskIdWithLimit(
    taskId: string,
    limit: number,
    status?: TaskStatus,
  ): Promise<TaskRun[]> {
    return this.prisma.taskRun.findMany({
      where: { taskId, ...(status ? { status } : {}) },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  async delete(id: string): Promise<TaskRun> {
    try {
      return await this.prisma.taskRun.delete({ where: { id } });
    } catch (error: unknown) {
      handlePrismaError(error, 'TaskRun');
    }
  }
}
