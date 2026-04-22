/**
 * Integration test: cron channel-collision isolation
 *
 * Verifies the structural guarantee that when CronTaskProcessorService executes
 * a task (even one whose channelId matches an active user Session), the cron path:
 *   - NEVER creates or accesses a Session row
 *   - NEVER invokes SessionManagerService
 *   - ALWAYS persists transcript via TaskRunMessageStore → TaskRunMessage
 *   - Passes sessionId: undefined in agentRunner.run options
 *
 * Harness style: mock-based (same as cron-task-processor.service.test.ts).
 * Fixtures are intentionally duplicated here (not imported from the processor
 * test) to avoid cross-file vi.mock hoisting interactions that cause flaky
 * failures when both files run together in a single Vitest worker.
 *
 * The processor does not inject SessionManagerService at all, so the structural
 * guarantee is enforced by construction. The tests below lock in the observable
 * evidence: messageStore type, agentRunner.run call shape, and TaskRun writes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { CronTaskProcessorService } from '../cron-task-processor.service.js';
import type { ProcessableTask } from '../cron-task-processor.service.js';
import { TaskRunMessageStore } from '../message-store/task-run-message-store.js';
import { createCronTool } from '../tools/cron.js';
import type { CronPolicy } from '../tools/cron.js';
import type { CronGuardService } from '../cron-guard.service.js';
import type { TaskRepository } from '../../db/task.repository.js';
import type { ChannelRepository } from '../../db/channel.repository.js';
import type { TaskRunRepository } from '../../db/task-run.repository.js';
import type { TaskRunMessageRepository } from '../../db/task-run-message.repository.js';

// ------------------------------------------------------------------ //
//  Minimal fixture factories (duplicated from processor test to avoid //
//  cross-file vi.mock hoisting issues when run together)             //
// ------------------------------------------------------------------ //

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

function makeTaskRunMessageRepo() {
  return {
    appendMany: vi.fn().mockResolvedValue([]),
    findByTaskRunId: vi.fn().mockResolvedValue([]),
    countByTaskRunId: vi.fn().mockResolvedValue(0),
  };
}

function makeSystemSettingsService() {
  return {
    get: vi.fn().mockResolvedValue({
      cronDefaultTokenBudget: 10000,
      cronExecutionTimeoutMs: 300000,
      cronTokenGracePercent: 10,
      defaultTimezone: 'UTC',
    }),
  };
}

function makePolicyRepo() {
  return {
    findById: vi.fn().mockResolvedValue({ maxTokensPerCronRun: null }),
  };
}

function makeUserRepo() {
  return {
    findById: vi.fn().mockResolvedValue({ policyId: 'policy-1' }),
  };
}

function makePubSub() {
  return {
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(undefined),
  };
}

// ------------------------------------------------------------------ //
//  Task fixture with a channelId that "collides" with a user Session  //
// ------------------------------------------------------------------ //

const collisionChannelId = 'channel-collision-uuid';

const taskWithChannel: ProcessableTask = {
  id: 'task-collision-1',
  agentDefinitionId: 'agent-def-1',
  createdByUserId: 'user-1',
  name: 'Cron Task With Channel',
  prompt: 'Run some automation',
  channelId: collisionChannelId,
  schedule: { type: 'every', interval: '15m' },
  consecutiveFailures: 0,
  timeoutMs: null,
};

// Helper to build the processor with all mocks wired up
function makeProcessor(
  options: {
    agentRunner?: ReturnType<typeof makeAgentRunner>;
    taskRunRepo?: ReturnType<typeof makeTaskRunRepo>;
    taskRunMessageRepo?: ReturnType<typeof makeTaskRunMessageRepo>;
  } = {},
) {
  const agentRunner = options.agentRunner ?? makeAgentRunner();
  const taskRepo = makeTaskRepo();
  const taskRunRepo = options.taskRunRepo ?? makeTaskRunRepo();
  const taskRunMessageRepo = options.taskRunMessageRepo ?? makeTaskRunMessageRepo();
  const systemSettingsService = makeSystemSettingsService();
  const policyRepo = makePolicyRepo();
  const userRepo = makeUserRepo();
  const pubsub = makePubSub();

  const processor = new CronTaskProcessorService(
    agentRunner as never,
    taskRepo as never,
    taskRunRepo as never,
    taskRunMessageRepo as never,
    systemSettingsService as never,
    policyRepo as never,
    userRepo as never,
    pubsub as never,
  );

  return {
    processor,
    agentRunner,
    taskRepo,
    taskRunRepo,
    taskRunMessageRepo,
    pubsub,
  };
}

// ------------------------------------------------------------------ //
//  Tests                                                              //
// ------------------------------------------------------------------ //

describe('cron isolation — channel collision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates TaskRunMessage rows and does NOT call sessionManager when executing cron on a channel with active user Session', async () => {
    // Arrange
    const taskRunRepo = makeTaskRunRepo({
      create: vi.fn().mockResolvedValue({ id: 'run-collision-1' }),
    });
    const taskRunMessageRepo = makeTaskRunMessageRepo();
    let capturedRunOptions: Record<string, unknown> | undefined;
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockImplementation(async (opts: Record<string, unknown>) => {
        capturedRunOptions = opts;
        return { ...successfulRunResult, output: 'automation complete' };
      }),
    });

    const { processor } = makeProcessor({ agentRunner, taskRunRepo, taskRunMessageRepo });

    // Act
    await processor.execute(taskWithChannel);

    // Assert — agentRunner.run was called exactly once
    expect(agentRunner.run).toHaveBeenCalledTimes(1);

    // Assert — the messageStore is a TaskRunMessageStore (not a SessionMessageStore)
    expect(capturedRunOptions).toBeDefined();
    expect(capturedRunOptions!['messageStore']).toBeInstanceOf(TaskRunMessageStore);

    // Assert — sessionId was NOT passed in the run options (cron is sessionless)
    expect(capturedRunOptions!['sessionId']).toBeUndefined();

    // Assert — TaskRun was created exactly once
    expect(taskRunRepo.create).toHaveBeenCalledTimes(1);
    expect(taskRunRepo.create).toHaveBeenCalledWith({
      taskId: 'task-collision-1',
      status: 'running',
    });

    // Assert — TaskRun was updated to 'completed'
    expect(taskRunRepo.update).toHaveBeenCalledWith(
      'run-collision-1',
      expect.objectContaining({ status: 'completed' }),
    );

    // Verify isolation — CronTaskProcessorService does not have SessionManagerService
    // injected in its constructor (8 constructor params, none of which is session-related).
    // The absence of SessionManagerService from the constructor means it is impossible
    // for the processor to call session management code. The test above proves that the
    // agentRunner options carry a TaskRunMessageStore (cron-scoped), not a session-scoped store.
    //
    // If anyone adds SessionManagerService to the constructor in the future, TypeScript
    // will require it to be supplied here — catching the regression at compile time.
    // The runtime check (messageStore instanceof TaskRunMessageStore) catches it at test time.
  });

  it('still uses TaskRunMessageStore (not SessionMessage) on the failure path', async () => {
    // Arrange — agentRunner throws to simulate agent crash
    const taskRunRepo = makeTaskRunRepo({
      create: vi.fn().mockResolvedValue({ id: 'run-fail-1' }),
    });
    let capturedRunOptions: Record<string, unknown> | undefined;
    const agentRunner = makeAgentRunner({
      run: vi.fn().mockImplementation(async (opts: Record<string, unknown>) => {
        capturedRunOptions = opts;
        throw new Error('boom');
      }),
    });

    const { processor } = makeProcessor({ agentRunner, taskRunRepo });

    // Act — must not throw; processor swallows and records the error
    await expect(processor.execute(taskWithChannel)).resolves.toBeUndefined();

    // Assert — agentRunner.run was still called once
    expect(agentRunner.run).toHaveBeenCalledTimes(1);

    // Assert — the messageStore given to the agent was still a TaskRunMessageStore
    expect(capturedRunOptions!['messageStore']).toBeInstanceOf(TaskRunMessageStore);

    // Assert — TaskRun was created
    expect(taskRunRepo.create).toHaveBeenCalledWith({
      taskId: 'task-collision-1',
      status: 'running',
    });

    // Assert — TaskRun was updated to 'failed' with the error string
    expect(taskRunRepo.update).toHaveBeenCalledWith(
      'run-fail-1',
      expect.objectContaining({
        status: 'failed',
        error: 'boom',
      }),
    );

    // Assert — sessionId was absent even on the failure path
    expect(capturedRunOptions!['sessionId']).toBeUndefined();
  });
});

// ------------------------------------------------------------------ //
//  Helpers for cron tool integration tests                           //
// ------------------------------------------------------------------ //

const CRON_TOOL_USER_ID = 'u1';
const CRON_TOOL_AGENT_DEF_ID = 'a1';
const CRON_TOOL_TASK_ID = 'daily-research';
const CRON_TOOL_RUN_ID = 'run-yesterday';

const CRON_TOOL_POLICY: CronPolicy = {
  cronEnabled: true,
  maxScheduledTasks: 10,
  minCronIntervalSecs: 60,
  maxTokensPerCronRun: null,
};

const seededTask = {
  id: CRON_TOOL_TASK_ID,
  name: 'Daily research',
  agentDefinitionId: CRON_TOOL_AGENT_DEF_ID,
  createdByUserId: CRON_TOOL_USER_ID,
  schedule: { type: 'every', interval: '24h' },
  prompt: "Give me today's research",
  channelId: null,
  enabled: true,
  nextRunAt: null,
  lastRunAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  lastStatus: 'completed',
  consecutiveFailures: 0,
  disabledReason: null,
  timeoutMs: null,
  createdAt: new Date('2026-04-18T00:00:00Z'),
  updatedAt: new Date('2026-04-18T00:00:00Z'),
};

const seededRun = {
  id: CRON_TOOL_RUN_ID,
  taskId: CRON_TOOL_TASK_ID,
  status: 'completed',
  startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 5000),
  durationMs: 5000,
  tokenUsage: { inputTokens: 100, outputTokens: 300 },
  output: 'Top stories: AI breakthroughs and market news.',
  error: null,
};

const seededMessages = [
  {
    id: 'msg-1',
    taskRunId: CRON_TOOL_RUN_ID,
    ordering: 0,
    role: 'user',
    content: "Give me today's research",
    toolCallId: null,
    toolCalls: null,
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  },
  {
    id: 'msg-2',
    taskRunId: CRON_TOOL_RUN_ID,
    ordering: 1,
    role: 'assistant',
    content: 'Top stories: AI breakthroughs and market news.',
    toolCallId: null,
    toolCalls: null,
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 4000),
  },
];

function makeCronToolTaskRepo(
  overrides: {
    findById?: ReturnType<typeof vi.fn>;
    findByUser?: ReturnType<typeof vi.fn>;
  } = {},
): TaskRepository {
  return {
    findById: overrides.findById ?? vi.fn().mockResolvedValue(seededTask),
    findByUser: overrides.findByUser ?? vi.fn().mockResolvedValue([seededTask]),
    findAll: vi.fn(),
    findEnabled: vi.fn(),
    findDue: vi.fn(),
    findActiveCountByUser: vi.fn(),
    findRunningCountByUser: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateLastRun: vi.fn(),
    incrementFailures: vi.fn(),
    resetFailures: vi.fn(),
    autoDisable: vi.fn(),
    updateNextRunAt: vi.fn(),
  } as unknown as TaskRepository;
}

function makeCronToolChannelRepo(): ChannelRepository {
  return {
    findByType: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    findAll: vi.fn(),
    findActive: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as ChannelRepository;
}

function makeCronToolGuard(): CronGuardService {
  return {
    canCreate: vi.fn().mockResolvedValue({ allowed: true }),
    canDispatch: vi.fn(),
  } as unknown as CronGuardService;
}

function makeCronToolRunRepo(
  overrides: {
    findByTaskIdWithLimit?: ReturnType<typeof vi.fn>;
    findById?: ReturnType<typeof vi.fn>;
  } = {},
): TaskRunRepository {
  return {
    findByTaskIdWithLimit:
      overrides.findByTaskIdWithLimit ?? vi.fn().mockResolvedValue([seededRun]),
    findById: overrides.findById ?? vi.fn().mockResolvedValue(seededRun),
    findAll: vi.fn(),
    findByTaskId: vi.fn(),
    findLatestByTaskId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    markOrphanedRuns: vi.fn(),
    delete: vi.fn(),
  } as unknown as TaskRunRepository;
}

function makeCronToolRunMessageRepo(
  overrides: {
    findByTaskRunId?: ReturnType<typeof vi.fn>;
  } = {},
): TaskRunMessageRepository {
  return {
    findByTaskRunId: overrides.findByTaskRunId ?? vi.fn().mockResolvedValue(seededMessages),
    appendMany: vi.fn(),
    countByTaskRunId: vi.fn(),
  } as unknown as TaskRunMessageRepository;
}

function buildCronTool(userId: string = CRON_TOOL_USER_ID) {
  return createCronTool(
    makeCronToolGuard(),
    makeCronToolTaskRepo(),
    makeCronToolChannelRepo(),
    userId,
    CRON_TOOL_AGENT_DEF_ID,
    CRON_TOOL_POLICY,
    /* isInCronExecution */ false,
    /* sessionChannelId */ null,
    makeCronToolRunRepo(),
    makeCronToolRunMessageRepo(),
    'UTC',
  );
}

