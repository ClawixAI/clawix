import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AgentRunRegistry } from '../agent-run-registry.service.js';

describe('AgentRunRegistry', () => {
  const mockPrisma = {
    agentRun: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function create(): AgentRunRegistry {
    return new AgentRunRegistry(mockPrisma as never);
  }

  it('register stores the controller and abort fires its signal', () => {
    const registry = create();
    const controller = new AbortController();
    registry.register('run-1', controller);

    const aborted = registry.abort('run-1', 'user_stop');

    expect(aborted).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe('user_stop');
  });

  it('abort returns false for unknown id', () => {
    const registry = create();
    expect(registry.abort('nope', 'user_stop')).toBe(false);
  });

  it('unregister removes the entry; subsequent abort no-ops', () => {
    const registry = create();
    const controller = new AbortController();
    registry.register('run-1', controller);
    registry.unregister('run-1');

    expect(registry.abort('run-1', 'user_stop')).toBe(false);
    expect(controller.signal.aborted).toBe(false);
  });

  it('abortAllForUser aborts each registered controller and writes cancelled', async () => {
    const registry = create();
    const c1 = new AbortController();
    const c2 = new AbortController();
    registry.register('run-1', c1);
    registry.register('run-2', c2);

    mockPrisma.agentRun.findMany.mockResolvedValue([{ id: 'run-1' }, { id: 'run-2' }]);
    mockPrisma.agentRun.updateMany.mockResolvedValue({ count: 2 });

    const result = await registry.abortAllForUser('user-1');

    expect(result.stopped).toBe(2);
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
    expect(mockPrisma.agentRun.findMany).toHaveBeenCalledWith({
      where: { status: 'running', session: { userId: 'user-1' } },
      select: { id: true },
    });
    expect(mockPrisma.agentRun.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['run-1', 'run-2'] }, status: 'running' },
      data: {
        status: 'cancelled',
        error: 'Stopped by user',
        completedAt: expect.any(Date),
      },
    });
  });

  it('abortAllForUser returns stopped=0 when no runs are active', async () => {
    const registry = create();
    mockPrisma.agentRun.findMany.mockResolvedValue([]);

    const result = await registry.abortAllForUser('user-1');

    expect(result.stopped).toBe(0);
    expect(mockPrisma.agentRun.updateMany).not.toHaveBeenCalled();
  });

  it('abortAllForUser skips in-memory abort for runs not in the registry but still writes cancelled', async () => {
    const registry = create();
    mockPrisma.agentRun.findMany.mockResolvedValue([{ id: 'orphan-run' }]);
    mockPrisma.agentRun.updateMany.mockResolvedValue({ count: 1 });

    const result = await registry.abortAllForUser('user-1');

    expect(result.stopped).toBe(1);
  });
});
