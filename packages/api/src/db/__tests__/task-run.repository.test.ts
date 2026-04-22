import { describe, it, expect, beforeEach } from 'vitest';

import type { PrismaService } from '../../prisma/prisma.service.js';
import { TaskRunRepository } from '../task-run.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';

describe('TaskRunRepository', () => {
  let repository: TaskRunRepository;
  let mockPrisma: MockPrismaService;

  const mockTaskRun = {
    id: 'tr-1',
    taskId: 'task-1',
    status: 'completed',
    output: 'done',
    error: null,
    tokenUsage: { inputTokens: 100, outputTokens: 50 },
    startedAt: new Date('2026-01-01'),
    completedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repository = new TaskRunRepository(mockPrisma as unknown as PrismaService);
  });

  describe('findById', () => {
    it('should return task run when found', async () => {
      mockPrisma.taskRun.findUnique.mockResolvedValue(mockTaskRun);

      const result = await repository.findById('tr-1');

      expect(result).toEqual(mockTaskRun);
      expect(mockPrisma.taskRun.findUnique).toHaveBeenCalledWith({
        where: { id: 'tr-1' },
      });
    });

    it('should throw NotFoundError when not found', async () => {
      mockPrisma.taskRun.findUnique.mockResolvedValue(null);

      await expect(repository.findById('missing')).rejects.toThrow('TaskRun');
    });
  });

  describe('findAll', () => {
    it('should return paginated task runs', async () => {
      mockPrisma.taskRun.findMany.mockResolvedValue([mockTaskRun]);
      mockPrisma.taskRun.count.mockResolvedValue(1);

      const result = await repository.findAll({ page: 1, limit: 10 });

      expect(result.data).toEqual([mockTaskRun]);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(mockPrisma.taskRun.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        orderBy: { startedAt: 'desc' },
      });
    });
  });

  describe('findByTaskId', () => {
    it('should return paginated task runs for a task', async () => {
      mockPrisma.taskRun.findMany.mockResolvedValue([mockTaskRun]);
      mockPrisma.taskRun.count.mockResolvedValue(1);

      const result = await repository.findByTaskId('task-1', {
        page: 1,
        limit: 10,
      });

      expect(result.data).toEqual([mockTaskRun]);
      expect(mockPrisma.taskRun.findMany).toHaveBeenCalledWith({
        where: { taskId: 'task-1' },
        skip: 0,
        take: 10,
        orderBy: { startedAt: 'desc' },
      });
      expect(mockPrisma.taskRun.count).toHaveBeenCalledWith({
        where: { taskId: 'task-1' },
      });
    });

    it('should handle pagination offset', async () => {
      mockPrisma.taskRun.findMany.mockResolvedValue([]);
      mockPrisma.taskRun.count.mockResolvedValue(15);

      const result = await repository.findByTaskId('task-1', {
        page: 2,
        limit: 10,
      });

      expect(result.meta.totalPages).toBe(2);
      expect(mockPrisma.taskRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });

  describe('findLatestByTaskId', () => {
    it('should return the latest task run', async () => {
      mockPrisma.taskRun.findFirst.mockResolvedValue(mockTaskRun);

      const result = await repository.findLatestByTaskId('task-1');

      expect(result).toEqual(mockTaskRun);
      expect(mockPrisma.taskRun.findFirst).toHaveBeenCalledWith({
        where: { taskId: 'task-1' },
        orderBy: { startedAt: 'desc' },
      });
    });

    it('should return null when no runs exist', async () => {
      mockPrisma.taskRun.findFirst.mockResolvedValue(null);

      const result = await repository.findLatestByTaskId('task-1');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a task run with required fields', async () => {
      const input = { taskId: 'task-1' };
      mockPrisma.taskRun.create.mockResolvedValue({
        ...mockTaskRun,
        output: null,
        error: null,
      });

      const result = await repository.create(input);

      expect(result).toBeDefined();
      expect(mockPrisma.taskRun.create).toHaveBeenCalledWith({
        data: { taskId: 'task-1' },
      });
    });

    it('should create a task run with all optional fields', async () => {
      const input = {
        taskId: 'task-1',
        status: 'running' as const,
        output: 'partial',
        error: 'warning',
        tokenUsage: { inputTokens: 50 },
      };
      mockPrisma.taskRun.create.mockResolvedValue(mockTaskRun);

      await repository.create(input);

      expect(mockPrisma.taskRun.create).toHaveBeenCalledWith({
        data: {
          taskId: 'task-1',
          status: 'running',
          output: 'partial',
          error: 'warning',
          tokenUsage: { inputTokens: 50 },
        },
      });
    });

    it('should call handlePrismaError on failure', async () => {
      const prismaError = { code: 'P2002', meta: { target: ['taskId'] } };
      mockPrisma.taskRun.create.mockRejectedValue(prismaError);

      await expect(repository.create({ taskId: 'task-1' })).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('should update a task run', async () => {
      const updated = { ...mockTaskRun, status: 'failed', error: 'timeout' };
      mockPrisma.taskRun.update.mockResolvedValue(updated);

      const result = await repository.update('tr-1', {
        status: 'failed',
        error: 'timeout',
      });

      expect(result).toEqual(updated);
      expect(mockPrisma.taskRun.update).toHaveBeenCalledWith({
        where: { id: 'tr-1' },
        data: { status: 'failed', error: 'timeout' },
      });
    });

    it('should call handlePrismaError on failure', async () => {
      const prismaError = { code: 'P2025' };
      mockPrisma.taskRun.update.mockRejectedValue(prismaError);

      await expect(repository.update('missing', { status: 'failed' })).rejects.toThrow();
    });
  });

  describe('markOrphanedRuns', () => {
    it('should update stale running TaskRuns to failed with orphaned_by_restart error', async () => {
      mockPrisma.taskRun.updateMany.mockResolvedValue({ count: 3 });

      const staleThresholdMs = 900_000; // 15 minutes
      const result = await repository.markOrphanedRuns(staleThresholdMs);

      expect(result).toBe(3);
      expect(mockPrisma.taskRun.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'running',
          startedAt: { lt: expect.any(Date) },
        },
        data: {
          status: 'failed',
          error: 'orphaned_by_restart',
          completedAt: expect.any(Date),
        },
      });
    });

    it('should compute the cutoff date correctly from staleThresholdMs', async () => {
      mockPrisma.taskRun.updateMany.mockResolvedValue({ count: 0 });

      const before = Date.now();
      await repository.markOrphanedRuns(600_000); // 10 minutes
      const after = Date.now();

      const call = mockPrisma.taskRun.updateMany.mock.calls[0]![0];
      const cutoff = (call.where.startedAt as { lt: Date }).lt.getTime();

      // Cutoff should be ~10 minutes before now
      expect(cutoff).toBeGreaterThanOrEqual(before - 600_000);
      expect(cutoff).toBeLessThanOrEqual(after - 600_000);
    });

    it('should return 0 when no orphaned runs exist', async () => {
      mockPrisma.taskRun.updateMany.mockResolvedValue({ count: 0 });

      const result = await repository.markOrphanedRuns(900_000);

      expect(result).toBe(0);
    });
  });

  describe('findByTaskIdWithLimit', () => {
    it('findByTaskIdWithLimit passes through filters and ordering', async () => {
      mockPrisma.taskRun.findMany.mockResolvedValue([
        { id: 'r1', taskId: 't1', status: 'completed', startedAt: new Date('2026-01-02') },
        { id: 'r2', taskId: 't1', status: 'completed', startedAt: new Date('2026-01-01') },
      ]);
      const rows = await repository.findByTaskIdWithLimit('t1', 5, 'completed');
      expect(rows).toHaveLength(2);
      expect(mockPrisma.taskRun.findMany).toHaveBeenCalledWith({
        where: { taskId: 't1', status: 'completed' },
        orderBy: { startedAt: 'desc' },
        take: 5,
      });
    });

    it('omits status filter when status is undefined', async () => {
      mockPrisma.taskRun.findMany.mockResolvedValue([]);
      await repository.findByTaskIdWithLimit('t1', 10, undefined);
      expect(mockPrisma.taskRun.findMany).toHaveBeenCalledWith({
        where: { taskId: 't1' },
        orderBy: { startedAt: 'desc' },
        take: 10,
      });
    });
  });

  describe('delete', () => {
    it('should delete a task run', async () => {
      mockPrisma.taskRun.delete.mockResolvedValue(mockTaskRun);

      const result = await repository.delete('tr-1');

      expect(result).toEqual(mockTaskRun);
      expect(mockPrisma.taskRun.delete).toHaveBeenCalledWith({
        where: { id: 'tr-1' },
      });
    });

    it('should call handlePrismaError on failure', async () => {
      const prismaError = { code: 'P2025' };
      mockPrisma.taskRun.delete.mockRejectedValue(prismaError);

      await expect(repository.delete('missing')).rejects.toThrow();
    });
  });
});
