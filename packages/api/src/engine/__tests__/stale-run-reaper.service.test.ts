import { describe, it, expect, vi, beforeEach } from 'vitest';

import { StaleRunReaperService } from '../stale-run-reaper.service.js';
import type { AgentRunRegistry } from '../agent-run-registry.service.js';

const mockPrisma = {
  agentRun: {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
};

const mockRegistry = {
  abort: vi.fn().mockReturnValue(true),
};

describe('StaleRunReaperService', () => {
  let reaper: StaleRunReaperService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.agentRun.findMany.mockResolvedValue([]);
    reaper = new StaleRunReaperService(
      mockPrisma as any,
      mockRegistry as unknown as AgentRunRegistry,
    );
  });

  it('marks runs older than threshold as failed', async () => {
    mockPrisma.agentRun.findMany.mockResolvedValue([{ id: 'run-1' }, { id: 'run-2' }]);
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

  it('aborts the in-process controller for each stale run before flipping the DB', async () => {
    mockPrisma.agentRun.findMany.mockResolvedValue([{ id: 'run-1' }, { id: 'run-2' }]);
    mockPrisma.agentRun.updateMany.mockResolvedValue({ count: 2 });

    await reaper.reapStaleRuns();

    expect(mockRegistry.abort).toHaveBeenCalledTimes(2);
    expect(mockRegistry.abort).toHaveBeenCalledWith('run-1', 'stale_timeout');
    expect(mockRegistry.abort).toHaveBeenCalledWith('run-2', 'stale_timeout');
  });

  it('returns 0 and does not abort or update when no stale runs exist', async () => {
    mockPrisma.agentRun.findMany.mockResolvedValue([]);

    const result = await reaper.reapStaleRuns();

    expect(result).toBe(0);
    expect(mockRegistry.abort).not.toHaveBeenCalled();
    expect(mockPrisma.agentRun.updateMany).not.toHaveBeenCalled();
  });

  it('only selects running runs, so a watchdog-failed run is never re-reaped', async () => {
    await reaper.reapStaleRuns();

    // The 'running' guard on the SELECT is what prevents the reaper from
    // touching a run the executor watchdog already flipped to 'failed'.
    expect(mockPrisma.agentRun.findMany).toHaveBeenCalledWith({
      where: { status: 'running', startedAt: { lt: expect.any(Date) } },
      select: { id: true },
    });
  });

  it('handles the watchdog winning the race (updateMany matches 0 rows)', async () => {
    // Reaper selected a still-'running' row, but between findMany and updateMany
    // the executor watchdog already flipped it to 'failed' and unregistered its
    // controller. The reaper's result comes solely from updateMany's count (0
    // here, since the 'running' guard no longer matches); abort() is called
    // unconditionally and its return value is ignored, so false is harmless.
    mockPrisma.agentRun.findMany.mockResolvedValue([{ id: 'run-raced' }]);
    mockPrisma.agentRun.updateMany.mockResolvedValue({ count: 0 });
    mockRegistry.abort.mockReturnValue(false);

    const result = await reaper.reapStaleRuns();

    expect(result).toBe(0);
    // Best-effort abort still attempted (return value unused by the reaper).
    expect(mockRegistry.abort).toHaveBeenCalledWith('run-raced', 'stale_timeout');
  });
});