// ------------------------------------------------------------------ //
//  Tests: user follow-up via cron tool                               //
// ------------------------------------------------------------------ //

describe('cron isolation — user follow-up via cron tool', () => {
  it('runs action lets a user-session agent list prior runs of their own task', async () => {
    const tool = buildCronTool();

    const result = await tool.execute({
      action: 'runs',
      jobId: CRON_TOOL_TASK_ID,
      limit: 10,
    });

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output) as { runs: Record<string, unknown>[] };
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0]!['runId']).toBe(CRON_TOOL_RUN_ID);
    expect(parsed.runs[0]!['status']).toBe('completed');
    expect(typeof parsed.runs[0]!['output']).toBe('string');
    expect(parsed.runs[0]!['output'] as string).toContain('Top stories');
  });

  it('runDetail action returns the full transcript', async () => {
    const tool = buildCronTool();

    const result = await tool.execute({
      action: 'runDetail',
      jobId: CRON_TOOL_TASK_ID,
      runId: CRON_TOOL_RUN_ID,
    });

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output) as {
      runId: string;
      status: string;
      output: string;
      messages: { role: string; content: string }[];
    };
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]!.role).toBe('user');
    expect(parsed.messages[1]!.role).toBe('assistant');
    expect(parsed.messages[1]!.content).toContain('Top stories');
    expect(parsed.output).toBe('Top stories: AI breakthroughs and market news.');
  });

  it('ownership prevents a different user from retrieving the transcript', async () => {
    // Build the cron tool with a taskRepo that returns the seeded task owned by 'u1',
    // but bind the tool to 'other-user'. The ownership check in runDetail will reject.
    const otherUserTaskRepo = makeCronToolTaskRepo({
      findById: vi.fn().mockResolvedValue(seededTask), // seededTask.createdByUserId === 'u1'
    });

    const tool = createCronTool(
      makeCronToolGuard(),
      otherUserTaskRepo,
      makeCronToolChannelRepo(),
      'other-user',
      CRON_TOOL_AGENT_DEF_ID,
      CRON_TOOL_POLICY,
      false,
      null,
      makeCronToolRunRepo(),
      makeCronToolRunMessageRepo(),
      'UTC',
    );

    const result = await tool.execute({
      action: 'runDetail',
      jobId: CRON_TOOL_TASK_ID,
      runId: CRON_TOOL_RUN_ID,
    });

    expect(result.isError).toBe(true);
    expect(result.output.toLowerCase()).toContain('not found');
  });
});
