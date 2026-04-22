import { beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { TaskRunMessageRepository } from '../task-run-message.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';

describe('TaskRunMessageRepository', () => {
  let prisma: MockPrismaService;
  let repo: TaskRunMessageRepository;

  beforeEach(() => {
    prisma = createMockPrismaService();
    repo = new TaskRunMessageRepository(prisma as unknown as PrismaService);
  });

  it('appendMany assigns monotonic ordering starting from currentCount', async () => {
    prisma.taskRunMessage.count.mockResolvedValue(2);
    prisma.taskRunMessage.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: `id-${data['ordering']}`, ...data }),
    );

    const ids = await repo.appendMany('tr-1', [
      { role: 'assistant', content: 'hi' },
      { role: 'tool', content: 'ok', toolCallId: 'tc-1' },
    ]);

    expect(ids).toEqual(['id-2', 'id-3']);
    expect(prisma.taskRunMessage.create).toHaveBeenCalledTimes(2);
    expect(prisma.taskRunMessage.create.mock.calls[0]![0].data.ordering).toBe(2);
    expect(prisma.taskRunMessage.create.mock.calls[1]![0].data.ordering).toBe(3);
  });

  it('findByTaskRunId returns messages ordered ascending', async () => {
    prisma.taskRunMessage.findMany.mockResolvedValue([
      { id: 'a', role: 'user', content: 'q', ordering: 0 },
      { id: 'b', role: 'assistant', content: 'a', ordering: 1 },
    ]);

    const rows = await repo.findByTaskRunId('tr-1');
    expect(rows).toHaveLength(2);
    expect(prisma.taskRunMessage.findMany).toHaveBeenCalledWith({
      where: { taskRunId: 'tr-1' },
      orderBy: { ordering: 'asc' },
    });
  });

  it('countByTaskRunId returns correct count', async () => {
    prisma.taskRunMessage.count.mockResolvedValue(5);

    const count = await repo.countByTaskRunId('tr-1');

    expect(count).toBe(5);
    expect(prisma.taskRunMessage.count).toHaveBeenCalledWith({
      where: { taskRunId: 'tr-1' },
    });
  });

  it('appendMany spreads toolCalls when provided', async () => {
    prisma.taskRunMessage.count.mockResolvedValue(0);
    prisma.taskRunMessage.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: `id-${data['ordering']}`, ...data }),
    );

    await repo.appendMany('tr-1', [
      { role: 'assistant', content: 'test', toolCalls: [{ name: 'tool1', id: 't1' }] },
    ]);

    expect(prisma.taskRunMessage.create.mock.calls[0]![0].data.toolCalls).toEqual([
      { name: 'tool1', id: 't1' },
    ]);
  });
});
