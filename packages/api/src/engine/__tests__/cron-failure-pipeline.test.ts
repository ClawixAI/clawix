import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ------------------------------------------------------------------ //
//  Module mocks                                                        //
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

import { CronTaskProcessorService } from '../cron-task-processor.service.js';
import type { ProcessableTask } from '../cron-task-processor.service.js';
import { ChannelManagerService } from '../../channels/channel-manager.service.js';

// ------------------------------------------------------------------ //
//  In-memory pubsub double                                            //
// ------------------------------------------------------------------ //

/**
 * In-memory pubsub double for integration tests.
 *
 * Diverges from the production RedisPubSubService in two ways:
 *   1. Synchronous delivery — `publish` awaits each subscriber sequentially,
 *      whereas production fires-and-forgets via `.catch(...)`.
 *   2. No JSON round-trip — payloads are passed by reference, so non-JSON
 *      values (Date, Map, BigInt, undefined fields) silently work here but
 *      would break in production.
 *
 * Both deviations are benign for the current cron-failure payload (plain
 * strings + booleans). Add JSON.parse(JSON.stringify(...)) here if a future
 * payload introduces non-serializable types.
 */
function makeInMemoryPubsub() {
  const subscribers = new Map<string, ((msg: { payload: unknown }) => void | Promise<void>)[]>();
  return {
    publish: vi.fn(async (channel: string, payload: unknown) => {
      const subs = subscribers.get(channel) ?? [];
      for (const sub of subs) {
        await sub({ payload });
      }
      return subs.length;
    }),
    subscribe: vi.fn(
      async (
        channel: string,
        cb: (msg: { payload: unknown }) => void | Promise<void>,
      ): Promise<void> => {
        const list = subscribers.get(channel) ?? [];
        list.push(cb);
        subscribers.set(channel, list);
      },
    ),
  };
}

// ------------------------------------------------------------------ //
//  Test                                                               //
// ------------------------------------------------------------------ //

describe('cron failure pipeline (processor → pubsub → channel-manager → adapter)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Pin CRON_MAX_TIMEOUT_MS so the friendly message ("10-minute limit") is
    // stable regardless of the host shell. (CRON_MAX_TIMEOUT_MS is read on
    // each execute() call, so the stub is effective.)
    // MAX_CONSECUTIVE_FAILURES is frozen at module load — it can't be pinned
    // here, but isn't load-bearing for this test (consecutiveFailures: 0 is
    // below any reasonable threshold).
    vi.stubEnv('CRON_MAX_TIMEOUT_MS', '900000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('delivers a friendly failure message to the bound channel when the agent run times out', async () => {
    const pubsub = makeInMemoryPubsub();

    // ---- Build the channel-manager wiring ---- //
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const fakeAdapter = {
      id: 'ch-telegram',
      type: 'telegram',
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      sendMessage,
      onMessage: vi.fn(),
    };

    const channelRepo = {
      findActive: vi
        .fn()
        .mockResolvedValue([
          { id: 'ch-telegram', type: 'telegram', name: 'Bot', config: {}, isActive: true },
        ]),
      findByType: vi.fn().mockResolvedValue([{ id: 'web-ch', type: 'web' }]),
      create: vi.fn(),
    };
    const registry = {
      create: vi.fn().mockReturnValue(fakeAdapter),
      getRegistered: vi.fn().mockReturnValue(['telegram']),
    };
    const router = { handleInbound: vi.fn() };
    const sessionRepo = { findById: vi.fn() };
    const userRepo = {
      findById: vi.fn().mockImplementation(async (id: string) => ({
        id,
        policyId: 'policy-1',
        telegramId: '12345',
      })),
    };

    const manager = new ChannelManagerService(
      channelRepo as never,
      registry as never,
      router as never,
      pubsub as never,
      sessionRepo as never,
      userRepo as never,
    );
    await manager.onModuleInit();

    // ---- Build the processor wiring ---- //
    const agentRunner = {
      run: vi.fn().mockRejectedValue(new Error('execution_timeout')),
    };
    const taskRepo = {
      updateLastRun: vi.fn().mockResolvedValue({}),
      incrementFailures: vi.fn().mockResolvedValue({}),
      resetFailures: vi.fn().mockResolvedValue({}),
      autoDisable: vi.fn().mockResolvedValue({}),
      updateNextRunAt: vi.fn().mockResolvedValue({}),
    };
    const taskRunRepo = {
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
      update: vi.fn().mockResolvedValue({}),
    };
    const taskRunMessageRepo = {
      appendMany: vi.fn().mockResolvedValue([]),
      findByTaskRunId: vi.fn().mockResolvedValue([]),
      countByTaskRunId: vi.fn().mockResolvedValue(0),
    };
    const systemSettingsService = {
      get: vi.fn().mockResolvedValue({
        cronDefaultTokenBudget: 10000,
        cronExecutionTimeoutMs: 600_000, // 10 minutes
        cronTokenGracePercent: 10,
        defaultTimezone: 'UTC',
      }),
    };
    const policyRepo = {
      findById: vi.fn().mockResolvedValue({ maxTokensPerCronRun: null }),
    };

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

    const task: ProcessableTask = {
      id: 'task-1',
      agentDefinitionId: 'agent-def-1',
      createdByUserId: 'user-1',
      name: 'Daily Report',
      prompt: 'Generate the daily report',
      channelId: 'ch-telegram',
      schedule: { type: 'every', interval: '1d' },
      consecutiveFailures: 0,
      timeoutMs: null,
    };

    // ---- Execute and verify ---- //
    await processor.execute(task);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      recipientId: '12345',
      text: '⚠️ Task "Daily Report" failed: your scheduled task hit the 10-minute limit and was stopped.',
    });
  });
});
