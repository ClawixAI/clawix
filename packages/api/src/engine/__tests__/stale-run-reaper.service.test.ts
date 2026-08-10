import { describe, it, expect, vi, beforeEach } from 'vitest';

import { StaleRunReaperService } from '../stale-run-reaper.service.js';
import type { AgentRunRegistry } from '../agent-run-registry.service.js';
import type { SubAgentResultPublisher } from '../sub-agent-result.publisher.js';

const mockPrisma = {
  agentRun: {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
};

const mockRegistry = {
  abort: vi.fn().mockReturnValue(true),
};

const mockPublisher = {
  publishFailure: vi.fn().mockResolvedValue(undefined),
};

describe('StaleRunReaperService', () => {
  let reaper: StaleRunReaperService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.agentRun.findMany.mockResolvedValue([]);
    mockPrisma.agentRun.updateMany.mockResolvedValue({ count: 1 });
    mockRegistry.abort.mockReturnValue(true);
    reaper = new StaleRunReaperService(
      mockPrisma as any,
      mockRegistry as unknown as AgentRunRegistry,
      mockPublisher as unknown as SubAgentResultPublisher,
    );
  });

  it('marks runs older than threshold as failed (per-row guarded update)', async () => {
    mockPrisma.agentRun.findMany.mockResolvedValue([
      { id: 'run-1', parentAgentRunId: null },
      { id: 'run-2', parentAgentRunId: null },
    ]);

    const result = await reaper.reapStaleRuns();

    expect(result).toBe(2);
    expect(mockPrisma.agentRun.updateMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.agentRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'running' },
      data: {
        status: 'failed',
        error: 'Agent run timed out (stale run reaper)',
        completedAt: expect.any(Date),
      },
    });
  });

  it('aborts the in-process controller for each stale run before flipping the DB', async () => {
    mockPrisma.agentRun.findMany.mockResolvedValue([
      { id: 'run-1', parentAgentRunId: null },
      { id: 'run-2', parentAgentRunId: null },
    ]);

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

    expect(mockPrisma.agentRun.findMany).toHaveBeenCalledWith({
      where: { status: 'running', startedAt: { lt: expect.any(Date) } },
      select: { id: true, parentAgentRunId: true },
    });
  });

  it('handles the watchdog winning the race (guarded update matches 0 rows)', async () => {
    mockPrisma.agentRun.findMany.mockResolvedValue([
      { id: 'run-raced', parentAgentRunId: 'run-parent' },
    ]);
    mockPrisma.agentRun.updateMany.mockResolvedValue({ count: 0 });
    mockRegistry.abort.mockReturnValue(false);

    const result = await reaper.reapStaleRuns();

    expect(result).toBe(0);
    expect(mockRegistry.abort).toHaveBeenCalledWith('run-raced', 'stale_timeout');
    // The watchdog path already notified the parent — no duplicate publish.
    expect(mockPublisher.publishFailure).not.toHaveBeenCalled();
  });

  it('D13: publishes a failure to the parent for reaped orphaned children', async () => {
    mockPrisma.agentRun.findMany.mockResolvedValue([
      { id: 'run-orphan', parentAgentRunId: 'run-parent' },
    ]);
    // No in-process controller — an orphan the executor can never report on.
    mockRegistry.abort.mockReturnValue(false);

    const result = await reaper.reapStaleRuns();

    expect(result).toBe(1);
    expect(mockPublisher.publishFailure).toHaveBeenCalledTimes(1);
    expect(mockPublisher.publishFailure).toHaveBeenCalledWith('run-orphan', expect.any(Error));
    const err = mockPublisher.publishFailure.mock.calls[0]![1] as Error;
    expect(err.message).toBe('Agent run timed out (stale run reaper)');
  });

  it('D13: does not publish when the aborted run still had an in-process controller', async () => {
    mockPrisma.agentRun.findMany.mockResolvedValue([
      { id: 'run-live', parentAgentRunId: 'run-parent' },
    ]);
    // Controller found: the executor catch/watchdog path will publish.
    mockRegistry.abort.mockReturnValue(true);

    await reaper.reapStaleRuns();

    expect(mockPublisher.publishFailure).not.toHaveBeenCalled();
  });

  it('D13: does not publish for reaped primary runs (no parentAgentRunId)', async () => {
    mockPrisma.agentRun.findMany.mockResolvedValue([{ id: 'run-primary', parentAgentRunId: null }]);
    mockRegistry.abort.mockReturnValue(false);

    await reaper.reapStaleRuns();

    expect(mockPublisher.publishFailure).not.toHaveBeenCalled();
  });
});
