import { Injectable } from '@nestjs/common';
import { createLogger, NotFoundError, type SystemSettingsInput } from '@clawix/shared';

import { TaskRepository } from '../db/task.repository.js';
import { TaskRunRepository } from '../db/task-run.repository.js';
import { TaskRunMessageRepository } from '../db/task-run-message.repository.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { TaskRunMessageStore } from './message-store/task-run-message-store.js';
import { computeNextRun } from './cron-next-run.js';
import { SystemSettingsService } from '../system-settings/system-settings.service.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { RedisPubSubService } from '../cache/redis-pubsub.service.js';
import { PUBSUB_CHANNELS } from '../cache/cache.constants.js';
import { translateCronError } from './cron-error-messages.js';

const logger = createLogger('engine:cron-task-processor');

export const MAX_CONSECUTIVE_FAILURES = parseInt(
  process.env['MAX_CONSECUTIVE_FAILURES'] ?? '3',
  10,
);

export interface ProcessableTask {
  readonly id: string;
  readonly agentDefinitionId: string;
  readonly createdByUserId: string;
  readonly name: string;
  readonly prompt: string;
  readonly channelId: string | null;
  readonly schedule: { readonly type: string; readonly [key: string]: unknown };
  readonly consecutiveFailures: number;
  readonly timeoutMs: number | null;
}

@Injectable()
export class CronTaskProcessorService {
  constructor(
    private readonly agentRunner: AgentRunnerService,
    private readonly taskRepo: TaskRepository,
    private readonly taskRunRepo: TaskRunRepository,
    private readonly taskRunMessageRepo: TaskRunMessageRepository,
    private readonly systemSettingsService: SystemSettingsService,
    private readonly policyRepo: PolicyRepository,
    private readonly userRepo: UserRepository,
    private readonly pubsub: RedisPubSubService,
  ) {}

  async execute(task: ProcessableTask): Promise<void> {
    try {
      await this.executeInternal(task);
    } catch (err) {
      // The Task or its TaskRun row was deleted while this run was in flight
      // (Task.delete cascades to TaskRun). Every post-run write then maps the
      // resulting Prisma P2025 to NotFoundError. Treat that as benign and
      // exit cleanly — there's nothing to update anymore.
      if (err instanceof NotFoundError) {
        logger.warn(
          { taskId: task.id, err: err.message },
          'cron:task or run deleted during execution; skipped post-run updates',
        );
        return;
      }
      // The scheduler dispatches with fire-and-forget, so re-throwing here
      // would surface as an unhandled rejection and crash the API process.
      // Log and swallow — restart-on-crash is a strictly worse failure mode
      // than logging an isolated cron write error.
      logger.error(
        { taskId: task.id, err },
        'cron:execute failed unexpectedly; not propagating to caller',
      );
    }
  }

