import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import { TaskRepository } from '../db/task.repository.js';
import { TaskRunRepository } from '../db/task-run.repository.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { computeNextRun } from './cron-next-run.js';
import { SystemSettingsService } from '../system-settings/system-settings.service.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { RedisPubSubService } from '../cache/redis-pubsub.service.js';
import { PUBSUB_CHANNELS } from '../cache/cache.constants.js';

const logger = createLogger('engine:cron-task-processor');

const MAX_CONSECUTIVE_FAILURES = parseInt(process.env['MAX_CONSECUTIVE_FAILURES'] ?? '3', 10);

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
    private readonly systemSettingsService: SystemSettingsService,
    private readonly policyRepo: PolicyRepository,
    private readonly userRepo: UserRepository,
    private readonly pubsub: RedisPubSubService,
  ) {}

  async execute(task: ProcessableTask): Promise<void> {
    const startedAt = new Date();
    logger.info({ taskId: task.id, name: task.name }, 'cron:executing');

    // Create TaskRun record
    const taskRun = await this.taskRunRepo.create({
      taskId: task.id,
      status: 'running',
    });

    try {
      // Compute effective timeout
      const settings = await this.systemSettingsService.get();
      const timeoutMs = task.timeoutMs ?? settings.cronExecutionTimeoutMs;

      // Resolve token budget from plan + system settings
      const user = await this.userRepo.findById(task.createdByUserId);
      const policy = await this.policyRepo.findById(user.policyId);
      const tokenBudget = policy.maxTokensPerCronRun ?? settings.cronDefaultTokenBudget;
      const tokenGracePercent = settings.cronTokenGracePercent;
      const maxTimeoutMs = parseInt(process.env['CRON_MAX_TIMEOUT_MS'] ?? '900000', 10);
      const effectiveTimeout = Math.min(timeoutMs, maxTimeoutMs);

      // Race agent run against timeout (clear timer on resolution to prevent leak)
      let timeoutHandle: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error('execution_timeout'));
        }, effectiveTimeout);
      });

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
      const nextRunAt = computeNextRun(task.schedule as never);
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

      // Update TaskRun as failed
      await this.taskRunRepo.update(taskRun.id, {
        status: 'failed',
        error: errorMessage,
        durationMs,
        completedAt,
      });

      // Increment failures and update last run
      await this.taskRepo.incrementFailures(task.id);
      await this.taskRepo.updateLastRun(task.id, 'failed', completedAt);

      // Auto-disable after max consecutive failures (+1 because increment just ran)
      if (task.consecutiveFailures + 1 >= MAX_CONSECUTIVE_FAILURES) {
        await this.taskRepo.autoDisable(task.id, 'auto:max_failures');
        logger.warn(
          { taskId: task.id, failures: task.consecutiveFailures + 1 },
          'cron:auto-disabled after max consecutive failures',
        );
      } else {
        // Compute next run only if not auto-disabled
        const nextRunAt = computeNextRun(task.schedule as never);
        await this.taskRepo.updateNextRunAt(task.id, nextRunAt);
      }

      logger.error({ taskId: task.id, error: errorMessage, durationMs }, 'cron:failed');
    }
  }
}
