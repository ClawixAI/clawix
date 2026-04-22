vi.mock('@clawix/shared', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { describe, expect, it, vi } from 'vitest';

import { createCronTool } from '../../tools/cron.js';
import type { CronGuardService } from '../../cron-guard.service.js';
import type { ChannelRepository } from '../../../db/channel.repository.js';
import type { TaskRepository } from '../../../db/task.repository.js';
import type { TaskRunRepository } from '../../../db/task-run.repository.js';
import type { TaskRunMessageRepository } from '../../../db/task-run-message.repository.js';
import type { CronPolicy } from '../../tools/cron.js';

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

const USER_ID = 'user-abc';
const AGENT_DEFINITION_ID = 'agent-def-1';

const POLICY_ENABLED: CronPolicy = {
  cronEnabled: true,
  maxScheduledTasks: 10,
  minCronIntervalSecs: 60,
  maxTokensPerCronRun: null,
};

function makeTask(
  overrides: Partial<{
    id: string;
    name: string;
    agentDefinitionId: string;
    createdByUserId: string;
    schedule: unknown;
    prompt: string;
    channelId: string | null;
    enabled: boolean;
    nextRunAt: Date | null;
    lastRunAt: Date | null;
    lastStatus: string | null;
    consecutiveFailures: number;
  }> = {},
) {
  return {
    id: overrides.id ?? 'task-1',
    name: overrides.name ?? 'Test Job',
    agentDefinitionId: overrides.agentDefinitionId ?? AGENT_DEFINITION_ID,
    createdByUserId: overrides.createdByUserId ?? USER_ID,
    schedule: overrides.schedule ?? { type: 'every', interval: '1h' },
    prompt: overrides.prompt ?? 'Do the thing',
    channelId: overrides.channelId ?? null,
    enabled: overrides.enabled ?? true,
    nextRunAt: overrides.nextRunAt ?? null,
    lastRunAt: overrides.lastRunAt ?? null,
    lastStatus: overrides.lastStatus ?? null,
    consecutiveFailures: overrides.consecutiveFailures ?? 0,
    disabledReason: null,
    timeoutMs: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    updatedAt: new Date('2026-03-01T00:00:00Z'),
  };
}

function makeTaskRepo(
  overrides: {
    findByUser?: ReturnType<typeof vi.fn>;
    findById?: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
    delete?: ReturnType<typeof vi.fn>;
  } = {},
): TaskRepository {
  return {
    findByUser: overrides.findByUser ?? vi.fn().mockResolvedValue([]),
    findById: overrides.findById ?? vi.fn().mockResolvedValue(makeTask()),
    create: overrides.create ?? vi.fn().mockResolvedValue(makeTask()),
    delete: overrides.delete ?? vi.fn().mockResolvedValue(makeTask()),
    // Stub remaining methods so TypeScript is satisfied
    findAll: vi.fn(),
    findEnabled: vi.fn(),
    update: vi.fn(),
    updateLastRun: vi.fn(),
    findDue: vi.fn(),
    findActiveCountByUser: vi.fn(),
    findRunningCountByUser: vi.fn(),
    incrementFailures: vi.fn(),
    resetFailures: vi.fn(),
    autoDisable: vi.fn(),
    updateNextRunAt: vi.fn(),
  } as unknown as TaskRepository;
}

function makeChannelRepo(
  overrides: {
    findByType?: ReturnType<typeof vi.fn>;
  } = {},
): ChannelRepository {
  return {
    findByType: overrides.findByType ?? vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    findAll: vi.fn(),
    findActive: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as ChannelRepository;
}

function makeCronGuard(allowed = true, reason?: string): CronGuardService {
  return {
    canCreate: vi.fn().mockResolvedValue({ allowed, reason }),
    canDispatch: vi.fn(),
  } as unknown as CronGuardService;
}

function makeTaskRunRepo(
  overrides: {
    findByTaskIdWithLimit?: ReturnType<typeof vi.fn>;
    findById?: ReturnType<typeof vi.fn>;
  } = {},
): TaskRunRepository {
  return {
    findByTaskIdWithLimit: overrides.findByTaskIdWithLimit ?? vi.fn().mockResolvedValue([]),
    findById: overrides.findById ?? vi.fn().mockResolvedValue(makeTaskRun()),
    findAll: vi.fn(),
    findByTaskId: vi.fn(),
    findLatestByTaskId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    markOrphanedRuns: vi.fn(),
    delete: vi.fn(),
  } as unknown as TaskRunRepository;
}

function makeTaskRun(
  overrides: Partial<{
    id: string;
    taskId: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
    durationMs: number | null;
    tokenUsage: unknown;
    output: string | null;
    error: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? 'run-1',
    taskId: overrides.taskId ?? 'task-1',
    status: overrides.status ?? 'completed',
    startedAt: overrides.startedAt ?? new Date('2026-04-01T00:00:00Z'),
    completedAt:
      overrides.completedAt !== undefined
        ? overrides.completedAt
        : new Date('2026-04-01T00:01:00Z'),
    durationMs: overrides.durationMs !== undefined ? overrides.durationMs : 60000,
    tokenUsage: overrides.tokenUsage !== undefined ? overrides.tokenUsage : null,
    output: overrides.output !== undefined ? overrides.output : null,
    error: overrides.error !== undefined ? overrides.error : null,
  };
}

function makeTaskRunMessage(
  overrides: Partial<{
    id: string;
    taskRunId: string;
    role: string;
    content: string;
    ordering: number;
    toolCallId: string | null;
    toolCalls: unknown;
    createdAt: Date;
  }> = {},
) {
  return {
    id: overrides.id ?? 'msg-1',
    taskRunId: overrides.taskRunId ?? 'run-1',
    role: overrides.role ?? 'user',
    content: overrides.content ?? 'hello',
    ordering: overrides.ordering ?? 0,
    toolCallId: overrides.toolCallId !== undefined ? overrides.toolCallId : null,
    toolCalls: overrides.toolCalls !== undefined ? overrides.toolCalls : null,
    createdAt: overrides.createdAt ?? new Date('2026-04-01T00:00:00Z'),
  };
}

function makeTaskRunMessageRepo(
  overrides: {
    findByTaskRunId?: ReturnType<typeof vi.fn>;
  } = {},
): TaskRunMessageRepository {
  return {
    findByTaskRunId: overrides.findByTaskRunId ?? vi.fn().mockResolvedValue([]),
    appendMany: vi.fn(),
    countByTaskRunId: vi.fn(),
  } as unknown as TaskRunMessageRepository;
}

// ------------------------------------------------------------------ //
//  Tool identity                                                      //
// ------------------------------------------------------------------ //

describe('cron tool', () => {
  it('has the correct name', () => {
    const tool = createCronTool(
      makeCronGuard(),
      makeTaskRepo(),
      makeChannelRepo(),
      USER_ID,
      AGENT_DEFINITION_ID,
      POLICY_ENABLED,
      false,
      null,
      makeTaskRunRepo(),
      makeTaskRunMessageRepo(),
      'UTC',
    );
    expect(tool.name).toBe('cron');
  });

  // ---------------------------------------------------------------- //
  //  list action                                                      //
  // ---------------------------------------------------------------- //

  describe('list action', () => {
    it("returns the user's cron jobs as JSON", async () => {
      const tasks = [
        makeTask({ id: 'task-1', name: 'Daily Digest' }),
        makeTask({ id: 'task-2', name: 'Weekly Report' }),
      ];
      const taskRepo = makeTaskRepo({ findByUser: vi.fn().mockResolvedValue(tasks) });
      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'list' });

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.output);
      expect(parsed.jobs).toHaveLength(2);
      expect(parsed.jobs[0].jobId).toBe('task-1');
      expect(parsed.jobs[0].name).toBe('Daily Digest');
      expect(parsed.jobs[1].jobId).toBe('task-2');
    });

    it('returns empty jobs array when user has no tasks', async () => {
      const taskRepo = makeTaskRepo({ findByUser: vi.fn().mockResolvedValue([]) });
      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'list' });

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.output);
      expect(parsed.jobs).toHaveLength(0);
    });

    it('list still works during cron execution', async () => {
      const tasks = [makeTask()];
      const taskRepo = makeTaskRepo({ findByUser: vi.fn().mockResolvedValue(tasks) });
      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        true,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'list' });

      expect(result.isError).toBe(false);
    });

    it('includes expected fields in each job', async () => {
      const nextRun = new Date('2026-04-01T09:00:00Z');
      const lastRun = new Date('2026-03-28T09:00:00Z');
      const tasks = [
        makeTask({
          id: 'task-x',
          name: 'Morning Standup',
          schedule: { type: 'cron', expression: '0 9 * * MON-FRI' },
          prompt: 'Summarize yesterday',
          channelId: 'chan-1',
          enabled: true,
          nextRunAt: nextRun,
          lastRunAt: lastRun,
          lastStatus: 'completed',
          consecutiveFailures: 0,
        }),
      ];
      const taskRepo = makeTaskRepo({ findByUser: vi.fn().mockResolvedValue(tasks) });
      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'list' });

      const parsed = JSON.parse(result.output);
      const job = parsed.jobs[0];
      expect(job.jobId).toBe('task-x');
      expect(job.name).toBe('Morning Standup');
      expect(job.channelId).toBe('chan-1');
      expect(job.enabled).toBe(true);
      expect(job.nextRunAt).toBe(nextRun.toISOString());
      expect(job.lastRunAt).toBe(lastRun.toISOString());
      expect(job.lastStatus).toBe('completed');
      expect(job.consecutiveFailures).toBe(0);
    });
  });

  // ---------------------------------------------------------------- //
  //  create action                                                    //
  // ---------------------------------------------------------------- //

  describe('create action', () => {
    it('creates a task when guard allows', async () => {
      const created = makeTask({ id: 'task-new', name: 'New Job' });
      const taskRepo = makeTaskRepo({ create: vi.fn().mockResolvedValue(created) });
      const cronGuard = makeCronGuard(true);
      const tool = createCronTool(
        cronGuard,
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({
        action: 'create',
        name: 'New Job',
        prompt: 'Do something useful',
        schedule: JSON.stringify({ type: 'every', interval: '1h' }),
      });

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.output);
      expect(parsed.jobId).toBe('task-new');
      expect(parsed.name).toBe('New Job');
    });

    it('passes correct data to taskRepo.create with session channel', async () => {
      const createFn = vi.fn().mockResolvedValue(makeTask({ id: 'task-created' }));
      const taskRepo = makeTaskRepo({ create: createFn });
      const cronGuard = makeCronGuard(true);
      const tool = createCronTool(
        cronGuard,
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        'chan-42',
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      await tool.execute({
        action: 'create',
        name: 'My Job',
        prompt: 'Check emails',
        schedule: JSON.stringify({ type: 'every', interval: '30m' }),
      });

      expect(createFn).toHaveBeenCalledWith({
        agentDefinitionId: AGENT_DEFINITION_ID,
        name: 'My Job',
        schedule: { type: 'every', interval: '30m' },
        prompt: 'Check emails',
        channelId: 'chan-42',
        enabled: true,
        createdByUserId: USER_ID,
      });
    });

    it('falls back to session channelId when not provided by agent', async () => {
      const createFn = vi.fn().mockResolvedValue(makeTask({ id: 'task-fallback' }));
      const taskRepo = makeTaskRepo({ create: createFn });
      const cronGuard = makeCronGuard(true);
      const tool = createCronTool(
        cronGuard,
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        'session-channel-uuid',
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      await tool.execute({
        action: 'create',
        name: 'Fallback Job',
        prompt: 'Remind me',
        schedule: JSON.stringify({ type: 'every', interval: '5m' }),
      });

      expect(createFn).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: 'session-channel-uuid' }),
      );
    });

    it('uses null channelId when agent passes channel="none"', async () => {
      const createFn = vi.fn().mockResolvedValue(makeTask({ id: 'task-none' }));
      const taskRepo = makeTaskRepo({ create: createFn });
      const cronGuard = makeCronGuard(true);
      const tool = createCronTool(
        cronGuard,
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        'session-channel-uuid',
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      await tool.execute({
        action: 'create',
        name: 'Silent Job',
        prompt: 'Do quietly',
        schedule: JSON.stringify({ type: 'every', interval: '1h' }),
        channel: 'none',
      });

      expect(createFn).toHaveBeenCalledWith(expect.objectContaining({ channelId: null }));
    });

    it('resolves channel type to DB channel ID for cross-channel delivery', async () => {
      const createFn = vi.fn().mockResolvedValue(makeTask({ id: 'task-cross' }));
      const taskRepo = makeTaskRepo({ create: createFn });
      const cronGuard = makeCronGuard(true);
      const channelRepo = makeChannelRepo({
        findByType: vi
          .fn()
          .mockResolvedValue([
            { id: 'chan-tg-id', type: 'telegram', name: 'Telegram', isActive: true },
          ]),
      });
      const tool = createCronTool(
        cronGuard,
        taskRepo,
        channelRepo,
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        'web-session-chan',
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      await tool.execute({
        action: 'create',
        name: 'Cross Channel Job',
        prompt: 'Send to Telegram',
        schedule: JSON.stringify({ type: 'every', interval: '1h' }),
        channel: 'telegram',
      });

      expect(createFn).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'chan-tg-id' }));
    });

    it('returns error for channel type with no active channels', async () => {
      const cronGuard = makeCronGuard(true);
      const channelRepo = makeChannelRepo({
        findByType: vi.fn().mockResolvedValue([]),
      });
      const tool = createCronTool(
        cronGuard,
        makeTaskRepo(),
        channelRepo,
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({
        action: 'create',
        name: 'No Channel Job',
        prompt: 'Send somewhere',
        schedule: JSON.stringify({ type: 'every', interval: '1h' }),
        channel: 'slack',
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('No active slack channel');
    });

    it('returns error for invalid channel value', async () => {
      const cronGuard = makeCronGuard(true);
      const tool = createCronTool(
        cronGuard,
        makeTaskRepo(),
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({
        action: 'create',
        name: 'Bad Channel Job',
        prompt: 'Send somewhere',
        schedule: JSON.stringify({ type: 'every', interval: '1h' }),
        channel: '11111111',
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('Invalid channel');
    });

    it('rejects when guard denies', async () => {
      const cronGuard = makeCronGuard(false, 'Limit reached');
      const taskRepo = makeTaskRepo();
      const tool = createCronTool(
        cronGuard,
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({
        action: 'create',
        name: 'Blocked Job',
        prompt: 'Do something',
        schedule: JSON.stringify({ type: 'every', interval: '1h' }),
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('Limit reached');
    });

    it('rejects with missing name', async () => {
      const tool = createCronTool(
        makeCronGuard(),
        makeTaskRepo(),
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({
        action: 'create',
        prompt: 'Do something',
        schedule: JSON.stringify({ type: 'every', interval: '1h' }),
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('name');
    });

    it('rejects with missing prompt', async () => {
      const tool = createCronTool(
        makeCronGuard(),
        makeTaskRepo(),
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({
        action: 'create',
        name: 'Some Job',
        schedule: JSON.stringify({ type: 'every', interval: '1h' }),
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('prompt');
    });

    it('rejects with missing schedule', async () => {
      const tool = createCronTool(
        makeCronGuard(),
        makeTaskRepo(),
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({
        action: 'create',
        name: 'Some Job',
        prompt: 'Do something',
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('schedule');
    });

    it('rejects with invalid schedule JSON', async () => {
      const tool = createCronTool(
        makeCronGuard(),
        makeTaskRepo(),
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({
        action: 'create',
        name: 'Bad Job',
        prompt: 'Do something',
        schedule: 'not-valid-json{{{',
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('Invalid schedule');
    });

    it('is blocked during cron execution', async () => {
      const tool = createCronTool(
        makeCronGuard(),
        makeTaskRepo(),
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        true,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({
        action: 'create',
        name: 'Recursive Job',
        prompt: 'Trigger myself',
        schedule: JSON.stringify({ type: 'every', interval: '5m' }),
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('scheduled execution');
    });
  });

  // ---------------------------------------------------------------- //
  //  remove action                                                    //
  // ---------------------------------------------------------------- //

  describe('remove action', () => {
    it('removes an owned task', async () => {
      const task = makeTask({ id: 'task-to-delete', createdByUserId: USER_ID });
      const deleteFn = vi.fn().mockResolvedValue(task);
      const taskRepo = makeTaskRepo({
        findById: vi.fn().mockResolvedValue(task),
        delete: deleteFn,
      });
      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'remove', jobId: 'task-to-delete' });

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.output);
      expect(parsed.jobId).toBe('task-to-delete');
      expect(parsed.removed).toBe(true);
      expect(deleteFn).toHaveBeenCalledWith('task-to-delete');
    });

    it('rejects removing a task owned by another user', async () => {
      const task = makeTask({ id: 'task-other', createdByUserId: 'other-user' });
      const deleteFn = vi.fn();
      const taskRepo = makeTaskRepo({
        findById: vi.fn().mockResolvedValue(task),
        delete: deleteFn,
      });
      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'remove', jobId: 'task-other' });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('only remove your own');
      expect(deleteFn).not.toHaveBeenCalled();
    });

    it('returns error when task not found', async () => {
      const taskRepo = makeTaskRepo({
        findById: vi.fn().mockRejectedValue(new Error('Not found')),
      });
      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'remove', jobId: 'missing-task' });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('not found');
    });

    it('rejects with missing jobId', async () => {
      const tool = createCronTool(
        makeCronGuard(),
        makeTaskRepo(),
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'remove' });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('jobId');
    });

    it('is blocked during cron execution', async () => {
      const tool = createCronTool(
        makeCronGuard(),
        makeTaskRepo(),
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        true,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'remove', jobId: 'task-1' });

      expect(result.isError).toBe(true);
      expect(result.output).toContain('scheduled execution');
    });
  });

  // ---------------------------------------------------------------- //
  //  runDetail action                                                 //
  // ---------------------------------------------------------------- //

  describe('cron tool — runDetail action', () => {
    it('returns run metadata + transcript for own task', async () => {
      const task = makeTask({ id: 't1', createdByUserId: USER_ID });
      const run = makeTaskRun({ id: 'r1', taskId: 't1' });
      const messages = [
        makeTaskRunMessage({ id: 'm1', taskRunId: 'r1', role: 'user', content: 'q', ordering: 0 }),
        makeTaskRunMessage({
          id: 'm2',
          taskRunId: 'r1',
          role: 'assistant',
          content: 'a',
          ordering: 1,
        }),
        makeTaskRunMessage({
          id: 'm3',
          taskRunId: 'r1',
          role: 'tool',
          content: 'ok',
          ordering: 2,
          toolCallId: 'tc1',
        }),
      ];

      const taskRepo = makeTaskRepo({ findById: vi.fn().mockResolvedValue(task) });
      const taskRunRepo = makeTaskRunRepo({ findById: vi.fn().mockResolvedValue(run) });
      const taskRunMessageRepo = makeTaskRunMessageRepo({
        findByTaskRunId: vi.fn().mockResolvedValue(messages),
      });

      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        taskRunRepo,
        taskRunMessageRepo,
        'UTC',
      );

      const result = await tool.execute({ action: 'runDetail', jobId: 't1', runId: 'r1' });

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.output) as {
        runId: string;
        messages: { role: string; content: string; toolCallId?: string }[];
      };
      expect(parsed.runId).toBe('r1');
      expect(parsed.messages).toHaveLength(3);
      expect(parsed.messages[0]!.role).toBe('user');
      expect(parsed.messages[2]!.toolCallId).toBe('tc1');
    });

    it('caps transcript at 50 messages with truncation marker', async () => {
      const task = makeTask({ id: 't2', createdByUserId: USER_ID });
      const run = makeTaskRun({ id: 'r2', taskId: 't2' });
      // Seed 60 messages
      const messages = Array.from({ length: 60 }, (_, i) =>
        makeTaskRunMessage({
          id: `m${i}`,
          taskRunId: 'r2',
          role: 'user',
          content: `msg ${i}`,
          ordering: i,
        }),
      );

      const taskRepo = makeTaskRepo({ findById: vi.fn().mockResolvedValue(task) });
      const taskRunRepo = makeTaskRunRepo({ findById: vi.fn().mockResolvedValue(run) });
      const taskRunMessageRepo = makeTaskRunMessageRepo({
        findByTaskRunId: vi.fn().mockResolvedValue(messages),
      });

      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        taskRunRepo,
        taskRunMessageRepo,
        'UTC',
      );

      const result = await tool.execute({ action: 'runDetail', jobId: 't2', runId: 'r2' });

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.output) as {
        messages: { role: string; content: string }[];
      };
      // 1 truncation marker + 50 kept messages
      expect(parsed.messages).toHaveLength(51);
      expect(parsed.messages[0]!.role).toBe('system');
      expect(parsed.messages[0]!.content).toContain('[truncated: 10 earlier messages]');
      // The kept messages are the last 50 of the original 60 (indices 10–59)
      expect(parsed.messages[1]!.content).toBe('msg 10');
      expect(parsed.messages[50]!.content).toBe('msg 59');
    });

    it('caps per-message content at 8000 chars', async () => {
      const task = makeTask({ id: 't3', createdByUserId: USER_ID });
      const run = makeTaskRun({ id: 'r3', taskId: 't3' });
      const longContent = 'x'.repeat(12000);
      const messages = [
        makeTaskRunMessage({
          id: 'm1',
          taskRunId: 'r3',
          role: 'assistant',
          content: longContent,
          ordering: 0,
        }),
      ];

      const taskRepo = makeTaskRepo({ findById: vi.fn().mockResolvedValue(task) });
      const taskRunRepo = makeTaskRunRepo({ findById: vi.fn().mockResolvedValue(run) });
      const taskRunMessageRepo = makeTaskRunMessageRepo({
        findByTaskRunId: vi.fn().mockResolvedValue(messages),
      });

      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        taskRunRepo,
        taskRunMessageRepo,
        'UTC',
      );

      const result = await tool.execute({ action: 'runDetail', jobId: 't3', runId: 'r3' });

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.output) as {
        messages: { role: string; content: string }[];
      };
      const content = parsed.messages[0]!.content;
      // Starts with 8000 'x' chars
      expect(content.startsWith('x'.repeat(8000))).toBe(true);
      // Ends with truncation marker
      expect(content).toContain('[truncated 4000 chars]');
    });

    it('ownership — returns "not found" for foreign task', async () => {
      const task = makeTask({ id: 't4', createdByUserId: 'other-user' });
      const taskRepo = makeTaskRepo({ findById: vi.fn().mockResolvedValue(task) });

      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'runDetail', jobId: 't4', runId: 'r4' });

      expect(result.isError).toBe(true);
      expect(result.output.toLowerCase()).toContain('not found');
    });

    it('returns "not found" when runId does not belong to the job', async () => {
      const task = makeTask({ id: 't5', createdByUserId: USER_ID });
      // run.taskId points to a different task
      const run = makeTaskRun({ id: 'r5', taskId: 'other-task-id' });

      const taskRepo = makeTaskRepo({ findById: vi.fn().mockResolvedValue(task) });
      const taskRunRepo = makeTaskRunRepo({ findById: vi.fn().mockResolvedValue(run) });

      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        taskRunRepo,
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'runDetail', jobId: 't5', runId: 'r5' });

      expect(result.isError).toBe(true);
      expect(result.output.toLowerCase()).toContain('not found');
    });
  });

  // ---------------------------------------------------------------- //
  //  runs action                                                      //
  // ---------------------------------------------------------------- //

  describe('cron tool — runs action', () => {
    it('returns recent runs with truncated output', async () => {
      const shortOutput = 'x'.repeat(100);
      const mediumOutput = 'y'.repeat(500);
      const longOutput = 'z'.repeat(3000);

      const task = makeTask({ id: 'task-runs-1', createdByUserId: USER_ID });
      const runs = [
        makeTaskRun({ id: 'run-a', taskId: 'task-runs-1', output: longOutput }),
        makeTaskRun({ id: 'run-b', taskId: 'task-runs-1', output: mediumOutput }),
        makeTaskRun({ id: 'run-c', taskId: 'task-runs-1', output: shortOutput }),
      ];

      const findByTaskIdWithLimitFn = vi.fn().mockResolvedValue(runs.slice(0, 2));
      const taskRunRepo = makeTaskRunRepo({ findByTaskIdWithLimit: findByTaskIdWithLimitFn });
      const taskRepo = makeTaskRepo({ findById: vi.fn().mockResolvedValue(task) });

      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        taskRunRepo,
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'runs', jobId: 'task-runs-1', limit: 2 });

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.output) as {
        runs: { runId: string; output: string | null }[];
      };
      expect(parsed.runs).toHaveLength(2);

      // The first run has 3000-char output — should be truncated
      const firstRun = parsed.runs[0]!;
      expect(firstRun.output).toContain('[truncated');
      expect(firstRun.output!.length).toBeLessThan(3000);

      // The second run has 500-char output — should be preserved in full
      const secondRun = parsed.runs[1]!;
      expect(secondRun.output).toBe(mediumOutput);
    });

    it('respects ownership — returns "not found" if task not owned by user', async () => {
      const task = makeTask({ id: 't1', createdByUserId: 'someone-else' });
      const taskRepo = makeTaskRepo({ findById: vi.fn().mockResolvedValue(task) });

      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        makeTaskRunRepo(),
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'runs', jobId: 't1' });

      expect(result.isError).toBe(true);
      expect(result.output.toLowerCase()).toContain('not found');
    });

    it('is allowed during cron execution (isInCronExecution=true)', async () => {
      const task = makeTask({ id: 'task-cron-runs', createdByUserId: USER_ID });
      const taskRepo = makeTaskRepo({ findById: vi.fn().mockResolvedValue(task) });
      const taskRunRepo = makeTaskRunRepo({ findByTaskIdWithLimit: vi.fn().mockResolvedValue([]) });

      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        true,
        null,
        taskRunRepo,
        makeTaskRunMessageRepo(),
        'UTC',
      );

      const result = await tool.execute({ action: 'runs', jobId: 'task-cron-runs' });

      expect(result.isError).toBe(false);
    });

    it('caps limit at 50 and defaults to 10', async () => {
      const task = makeTask({ id: 'task-limit', createdByUserId: USER_ID });
      const taskRepo = makeTaskRepo({ findById: vi.fn().mockResolvedValue(task) });
      const findByTaskIdWithLimitFn = vi.fn().mockResolvedValue([]);
      const taskRunRepo = makeTaskRunRepo({ findByTaskIdWithLimit: findByTaskIdWithLimitFn });

      const tool = createCronTool(
        makeCronGuard(),
        taskRepo,
        makeChannelRepo(),
        USER_ID,
        AGENT_DEFINITION_ID,
        POLICY_ENABLED,
        false,
        null,
        taskRunRepo,
        makeTaskRunMessageRepo(),
        'UTC',
      );

      // No limit → default 10
      await tool.execute({ action: 'runs', jobId: 'task-limit' });
      expect(findByTaskIdWithLimitFn).toHaveBeenLastCalledWith('task-limit', 10, undefined);

      // limit=200 → capped at 50
      await tool.execute({ action: 'runs', jobId: 'task-limit', limit: 200 });
      expect(findByTaskIdWithLimitFn).toHaveBeenLastCalledWith('task-limit', 50, undefined);

      // limit=0 → floored at 1
      await tool.execute({ action: 'runs', jobId: 'task-limit', limit: 0 });
      expect(findByTaskIdWithLimitFn).toHaveBeenLastCalledWith('task-limit', 1, undefined);
    });
  });
});