  private async executeInternal(task: ProcessableTask): Promise<void> {
    const startedAt = new Date();
    logger.info({ taskId: task.id, name: task.name }, 'cron:executing');

    // Create TaskRun record
    const taskRun = await this.taskRunRepo.create({
      taskId: task.id,
      status: 'running',
    });

    let settings: SystemSettingsInput | undefined;
    // Hoisted so the failure branch can pass the actual applied timeout to
    // translateCronError. Initialized to a safe default before settings load.
    const maxTimeoutMs = parseInt(process.env['CRON_MAX_TIMEOUT_MS'] ?? '900000', 10);
    let effectiveTimeoutMs = maxTimeoutMs;

    try {
      settings = await this.systemSettingsService.get();
      const defaultTz = settings.defaultTimezone;

      // Compute effective timeout
      const timeoutMs = task.timeoutMs ?? settings.cronExecutionTimeoutMs;
      effectiveTimeoutMs = Math.min(timeoutMs, maxTimeoutMs);

      // Resolve token budget. Cascade: policy override → system default → null.
      // null at any layer means "no enforcement" (the runner skips creating a
      // BudgetTracker). Policy null falls through to system default.
      const user = await this.userRepo.findById(task.createdByUserId);
      const policy = await this.policyRepo.findById(user.policyId);
      const tokenBudget: number | null =
        policy.maxTokensPerCronRun ?? settings.cronDefaultTokenBudget;
      const tokenGracePercent = settings.cronTokenGracePercent;

      // Race agent run against timeout (clear timer on resolution to prevent leak)
      let timeoutHandle: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error('execution_timeout'));
        }, effectiveTimeoutMs);
      });

      const messageStore = new TaskRunMessageStore(this.taskRunMessageRepo, taskRun.id);

      let result;
      try {
        result = await Promise.race([
          this.agentRunner.run({
            agentDefinitionId: task.agentDefinitionId,
            userId: task.createdByUserId,
            input: task.prompt,
            isScheduledTask: true,
            channel: 'internal',
            chatId: `cron:${task.id}`,
            userName: 'CronScheduler',
            tokenBudget,
            tokenGracePercent,
            messageStore,
            outputMode: 'fullTranscript',
            // Forward the cron deadline into the reasoning loop so its own
            // AbortController fires first and cancels the in-flight LLM
            // request cleanly. The Promise.race below remains a defense-in-
            // depth backstop in case the inner timeout misbehaves.
            timeoutMs: effectiveTimeoutMs,
          }),
          timeoutPromise,
        ]);
      } finally {
        clearTimeout(timeoutHandle!);
      }

      // Token budget exceeded is surfaced as a failed status in RunResult
      if (result.error === 'token_budget_exceeded') {
        throw new Error('token_budget_exceeded');
      }

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      // Update TaskRun as completed
      await this.taskRunRepo.update(taskRun.id, {
        status: 'completed',
        output: result.output ?? undefined,
        tokenUsage: {
          inputTokens: result.tokenUsage?.inputTokens ?? 0,
          outputTokens: result.tokenUsage?.outputTokens ?? 0,
        },
        durationMs,
        completedAt,
      });

      // Reset failure counter on success
      await this.taskRepo.resetFailures(task.id);
      await this.taskRepo.updateLastRun(task.id, 'completed', completedAt);

      // Compute and set next run (or disable one-time tasks)
      const nextRunAt = computeNextRun(task.schedule as never, defaultTz);
      if (nextRunAt) {
        await this.taskRepo.updateNextRunAt(task.id, nextRunAt);
      } else {
        // One-time `at` task or exhausted schedule — disable after execution
        await this.taskRepo.autoDisable(task.id, 'auto:one_time_completed');
        logger.info({ taskId: task.id }, 'cron:one-time task completed and disabled');
      }

      logger.info({ taskId: task.id, durationMs }, 'cron:completed');

      // Deliver result to channel if configured
      if (task.channelId && result.output) {
        await this.pubsub.publish(PUBSUB_CHANNELS.cronResultReady, {
          status: 'success',
          channelId: task.channelId,
          userId: task.createdByUserId,
          taskId: task.id,
          taskName: task.name,
          output: result.output,
        });
      }
    } catch (error) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update TaskRun as failed (raw error preserved verbatim)
      await this.taskRunRepo.update(taskRun.id, {
        status: 'failed',
        error: errorMessage,
        durationMs,
        completedAt,
      });

      // Increment failures and update last run
      await this.taskRepo.incrementFailures(task.id);
      await this.taskRepo.updateLastRun(task.id, 'failed', completedAt);

      const autoDisabled = task.consecutiveFailures + 1 >= MAX_CONSECUTIVE_FAILURES;
      if (autoDisabled) {
        await this.taskRepo.autoDisable(task.id, 'auto:max_failures');
        logger.warn(
          { taskId: task.id, failures: task.consecutiveFailures + 1 },
          'cron:auto-disabled after max consecutive failures',
        );
      } else {
        // Compute next run only if not auto-disabled
        const defaultTzForNextRun = settings?.defaultTimezone ?? 'UTC';
        if (!settings) {
          logger.warn(
            { taskId: task.id },
            'cron:settings unavailable, falling back to UTC for nextRunAt',
          );
        }
        const nextRunAt = computeNextRun(task.schedule as never, defaultTzForNextRun);
        await this.taskRepo.updateNextRunAt(task.id, nextRunAt);
      }

      logger.error({ taskId: task.id, error: errorMessage, durationMs }, 'cron:failed');

      // Notify the bound channel of the failure (silent for headless tasks)
      if (task.channelId) {
        const friendly = translateCronError(errorMessage, { timeoutMs: effectiveTimeoutMs });
        let message = `⚠️ Task "${task.name}" failed: ${friendly}`;
        if (autoDisabled) {
          message += `\n🛑 Task disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Re-enable it from the dashboard.`;
        }
        await this.pubsub.publish(PUBSUB_CHANNELS.cronResultReady, {
          status: 'failed',
          channelId: task.channelId,
          userId: task.createdByUserId,
          taskId: task.id,
          taskName: task.name,
          message,
          autoDisabled,
        });
      }
    }
  }
}
