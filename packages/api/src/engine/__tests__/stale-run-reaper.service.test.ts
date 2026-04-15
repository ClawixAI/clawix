import { describe, it, expect, vi, beforeEach } from 'vitest';

import { StaleRunReaperService } from '../stale-run-reaper.service.js';

const mockPrisma = {
  agentRun: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
};

describe('StaleRunReaperService', () => {
  let reaper: StaleRunReaperService;

  beforeEach(() => {
    vi.clearAllMocks();
    reaper = new StaleRunReaperService(mockPrisma as any);
  });

  it('marks runs older than threshold as failed', async () => {
    mockPrisma.agentRun.updateMany.mockResolvedValue({ count: 2 });

    const result = await reaper.reapStaleRuns();

    expect(result).toBe(2);
    expect(mockPrisma.agentRun.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'running',
        startedAt: { lt: expect.any(Date) },
      },
      data: {
        status: 'failed',
        error: 'Agent run timed out (stale run reaper)',
        completedAt: expect.any(Date),
      },
    });
  });

  it('returns 0 when no stale runs exist', async () => {
    mockPrisma.agentRun.updateMany.mockResolvedValue({ count: 0 });
    const result = await reaper.reapStaleRuns();
    expect(result).toBe(0);
  });
});