// ------------------------------------------------------------------ //
//  cron tool — defaultTz                                              //
// ------------------------------------------------------------------ //

describe('cron tool — defaultTz', () => {
  it('passes defaultTz to cronGuard and computeNextRun on create', async () => {
    const canCreate = vi.fn().mockResolvedValue({ allowed: true });
    const tool = createCronTool(
      { canCreate } as unknown as CronGuardService,
      makeTaskRepo(),
      makeChannelRepo(),
      USER_ID,
      AGENT_DEFINITION_ID,
      POLICY_ENABLED,
      false,
      null,
      makeTaskRunRepo(),
      makeTaskRunMessageRepo(),
      'America/New_York',
    );

    await tool.execute({
      action: 'create',
      name: 'j',
      prompt: 'p',
      schedule: JSON.stringify({ type: 'cron', expression: '0 9 * * *' }),
      channel: 'none',
    });

    const args = canCreate.mock.calls[0];
    expect(args[args.length - 1]).toBe('America/New_York');
  });

  it('includes the current defaultTz in the schedule parameter description', () => {
    const tool = createCronTool(
      makeCronGuard(),
      makeTaskRepo(),
      makeChannelRepo(),
      USER_ID,
      AGENT_DEFINITION_ID,
      POLICY_ENABLED,
      false,
      null,
      makeTaskRunRepo(),
      makeTaskRunMessageRepo(),
      'America/New_York',
    );

    const scheduleDesc = (tool.parameters as { properties: { schedule: { description: string } } })
      .properties.schedule.description;
    expect(scheduleDesc).toContain('America/New_York');
    expect(scheduleDesc).toMatch(/must include.*(Z|offset)/i);
  });
});
