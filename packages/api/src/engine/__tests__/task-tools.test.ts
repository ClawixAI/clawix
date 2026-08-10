import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  createSpawnBatchTool,
  createTaskStatusTool,
  createTaskWaitTool,
  MAX_WAVE_SIZE,
  type TaskToolDeps,
} from '../tools/task-tools.js';
import { KEY_PREFIXES } from '../../cache/cache.constants.js';
import type { AgentDefinitionRepository } from '../../db/agent-definition.repository.js';
import type { AgentRunRepository } from '../../db/agent-run.repository.js';
import type { RedisService } from '../../cache/redis.service.js';

describe('task cooperation tools', () => {
  let mockAgentDefRepo: {
    findByName: ReturnType<typeof vi.fn>;
    findOrCreateDefaultWorkerForPolicy: ReturnType<typeof vi.fn>;
  };
  let mockAgentRunRepo: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let mockRedis: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    lrange: ReturnType<typeof vi.fn>;
    lrem: ReturnType<typeof vi.fn>;
  };
  let mockSubmit: ReturnType<typeof vi.fn>;
  let deps: TaskToolDeps;
  let runCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    runCounter = 0;

    mockAgentDefRepo = {
      findByName: vi.fn().mockResolvedValue({ id: 'def-named', role: 'worker' }),
      findOrCreateDefaultWorkerForPolicy: vi.fn().mockResolvedValue({ id: 'def-default' }),
    };
    mockAgentRunRepo = {
      create: vi.fn().mockImplementation(() => {
        runCounter += 1;
        return Promise.resolve({ id: `run-${runCounter}` });
      }),
      findById: vi.fn().mockResolvedValue({
        id: 'run-1',
        status: 'running',
        output: null,
        error: null,
      }),
    };
    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      lrange: vi.fn().mockResolvedValue([]),
      lrem: vi.fn().mockResolvedValue(1),
    };
    mockSubmit = vi.fn();

    deps = {
      agentDefRepo: mockAgentDefRepo as unknown as AgentDefinitionRepository,
      agentRunRepo: mockAgentRunRepo as unknown as AgentRunRepository,
      taskExecutor: { submit: mockSubmit },
      redis: mockRedis as unknown as RedisService,
      parentSessionId: 'sess-parent',
      parentAgentRunId: 'run-parent',
      userId: 'user-1',
    };
  });

  // ---------------------------------------------------------------- //
  //  spawn_batch                                                      //
  // ---------------------------------------------------------------- //

  describe('spawn_batch', () => {
    it('dispatches every task, registers the wave, and returns wave + task ids', async () => {
      const tool = createSpawnBatchTool(deps);
      const result = await tool.execute({
        tasks: [{ prompt: 'a' }, { agent_name: 'researcher', prompt: 'b' }],
      });

      expect(result.isError).toBe(false);
      expect(mockAgentRunRepo.create).toHaveBeenCalledTimes(2);
      expect(mockSubmit).toHaveBeenCalledTimes(2);

      const [waveKey, ids, opts] = mockRedis.set.mock.calls[0]!;
      expect(waveKey).toContain(KEY_PREFIXES.agentWave);
      expect(ids).toEqual(['run-1', 'run-2']);
      expect(opts).toEqual({ ttlSeconds: expect.any(Number) });

      expect(result.output).toContain('Dispatched wave');
      expect(result.output).toContain('run-1');
      expect(result.output).toContain('run-2');
      expect(result.output).toContain('task_wait');
    });

    it('fails the whole batch atomically when any task is invalid — nothing dispatched', async () => {
      mockAgentDefRepo.findByName.mockResolvedValue(null);
      const tool = createSpawnBatchTool(deps);

      const result = await tool.execute({
        tasks: [{ prompt: 'ok' }, { agent_name: 'ghost', prompt: 'boom' }],
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('Task 2');
      expect(mockAgentRunRepo.create).not.toHaveBeenCalled();
      expect(mockSubmit).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('rejects waves above MAX_WAVE_SIZE', async () => {
      const tool = createSpawnBatchTool(deps);
      const tasks = Array.from({ length: MAX_WAVE_SIZE + 1 }, () => ({ prompt: 'x' }));

      const result = await tool.execute({ tasks });

      expect(result.isError).toBe(true);
      expect(mockAgentRunRepo.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- //
  //  task_status                                                      //
  // ---------------------------------------------------------------- //

  describe('task_status', () => {
    it('resolves ids from a wave and reports each status without blocking', async () => {
      mockRedis.get.mockResolvedValue(['run-1', 'run-2']);
      mockAgentRunRepo.findById
        .mockResolvedValueOnce({ id: 'run-1', status: 'completed', output: 'done', error: null })
        .mockResolvedValueOnce({ id: 'run-2', status: 'running', output: null, error: null });

      const tool = createTaskStatusTool(deps);
      const result = await tool.execute({ wave_id: 'wave-1' });

      expect(result.isError).toBe(false);
      expect(result.output).toContain('1/2 settled');
      expect(result.output).toContain('run-1: completed');
      expect(result.output).toContain('run-2: running');
    });

    it('errors on an expired/unknown wave', async () => {
      mockRedis.get.mockResolvedValue(null);
      const tool = createTaskStatusTool(deps);

      const result = await tool.execute({ wave_id: 'wave-gone' });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('Wave not found');
    });

    it('tolerates unknown task ids', async () => {
      mockAgentRunRepo.findById.mockRejectedValue(new Error('not found'));
      const tool = createTaskStatusTool(deps);

      const result = await tool.execute({ task_ids: ['run-ghost'] });

      expect(result.isError).toBe(false);
      expect(result.output).toContain('run-ghost: unknown');
    });
  });

  // ---------------------------------------------------------------- //
  //  task_wait                                                        //
  // ---------------------------------------------------------------- //

  describe('task_wait', () => {
    it('returns immediately when the wave is already settled and consumes queued payloads', async () => {
      mockRedis.get.mockResolvedValue(['run-1']);
      mockAgentRunRepo.findById.mockResolvedValue({
        id: 'run-1',
        status: 'completed',
        output: 'db output',
        error: null,
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

      const tool = createTaskWaitTool(deps);
      const result = await tool.execute({ wave_id: 'wave-1', mode: 'all' });

      expect(result.isError).toBe(false);
      expect(result.output).toContain('1/1 task(s) settled');
      // Queue payload consumed so batch delivery cannot double-deliver it.
      expect(mockRedis.lrem).toHaveBeenCalledWith(
        `${KEY_PREFIXES.agentResults}sess-parent`,
        1,
        queuedRaw,
      );
      // Queue payload wins as the authoritative output source.
      expect(result.output).toContain('queued output');
    });

    it('polls until the required count settles (mode=any)', async () => {
      vi.useFakeTimers();
      try {
        mockAgentRunRepo.findById
          .mockResolvedValueOnce({ id: 'run-1', status: 'running', output: null, error: null })
          .mockResolvedValue({ id: 'run-1', status: 'completed', output: 'late', error: null });

        const tool = createTaskWaitTool(deps);
        const pending = tool.execute({ task_ids: ['run-1'], mode: 'any' });

        await vi.advanceTimersByTimeAsync(1100);
        const result = await pending;

        expect(result.isError).toBe(false);
        expect(result.output).toContain('1/1 task(s) settled');
        expect(result.output).toContain('late');
      } finally {
        vi.useRealTimers();
      }
    });

    it('times out with partial results and a no-busy-poll reminder', async () => {
      vi.useFakeTimers();
      try {
        mockAgentRunRepo.findById.mockResolvedValue({
          id: 'run-1',
          status: 'running',
          output: null,
          error: null,
        });

        const tool = createTaskWaitTool(deps);
        const pending = tool.execute({ task_ids: ['run-1'], mode: 'all', timeout_ms: 2000 });

        await vi.advanceTimersByTimeAsync(3000);
        const result = await pending;

        expect(result.isError).toBe(false);
        expect(result.output).toContain('timed out');
        expect(result.output).toContain('Still running: run-1 (running)');
        expect(result.output).toContain('do not sleep or busy-poll');
      } finally {
        vi.useRealTimers();
      }
    });

    it('errors when neither wave_id nor task_ids is provided', async () => {
      const tool = createTaskWaitTool(deps);
      const result = await tool.execute({});
      expect(result.isError).toBe(true);
    });
  });
});
