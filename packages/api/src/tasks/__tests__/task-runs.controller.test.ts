import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TaskRunsController } from '../task-runs.controller.js';

describe('TaskRunsController', () => {
  let taskRepo: { findById: ReturnType<typeof vi.fn> };
  let taskRunRepo: {
    findByTaskIdWithLimit: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let msgRepo: { findByTaskRunId: ReturnType<typeof vi.fn> };
  let controller: TaskRunsController;

  beforeEach(() => {
    taskRepo = { findById: vi.fn() };
    taskRunRepo = { findByTaskIdWithLimit: vi.fn(), findById: vi.fn() };
    msgRepo = { findByTaskRunId: vi.fn() };
    controller = new TaskRunsController(taskRepo as never, taskRunRepo as never, msgRepo as never);
  });

  it('GET runs — returns owned task runs', async () => {
    taskRepo.findById.mockResolvedValue({ id: 't1', createdByUserId: 'u1' });
    taskRunRepo.findByTaskIdWithLimit.mockResolvedValue([{ id: 'r1' }]);
    const res = await controller.listRuns('t1', {} as never, { user: { sub: 'u1' } } as never);
    expect(res.success).toBe(true);
    expect((res.data as { runs: unknown[] }).runs).toHaveLength(1);
  });

  it('GET runs — rejects foreign task', async () => {
    taskRepo.findById.mockResolvedValue({ id: 't1', createdByUserId: 'someone-else' });
    await expect(
      controller.listRuns('t1', {} as never, { user: { sub: 'u1' } } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it('GET messages — returns transcript for owned run', async () => {
    taskRepo.findById.mockResolvedValue({ id: 't1', createdByUserId: 'u1' });
    taskRunRepo.findById.mockResolvedValue({ id: 'r1', taskId: 't1' });
    msgRepo.findByTaskRunId.mockResolvedValue([{ role: 'user', content: 'q' }]);
    const res = await controller.runMessages('t1', 'r1', { user: { sub: 'u1' } } as never);
    expect(res.success).toBe(true);
  });

  it('GET messages — rejects run that does not belong to the task', async () => {
    taskRepo.findById.mockResolvedValue({ id: 't1', createdByUserId: 'u1' });
    taskRunRepo.findById.mockResolvedValue({ id: 'r1', taskId: 'other-task' });
    await expect(
      controller.runMessages('t1', 'r1', { user: { sub: 'u1' } } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it('GET messages — rejects foreign task', async () => {
    taskRepo.findById.mockResolvedValue({ id: 't1', createdByUserId: 'other' });
    await expect(
      controller.runMessages('t1', 'r1', { user: { sub: 'u1' } } as never),
    ).rejects.toThrow(NotFoundException);
  });
});
