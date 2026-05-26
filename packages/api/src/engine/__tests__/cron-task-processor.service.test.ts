import { describe, it, expect, vi, beforeEach } from 'vitest';

// ------------------------------------------------------------------ //
//  Module mocks — must be hoisted before imports                      //
// ------------------------------------------------------------------ //

vi.mock('@clawix/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clawix/shared')>();
  return {
    ...actual,
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('../cron-next-run.js', () => ({
  computeNextRun: vi.fn().mockReturnValue(new Date('2026-04-01T00:00:00Z')),
}));

// ------------------------------------------------------------------ //
//  Imports after mocks                                                //
// ------------------------------------------------------------------ //

import { NotFoundError } from '@clawix/shared';

import {
  CronTaskProcessorService,
  MAX_CONSECUTIVE_FAILURES,
} from '../cron-task-processor.service.js';
import type { ProcessableTask } from '../cron-task-processor.service.js';
import { computeNextRun } from '../cron-next-run.js';
import { PUBSUB_CHANNELS } from '../../cache/cache.constants.js';
import { TaskRunMessageStore } from '../message-store/task-run-message-store.js';

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

const baseSystemSettings = {
  cronDefaultTokenBudget: 10000,
  cronExecutionTimeoutMs: 300000,
  cronTokenGracePercent: 10,
  defaultTimezone: 'UTC',
};

const baseTask: ProcessableTask = {
  id: 'task-1',
  agentDefinitionId: 'agent-def-1',
  createdByUserId: 'user-1',
  name: 'Test Cron Task',
  prompt: 'Do something useful',
  channelId: null,
  schedule: { type: 'every', interval: '10m' },
  consecutiveFailures: 0,
  timeoutMs: null,
};

const successfulRunResult = {
  agentRunId: 'run-1',
  sessionId: 'session-1',
  output: 'Task completed successfully',
  status: 'completed' as const,
  tokenUsage: { inputTokens: 100, outputTokens: 50 },
};

function makeAgentRunner(overrides: { run?: ReturnType<typeof vi.fn> } = {}) {
  return {
    run: overrides.run ?? vi.fn().mockResolvedValue(successfulRunResult),
  };
}

function makeTaskRepo() {
  return {
    updateLastRun: vi.fn().mockResolvedValue({}),
    incrementFailures: vi.fn().mockResolvedValue({}),
    resetFailures: vi.fn().mockResolvedValue({}),
    autoDisable: vi.fn().mockResolvedValue({}),
    updateNextRunAt: vi.fn().mockResolvedValue({}),
  };
}

function makeTaskRunRepo(overrides: { create?: ReturnType<typeof vi.fn> } = {}) {
  return {
    create: overrides.create ?? vi.fn().mockResolvedValue({ id: 'run-1' }),
    update: vi.fn().mockResolvedValue({}),
  };
}

function makeSystemSettingsService(overrides: Partial<typeof baseSystemSettings> = {}) {
  return {
    get: vi.fn().mockResolvedValue({ ...baseSystemSettings, ...overrides }),
  };
}

function makePolicyRepo(overrides: { findById?: ReturnType<typeof vi.fn> } = {}) {
  return {
    findById: overrides.findById ?? vi.fn().mockResolvedValue({ maxTokensPerCronRun: null }),
  };
}

function makeUserRepo(overrides: { findById?: ReturnType<typeof vi.fn> } = {}) {
  return {
    findById: overrides.findById ?? vi.fn().mockResolvedValue({ policyId: 'policy-1' }),
  };
}

function makePubSub() {
  return {
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(undefined),
  };
}

function makeTaskRunMessageRepo() {
  return {
    appendMany: vi.fn().mockResolvedValue([]),
    findByTaskRunId: vi.fn().mockResolvedValue([]),
    countByTaskRunId: vi.fn().mockResolvedValue(0),
  };
}

function makeChannelRepo(overrides: { findById?: ReturnType<typeof vi.fn> } = {}) {
  return {
    // Default to a non-web channel (telegram) so existing tests don't go through
    // the new session-anchor branch unless they opt in.
    findById:
      overrides.findById ?? vi.fn().mockResolvedValue({ id: 'channel-1', type: 'telegram' }),
  };
}

function makeSessionRepo(overrides: { findActiveByUserId?: ReturnType<typeof vi.fn> } = {}) {
  return {
    findActiveByUserId: overrides.findActiveByUserId ?? vi.fn().mockResolvedValue([]),
  };
}

function makeSessionManager(overrides: { saveMessages?: ReturnType<typeof vi.fn> } = {}) {
  return {
    saveMessages: overrides.saveMessages ?? vi.fn().mockResolvedValue([]),
  };
}

function makeService(
  options: {
    agentRunner?: ReturnType<typeof makeAgentRunner>;
    taskRepo?: ReturnType<typeof makeTaskRepo>;
    taskRunRepo?: ReturnType<typeof makeTaskRunRepo>;
    taskRunMessageRepo?: ReturnType<typeof makeTaskRunMessageRepo>;
    systemSettingsService?: ReturnType<typeof makeSystemSettingsService>;
    policyRepo?: ReturnType<typeof makePolicyRepo>;
    userRepo?: ReturnType<typeof makeUserRepo>;
    pubsub?: ReturnType<typeof makePubSub>;
    channelRepo?: ReturnType<typeof makeChannelRepo>;
    sessionRepo?: ReturnType<typeof makeSessionRepo>;
    sessionManager?: ReturnType<typeof makeSessionManager>;
  } = {},
) {
  const agentRunner = options.agentRunner ?? makeAgentRunner();
  const taskRepo = options.taskRepo ?? makeTaskRepo();
  const taskRunRepo = options.taskRunRepo ?? makeTaskRunRepo();
  const taskRunMessageRepo = options.taskRunMessageRepo ?? makeTaskRunMessageRepo();
  const systemSettingsService = options.systemSettingsService ?? makeSystemSettingsService();
  const policyRepo = options.policyRepo ?? makePolicyRepo();
  const userRepo = options.userRepo ?? makeUserRepo();
  const pubsub = options.pubsub ?? makePubSub();
  const channelRepo = options.channelRepo ?? makeChannelRepo();
  const sessionRepo = options.sessionRepo ?? makeSessionRepo();
  const sessionManager = options.sessionManager ?? makeSessionManager();

  const service = new CronTaskProcessorService(
    agentRunner as never,
    taskRepo as never,
    taskRunRepo as never,
    taskRunMessageRepo as never,
    systemSettingsService as never,
    policyRepo as never,
    userRepo as never,
    pubsub as never,
    channelRepo as never,
    sessionRepo as never,
    sessionManager as never,
  );

  return {
    service,
    agentRunner,
    taskRepo,
    taskRunRepo,
    taskRunMessageRepo,
    systemSettingsService,
    policyRepo,
    userRepo,
    pubsub,
  };
}

// ------------------------------------------------------------------ //
//  Tests                                                             //
// ------------------------------------------------------------------ //

describe('CronTaskProcessorService.execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a TaskRun record with status running before invoking agent runner', async () => {
    const { service, taskRunRepo } = makeService();

    await service.execute(baseTask);

    expect(taskRunRepo.create).toHaveBeenCalledWith({
      taskId: 'task-1',
      status: 'running',
    });
  });

  it('invokes agent runner with isScheduledTask: true and correct parameters', async () => {
    const { service, agentRunner } = makeService();

    await service.execute(baseTask);

    expect(agentRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinitionId: 'agent-def-1',
        userId: 'user-1',
        input: 'Do something useful',
        isScheduledTask: true,
        channel: 'internal',
        chatId: 'cron:task-1',
        userName: 'CronScheduler',
        outputMode: 'fullTranscript',
      }),
    );
  });

  it('updates TaskRun as completed with output and token usage on success', async () => {
    const { service, taskRunRepo } = makeService();

    await service.execute(baseTask);

    expect(taskRunRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        output: 'Task completed successfully',
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      }),
    );
  });

  it('resets consecutive failures on success', async () => {
    const { service, taskRepo } = makeService();

    await service.execute(baseTask);

    expect(taskRepo.resetFailures).toHaveBeenCalledWith('task-1');
  });

  it('updates lastRun with completed status on success', async () => {
    const { service, taskRepo } = makeService();

    await service.execute(baseTask);

    expect(taskRepo.updateLastRun).toHaveBeenCalledWith('task-1', 'completed', expect.any(Date));
  });

  it('computes and sets nextRunAt on success', async () => {
    const { service, taskRepo } = makeService();
    const expectedNextRun = new Date('2026-04-01T00:00:00Z');

    await service.execute(baseTask);

    // baseSystemSettings.defaultTimezone is 'UTC' by default
    expect(computeNextRun).toHaveBeenCalledWith(baseTask.schedule, 'UTC');
    expect(taskRepo.updateNextRunAt).toHaveBeenCalledWith('task-1', expectedNextRun);
  });

  it('increments consecutive failures on error', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error('agent crashed')),
    });
    const { service, taskRepo } = makeService({ agentRunner });

    await service.execute(baseTask);

    expect(taskRepo.incrementFailures).toHaveBeenCalledWith('task-1');
  });

  it('updates TaskRun as failed with error message on error', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error('something broke')),
    });
    const { service, taskRunRepo } = makeService({ agentRunner });

    await service.execute(baseTask);

    expect(taskRunRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        error: 'something broke',
      }),
    );
  });

  it('updates lastRun with failed status on error', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error('oops')),
    });
    const { service, taskRepo } = makeService({ agentRunner });

    await service.execute(baseTask);

    expect(taskRepo.updateLastRun).toHaveBeenCalledWith('task-1', 'failed', expect.any(Date));
  });

  it('computes nextRunAt on failure when not auto-disabled', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error('oops')),
    });
    const task = { ...baseTask, consecutiveFailures: 0 }; // 0+1=1, below MAX=3
    const { service, taskRepo } = makeService({ agentRunner });

    await service.execute(task);

    expect(taskRepo.updateNextRunAt).toHaveBeenCalledWith('task-1', expect.any(Date));
    expect(taskRepo.autoDisable).not.toHaveBeenCalled();
  });

  it('auto-disables after max consecutive failures (consecutiveFailures=2, +1=3>=MAX=3)', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error('failed again')),
    });
    const task: ProcessableTask = { ...baseTask, consecutiveFailures: 2 };
    const { service, taskRepo } = makeService({ agentRunner });

    await service.execute(task);

    expect(taskRepo.autoDisable).toHaveBeenCalledWith('task-1', 'auto:max_failures');
  });

  it('does NOT compute nextRunAt when auto-disabled', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error('failed')),
    });
    const task: ProcessableTask = { ...baseTask, consecutiveFailures: 2 };
    const { service, taskRepo } = makeService({ agentRunner });

    await service.execute(task);

    expect(taskRepo.updateNextRunAt).not.toHaveBeenCalled();
  });

  it('does not auto-disable when consecutiveFailures is below threshold (1+1=2 < 3)', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error('fail')),
    });
    const task: ProcessableTask = { ...baseTask, consecutiveFailures: 1 };
    const { service, taskRepo } = makeService({ agentRunner });

    await service.execute(task);

    expect(taskRepo.autoDisable).not.toHaveBeenCalled();
  });

  it('handles execution timeout — rejects and records as failed', async () => {
    // Use a short timeout and a slow agent runner
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000))),
    });
    const systemSettingsService = makeSystemSettingsService({
      cronExecutionTimeoutMs: 50,
    });
    // Also ensure CRON_MAX_TIMEOUT_MS doesn't cap below our test timeout
    const originalEnv = process.env['CRON_MAX_TIMEOUT_MS'];
    process.env['CRON_MAX_TIMEOUT_MS'] = '900000';

    const { service, taskRunRepo } = makeService({ agentRunner, systemSettingsService });

    await service.execute(baseTask);

    expect(taskRunRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        error: 'execution_timeout',
      }),
    );

    // Restore: delete the key when it wasn't originally set to avoid polluting
    // subsequent tests with the string "undefined" (process.env stores strings).
    if (originalEnv === undefined) {
      delete process.env['CRON_MAX_TIMEOUT_MS'];
    } else {
      process.env['CRON_MAX_TIMEOUT_MS'] = originalEnv;
    }
  }, 10000);

  it('uses task.timeoutMs when set, overriding system settings', async () => {
    // task.timeoutMs=50ms should override system default of 300000ms
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000))),
    });
    const task: ProcessableTask = { ...baseTask, timeoutMs: 50 };
    const { service, taskRunRepo } = makeService({ agentRunner });

    await service.execute(task);

    expect(taskRunRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        error: 'execution_timeout',
      }),
    );
  }, 10000);

  it('handles null output from agent runner gracefully', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockResolvedValue({
        ...successfulRunResult,
        output: null,
      }),
    });
    const { service, taskRunRepo } = makeService({ agentRunner });

    await service.execute(baseTask);

    expect(taskRunRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        output: undefined,
      }),
    );
  });

  it('passes tokenBudget from policy to agentRunner.run', async () => {
    const policyRepo = makePolicyRepo({
      findById: vi.fn().mockResolvedValue({ maxTokensPerCronRun: 5000 }),
    });
    const { service, agentRunner } = makeService({ policyRepo });

    await service.execute(baseTask);

    expect(agentRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenBudget: 5000,
        tokenGracePercent: 10,
      }),
    );
  });

  it('uses system default when policy has no maxTokensPerCronRun', async () => {
    const policyRepo = makePolicyRepo({
      findById: vi.fn().mockResolvedValue({ maxTokensPerCronRun: null }),
    });
    const { service, agentRunner } = makeService({ policyRepo });

    await service.execute(baseTask);

    expect(agentRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenBudget: 10000,
      }),
    );
  });

  it('publishes cronResultReady when task has a channelId and run succeeds', async () => {
    const task: ProcessableTask = { ...baseTask, channelId: 'channel-uuid-1' };
    const { service, pubsub } = makeService();

    await service.execute(task);

    expect(pubsub.publish).toHaveBeenCalledWith(
      PUBSUB_CHANNELS.cronResultReady,
      expect.objectContaining({
        status: 'success',
        channelId: 'channel-uuid-1',
        userId: 'user-1',
        taskId: 'task-1',
        taskName: 'Test Cron Task',
        output: 'Task completed successfully',
      }),
    );
  });

  it('does not publish cronResultReady when task has no channelId', async () => {
    const { service, pubsub } = makeService();

    await service.execute(baseTask); // baseTask.channelId is null

    expect(pubsub.publish).not.toHaveBeenCalled();
  });

  it('does not publish cronResultReady when agent output is null', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockResolvedValue({ ...successfulRunResult, output: null }),
    });
    const task: ProcessableTask = { ...baseTask, channelId: 'channel-uuid-1' };
    const { service, pubsub } = makeService({ agentRunner });

    await service.execute(task);

    expect(pubsub.publish).not.toHaveBeenCalled();
  });

  it('publishes cronResultReady with status=failed on failure when channelId is set', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error('execution_timeout')),
    });
    const task: ProcessableTask = { ...baseTask, channelId: 'channel-uuid-1' };
    const { service, pubsub } = makeService({ agentRunner });

    await service.execute(task);

    expect(pubsub.publish).toHaveBeenCalledWith(
      PUBSUB_CHANNELS.cronResultReady,
      expect.objectContaining({
        status: 'failed',
        channelId: 'channel-uuid-1',
        userId: 'user-1',
        taskId: 'task-1',
        taskName: 'Test Cron Task',
        autoDisabled: false,
      }),
    );
    // The friendly text mentions the timeout in minutes (default 300_000ms = 5 min)
    const publishCall = pubsub.publish.mock.calls.find(
      (c) => c[0] === PUBSUB_CHANNELS.cronResultReady,
    );
    expect(publishCall?.[1]).toMatchObject({
      message: expect.stringContaining('Test Cron Task'),
    });
    expect(publishCall?.[1].message).toContain('5-minute limit');
  });

  it('does not publish cronResultReady on failure when channelId is null', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error('execution_timeout')),
    });
    const { service, pubsub } = makeService({ agentRunner });

    await service.execute(baseTask); // baseTask.channelId is null

    expect(pubsub.publish).not.toHaveBeenCalled();
  });

  it('appends auto-disable notice when failure crosses MAX_CONSECUTIVE_FAILURES', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error('execution_timeout')),
    });
    // (consecutiveFailures + 1) crosses the threshold.
    const task: ProcessableTask = {
      ...baseTask,
      channelId: 'channel-uuid-1',
      consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1,
    };
    const { service, pubsub, taskRepo } = makeService({ agentRunner });

    await service.execute(task);

    expect(taskRepo.autoDisable).toHaveBeenCalledWith('task-1', 'auto:max_failures');
    const publishCall = pubsub.publish.mock.calls.find(
      (c) => c[0] === PUBSUB_CHANNELS.cronResultReady,
    );
    expect(publishCall?.[1]).toMatchObject({
      status: 'failed',
      autoDisabled: true,
    });
    expect(publishCall?.[1].message).toContain(
      `Task disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`,
    );
  });

  it('does not append auto-disable notice when below threshold', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error('execution_timeout')),
    });
    const task: ProcessableTask = {
      ...baseTask,
      channelId: 'channel-uuid-1',
      consecutiveFailures: 0, // 0+1=1 is below any reasonable MAX_CONSECUTIVE_FAILURES
    };
    const { service, pubsub } = makeService({ agentRunner });

    await service.execute(task);

    const publishCall = pubsub.publish.mock.calls.find(
      (c) => c[0] === PUBSUB_CHANNELS.cronResultReady,
    );
    expect(publishCall?.[1]).toMatchObject({ status: 'failed', autoDisabled: false });
    expect(publishCall?.[1].message).not.toContain('Task disabled');
  });

  it('stores the raw error (not the friendly text) in TaskRun.error', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error('execution_timeout')),
    });
    const task: ProcessableTask = { ...baseTask, channelId: 'channel-uuid-1' };
    const { service, taskRunRepo } = makeService({ agentRunner });

    await service.execute(task);

    expect(taskRunRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        error: 'execution_timeout', // raw, not "your scheduled task hit..."
      }),
    );
  });

  it('does not publish cronResultReady when task is deleted mid-run (NotFoundError)', async () => {
    const taskRunRepo = makeTaskRunRepo({
      create: vi.fn().mockRejectedValue(new NotFoundError('TaskRun', 'task gone')),
    });
    const task: ProcessableTask = { ...baseTask, channelId: 'channel-uuid-1' };
    const { service, pubsub } = makeService({ taskRunRepo });

    await service.execute(task);

    expect(pubsub.publish).not.toHaveBeenCalled();
  });

  it('treats token_budget_exceeded as failure', async () => {
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockResolvedValue({
        agentRunId: 'run-1',
        sessionId: 'session-1',
        output: 'partial output',
        status: 'failed',
        error: 'token_budget_exceeded',
        tokenUsage: {
          inputTokens: 5000,
          outputTokens: 5000,
          totalTokens: 10000,
          model: 'test',
          estimatedCostUsd: 0,
        },
      }),
    });
    const { service, taskRepo } = makeService({ agentRunner });

    await service.execute(baseTask);

    expect(taskRepo.incrementFailures).toHaveBeenCalledWith('task-1');
  });

  it('passes a TaskRunMessageStore bound to the created TaskRun.id to agentRunner.run', async () => {
    const taskRunRepo = makeTaskRunRepo({
      create: vi.fn().mockResolvedValue({ id: 'run-abc' }),
    });
    const { service, agentRunner } = makeService({ taskRunRepo });

    await service.execute(baseTask);

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const runArgs = agentRunner.run.mock.calls[0][0] as Record<string, unknown>;
    expect(runArgs.messageStore).toBeDefined();
    expect(runArgs.messageStore).toBeInstanceOf(TaskRunMessageStore);
  });

  it('binds TaskRunMessageStore to the correct taskRunId', async () => {
    const taskRunRepo = makeTaskRunRepo({
      create: vi.fn().mockResolvedValue({ id: 'run-xyz' }),
    });
    const taskRunMessageRepo = makeTaskRunMessageRepo();
    let capturedStore: TaskRunMessageStore | undefined;
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockImplementation(async (opts: { messageStore?: TaskRunMessageStore }) => {
        capturedStore = opts.messageStore;
        return successfulRunResult;
      }),
    });
    makeService({ agentRunner, taskRunRepo, taskRunMessageRepo });
    const service = new CronTaskProcessorService(
      agentRunner as never,
      makeTaskRepo() as never,
      taskRunRepo as never,
      taskRunMessageRepo as never,
      makeSystemSettingsService() as never,
      makePolicyRepo() as never,
      makeUserRepo() as never,
      makePubSub() as never,
      makeChannelRepo() as never,
      makeSessionRepo() as never,
      makeSessionManager() as never,
    );

    await service.execute(baseTask);

    expect(capturedStore).toBeDefined();
    // Trigger saveMessages to verify the store is bound to 'run-xyz'
    await capturedStore!.saveMessages([{ role: 'user', content: 'hello' }]);
    expect(taskRunMessageRepo.appendMany).toHaveBeenCalledWith(
      'run-xyz',
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'hello' })]),
    );
  });

  it('marks TaskRun failed when systemSettingsService.get() throws', async () => {
    const systemSettingsService = makeSystemSettingsService();
    systemSettingsService.get.mockRejectedValueOnce(new Error('settings DB down'));

    const taskRunRepo = makeTaskRunRepo();
    const taskRepo = makeTaskRepo();
    const { service } = makeService({ systemSettingsService, taskRunRepo, taskRepo });

    await service.execute({
      ...baseTask,
      schedule: { type: 'cron', expression: '0 9 * * *' },
    });

    expect(taskRunRepo.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('settings DB down'),
      }),
    );
    expect(taskRepo.incrementFailures).toHaveBeenCalled();
    expect(computeNextRun).toHaveBeenCalledWith({ type: 'cron', expression: '0 9 * * *' }, 'UTC');
    expect(taskRepo.updateNextRunAt).toHaveBeenCalled();
  });

  it('passes settings.defaultTimezone to computeNextRun after a successful run', async () => {
    const systemSettingsService = makeSystemSettingsService({
      defaultTimezone: 'Asia/Tokyo',
    });
    const task: ProcessableTask = {
      ...baseTask,
      schedule: { type: 'cron', expression: '0 9 * * *' },
    };
    const { service, taskRepo } = makeService({ systemSettingsService });

    await service.execute(task);

    expect(computeNextRun).toHaveBeenCalledWith(
      { type: 'cron', expression: '0 9 * * *' },
      'Asia/Tokyo',
    );
    expect(taskRepo.updateNextRunAt).toHaveBeenCalledWith('task-1', expect.any(Date));
  });

  // ---------------------------------------------------------------- //
  //  Race: task or run deleted while execution is in flight          //
  // ---------------------------------------------------------------- //

  describe('cascade-deletion race', () => {
    // When the user deletes a Task while a run is in flight, Postgres
    // cascade-deletes the TaskRun row too. Every subsequent post-run write
    // (taskRunRepo.update + every taskRepo.* call) hits Prisma P2025 and is
    // mapped to NotFoundError. The executor must absorb these, not surface
    // them — the scheduler is fire-and-forget, so a rejection here would
    // crash the API process.
    function applyCascadeDeleted(
      taskRepo: ReturnType<typeof makeTaskRepo>,
      taskRunRepo: ReturnType<typeof makeTaskRunRepo>,
    ): void {
      taskRunRepo.update.mockRejectedValue(new NotFoundError('TaskRun', 'unknown'));
      taskRepo.resetFailures.mockRejectedValue(new NotFoundError('Task', 'unknown'));
      taskRepo.incrementFailures.mockRejectedValue(new NotFoundError('Task', 'unknown'));
      taskRepo.updateLastRun.mockRejectedValue(new NotFoundError('Task', 'unknown'));
      taskRepo.updateNextRunAt.mockRejectedValue(new NotFoundError('Task', 'unknown'));
      taskRepo.autoDisable.mockRejectedValue(new NotFoundError('Task', 'unknown'));
    }

    it('does not throw when Task is cascade-deleted during a successful run', async () => {
      const taskRepo = makeTaskRepo();
      const taskRunRepo = makeTaskRunRepo();
      applyCascadeDeleted(taskRepo, taskRunRepo);
      const { service } = makeService({ taskRepo, taskRunRepo });

      await expect(service.execute(baseTask)).resolves.toBeUndefined();
    });

    it('does not throw when Task is cascade-deleted during a failed run', async () => {
      const agentRunner = makeAgentRunner({
        run: vi.fn().mockRejectedValue(new Error('agent crashed')),
      });
      const taskRepo = makeTaskRepo();
      const taskRunRepo = makeTaskRunRepo();
      applyCascadeDeleted(taskRepo, taskRunRepo);
      const { service } = makeService({ agentRunner, taskRepo, taskRunRepo });

      await expect(service.execute(baseTask)).resolves.toBeUndefined();
    });

    it('does not throw when Task is cascade-deleted before reaching auto-disable on max failures', async () => {
      const agentRunner = makeAgentRunner({
        run: vi.fn().mockRejectedValue(new Error('agent crashed')),
      });
      const task: ProcessableTask = { ...baseTask, consecutiveFailures: 2 };
      const taskRepo = makeTaskRepo();
      const taskRunRepo = makeTaskRunRepo();
      applyCascadeDeleted(taskRepo, taskRunRepo);
      const { service } = makeService({ agentRunner, taskRepo, taskRunRepo });

      await expect(service.execute(task)).resolves.toBeUndefined();
    });

    it('does not propagate unexpected post-run write errors to the fire-and-forget caller', async () => {
      // Non-NotFoundError errors must also be swallowed — they're logged but
      // never re-thrown, otherwise the scheduler's fire-and-forget dispatch
      // would crash the API process via unhandledRejection.
      const taskRunRepo = makeTaskRunRepo();
      taskRunRepo.update.mockRejectedValue(new Error('DB connection lost'));
      const { service } = makeService({ taskRunRepo });

      await expect(service.execute(baseTask)).resolves.toBeUndefined();
    });
  });
});
