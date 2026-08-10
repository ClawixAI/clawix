import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  createTaskCancelTool,
  createTaskResultTool,
  type TaskLifecycleDeps,
} from '../tools/task-lifecycle-tools.js';
import { createReportProgressTool, PROGRESS_MIN_INTERVAL_MS } from '../tools/progress-tool.js';
import { KEY_PREFIXES, PUBSUB_CHANNELS } from '../../cache/cache.constants.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';
import type { RedisService } from '../../cache/redis.service.js';

describe('task lifecycle tools', () => {
  let mockAgentRunRepo: {
    findById: ReturnType<typeof vi.fn>;
    cancelIfActive: ReturnType<typeof vi.fn>;
  };
  let mockRedis: { lrange: ReturnType<typeof vi.fn>; lrem: ReturnType<typeof vi.fn> };
  let mockRegistry: { abort: ReturnType<typeof vi.fn> };
  let cancelQueued: ReturnType<typeof vi.fn>;
  let deps: TaskLifecycleDeps;

  const runningRun = {
    id: 'run-1',
    sessionId: 'sess-parent',
    status: 'running',
    output: null,
    error: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentRunRepo = {
      findById: vi.fn().mockResolvedValue(runningRun),
      cancelIfActive: vi.fn().mockResolvedValue(true),
    };
    mockRedis = { lrange: vi.fn().mockResolvedValue([]), lrem: vi.fn().mockResolvedValue(1) };
    mockRegistry = { abort: vi.fn().mockReturnValue(true) };
    cancelQueued = vi.fn().mockReturnValue(false);

    deps = {
      agentRunRepo: mockAgentRunRepo as unknown as AgentRunRepository,
      redis: mockRedis as unknown as RedisService,
      taskExecutor: { submit: vi.fn(), cancelQueued },
      agentRunRegistry: mockRegistry,
      parentSessionId: 'sess-parent',
    };
  });

  describe('task_cancel', () => {
    it('removes a queued task without touching the registry', async () => {
      cancelQueued.mockReturnValue(true);
      mockAgentRunRepo.findById.mockResolvedValue({ ...runningRun, status: 'pending' });

      const result = await createTaskCancelTool(deps).execute({ task_id: 'run-1' });

      expect(result.isError).toBe(false);
      expect(result.output).toContain('removed from queue');
      expect(mockRegistry.abort).not.toHaveBeenCalled();
      expect(mockAgentRunRepo.cancelIfActive).toHaveBeenCalledWith('run-1');
    });

    it('aborts a running task via the registry and flips the row guarded', async () => {
      const result = await createTaskCancelTool(deps).execute({ task_id: 'run-1' });

      expect(result.isError).toBe(false);
      expect(result.output).toContain('running work aborted');
      expect(mockRegistry.abort).toHaveBeenCalledWith('run-1', 'parent_cancelled');
      expect(mockAgentRunRepo.cancelIfActive).toHaveBeenCalledWith('run-1');
    });

    it('refuses a task belonging to another session', async () => {
      mockAgentRunRepo.findById.mockResolvedValue({ ...runningRun, sessionId: 'sess-other' });

      const result = await createTaskCancelTool(deps).execute({ task_id: 'run-1' });

      expect(result.isError).toBe(true);
      expect(mockRegistry.abort).not.toHaveBeenCalled();
      expect(mockAgentRunRepo.cancelIfActive).not.toHaveBeenCalled();
    });

    it('leaves an already-settled task untouched', async () => {
      mockAgentRunRepo.findById.mockResolvedValue({ ...runningRun, status: 'completed' });

      const result = await createTaskCancelTool(deps).execute({ task_id: 'run-1' });

      expect(result.isError).toBe(false);
      expect(result.output).toContain('already settled');
      expect(mockAgentRunRepo.cancelIfActive).not.toHaveBeenCalled();
    });
  });

  describe('task_result', () => {
    it('returns a settled result and consumes its queued delivery payload', async () => {
      mockAgentRunRepo.findById.mockResolvedValue({
        ...runningRun,
        status: 'completed',
        output: 'db output',
      });
      const queuedRaw = JSON.stringify({
        agentRunId: 'run-1',
        parentAgentRunId: 'run-parent',
        agentName: 'worker',
        output: 'queued output',
        status: 'completed',
        error: null,
      });
      mockRedis.lrange.mockResolvedValueOnce([queuedRaw]).mockResolvedValue([]);

      const result = await createTaskResultTool(deps).execute({ task_id: 'run-1' });

      expect(result.isError).toBe(false);
      expect(result.output).toContain('queued output'); // payload wins over row
      expect(mockRedis.lrem).toHaveBeenCalledWith(
        `${KEY_PREFIXES.agentResults}sess-parent`,
        1,
        queuedRaw,
      );
    });

    it('tells the model to task_wait for an unsettled task instead of polling', async () => {
      const result = await createTaskResultTool(deps).execute({ task_id: 'run-1' });

      expect(result.isError).toBe(false);
      expect(result.output).toContain('still running');
      expect(result.output).toContain('task_wait');
      expect(mockRedis.lrem).not.toHaveBeenCalled();
    });
  });
});

describe('report_progress', () => {
  it('publishes a transient progress frame to the parent session channel', async () => {
    const publish = vi.fn().mockResolvedValue(1);
    const tool = createReportProgressTool({
      pubsub: { publish },
      sessionId: 'sess-parent',
      agentName: 'researcher',
    });

    const result = await tool.execute({ text: 'processed 3 of 5 files' });

    expect(result.isError).toBe(false);
    expect(publish).toHaveBeenCalledWith(PUBSUB_CHANNELS.channelResponseReady, {
      sessionId: 'sess-parent',
      output: '_researcher progress: processed 3 of 5 files_',
    });
  });

  it('throttles a second report inside the interval without erroring', async () => {
    const publish = vi.fn().mockResolvedValue(1);
    const tool = createReportProgressTool({
      pubsub: { publish },
      sessionId: 'sess-parent',
      agentName: 'researcher',
    });

    await tool.execute({ text: 'one' });
    const second = await tool.execute({ text: 'two' });

    expect(second.isError).toBe(false);
    expect(second.output).toContain('throttled');
    expect(publish).toHaveBeenCalledTimes(1);

    // After the interval elapses the tool reports again.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + PROGRESS_MIN_INTERVAL_MS + 1000);
      const third = await tool.execute({ text: 'three' });
      expect(third.output).toContain('sent');
      expect(publish).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a publish failure is swallowed — the sub-agent keeps working', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('pubsub down'));
    const tool = createReportProgressTool({
      pubsub: { publish },
      sessionId: 'sess-parent',
      agentName: 'researcher',
    });

    const result = await tool.execute({ text: 'still going' });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('could not be delivered');
  });
});
