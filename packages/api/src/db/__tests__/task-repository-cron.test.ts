import { describe, it, expect, beforeEach } from 'vitest';

import { NotFoundError } from '@clawix/shared';

import type { PrismaService } from '../../prisma/prisma.service.js';
import { TaskRepository } from '../task.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';

describe('TaskRepository — cron methods', () => {
  let repository: TaskRepository;
  let mockPrisma: MockPrismaService;

  const mockTask = {
    id: 'task-1',
    agentDefinitionId: 'agent-1',
    name: 'Daily Report',
    schedule: { type: 'cron', expression: '0 9 * * *' },
    prompt: 'Generate daily report',
    channelId: null,
    enabled: true,
    lastRunAt: null,
    lastStatus: null,
    nextRunAt: null,
    consecutiveFailures: 0,
    disabledReason: null,
    createdByUserId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repository = new TaskRepository(mockPrisma as unknown as PrismaService);
  });

  describe('findDue', () => {
    it('should query enabled, due, non-running tasks ordered asc, limited', async () => {
      const now = new Date('2026-03-28T10:00:00Z');
      mockPrisma.task.findMany.mockResolvedValue([mockTask]);

      const result = await repository.findDue(now, 5);

      expect(result).toEqual([mockTask]);
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith({
        where: {
          enabled: true,
          nextRunAt: { lte: now },
          taskRuns: { none: { status: 'running' } },
        },
        orderBy: { nextRunAt: 'asc' },
        take: 5,
      });
    });

    it('should return an empty array when no tasks are due', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      const result = await repository.findDue(new Date(), 10);

      expect(result).toEqual([]);
    });

    it('excludes tasks that already have an in-flight TaskRun (regression: duplicate dispatch)', async () => {
      // Smoke test that the running-runs filter is part of the query.
      // The DB-level enforcement is covered by integration tests.
      await repository.findDue(new Date(), 5);

      const callArgs = mockPrisma.task.findMany.mock.calls[0]![0] as {
        where: { taskRuns?: { none?: { status?: string } } };
      };
      expect(callArgs.where.taskRuns).toEqual({ none: { status: 'running' } });
    });
  });

  describe('findActiveCountByUser', () => {
    it('should count enabled tasks for the given user', async () => {
      mockPrisma.task.count.mockResolvedValue(3);

      const result = await repository.findActiveCountByUser('user-1');

      expect(result).toBe(3);
      expect(mockPrisma.task.count).toHaveBeenCalledWith({
        where: { createdByUserId: 'user-1', enabled: true },
      });
    });

    it('should return 0 when the user has no active tasks', async () => {
      mockPrisma.task.count.mockResolvedValue(0);

      const result = await repository.findActiveCountByUser('user-2');

      expect(result).toBe(0);
    });
  });

  describe('findRunningCountByUser', () => {
    it('should count tasks with running TaskRuns for the given user', async () => {
      mockPrisma.task.count.mockResolvedValue(2);

      const result = await repository.findRunningCountByUser('user-1');

      expect(result).toBe(2);
      expect(mockPrisma.task.count).toHaveBeenCalledWith({
        where: {
          createdByUserId: 'user-1',
          taskRuns: { some: { status: 'running' } },
        },
      });
    });

    it('should return 0 when no tasks are running for the user', async () => {
      mockPrisma.task.count.mockResolvedValue(0);

      const result = await repository.findRunningCountByUser('user-1');

      expect(result).toBe(0);
    });
  });

  describe('incrementFailures', () => {
    it('should increment consecutiveFailures by 1', async () => {
      const updated = { ...mockTask, consecutiveFailures: 1 };
      mockPrisma.task.update.mockResolvedValue(updated);

      const result = await repository.incrementFailures('task-1');

      expect(result).toEqual(updated);
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { consecutiveFailures: { increment: 1 } },
      });
    });

    it('should throw NotFoundError when the task does not exist', async () => {
      mockPrisma.task.update.mockRejectedValue({ code: 'P2025' });

      await expect(repository.incrementFailures('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('resetFailures', () => {
    it('should reset consecutiveFailures to 0 and clear disabledReason', async () => {
      const updated = { ...mockTask, consecutiveFailures: 0, disabledReason: null };
      mockPrisma.task.update.mockResolvedValue(updated);

      const result = await repository.resetFailures('task-1');

      expect(result).toEqual(updated);
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { consecutiveFailures: 0, disabledReason: null },
      });
    });

    it('should throw NotFoundError when the task does not exist', async () => {
      mockPrisma.task.update.mockRejectedValue({ code: 'P2025' });

      await expect(repository.resetFailures('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('autoDisable', () => {
    it('should set enabled=false and record the disabledReason', async () => {
      const reason = 'Too many failures';
      const updated = { ...mockTask, enabled: false, disabledReason: reason };
      mockPrisma.task.update.mockResolvedValue(updated);

      const result = await repository.autoDisable('task-1', reason);

      expect(result).toEqual(updated);
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { enabled: false, disabledReason: reason },
      });
    });

    it('should throw NotFoundError when the task does not exist', async () => {
      mockPrisma.task.update.mockRejectedValue({ code: 'P2025' });

      await expect(repository.autoDisable('missing', 'reason')).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateNextRunAt', () => {
    it('should update nextRunAt to the given date', async () => {
      const nextRun = new Date('2026-03-29T09:00:00Z');
      const updated = { ...mockTask, nextRunAt: nextRun };
      mockPrisma.task.update.mockResolvedValue(updated);

      const result = await repository.updateNextRunAt('task-1', nextRun);

      expect(result).toEqual(updated);
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { nextRunAt: nextRun },
      });
    });

    it('should update nextRunAt to null', async () => {
      const updated = { ...mockTask, nextRunAt: null };
      mockPrisma.task.update.mockResolvedValue(updated);

      const result = await repository.updateNextRunAt('task-1', null);

      expect(result).toEqual(updated);
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { nextRunAt: null },
      });
    });

    it('should throw NotFoundError when the task does not exist', async () => {
      mockPrisma.task.update.mockRejectedValue({ code: 'P2025' });

      await expect(repository.updateNextRunAt('missing', new Date())).rejects.toThrow(
        NotFoundError,
      );
    });
  });
});
