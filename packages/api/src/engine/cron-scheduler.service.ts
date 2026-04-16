import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import { TaskRepository } from '../db/task.repository.js';
import { TaskRunRepository } from '../db/task-run.repository.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { CronGuardService } from './cron-guard.service.js';
import { CronTaskProcessorService } from './cron-task-processor.service.js';
import type { ProcessableTask } from './cron-task-processor.service.js';

const logger = createLogger('engine:cron-scheduler');

const SCHEDULER_POLL_INTERVAL = parseInt(process.env['SCHEDULER_POLL_INTERVAL'] ?? '30000', 10);
const SCHEDULER_BATCH_SIZE = parseInt(process.env['SCHEDULER_BATCH_SIZE'] ?? '10', 10);
const MAX_CONCURRENT_CRON_RUNS_GLOBAL = parseInt(
  process.env['MAX_CONCURRENT_CRON_RUNS_GLOBAL'] ?? '20',
  10,
);
const MAX_CONCURRENT_CRON_RUNS_PER_USER = parseInt(
  process.env['MAX_CONCURRENT_CRON_RUNS_PER_USER'] ?? '2',
  10,
);
const MAX_CONSECUTIVE_FAILURES = parseInt(process.env['MAX_CONSECUTIVE_FAILURES'] ?? '3', 10);
const CRON_MAX_TIMEOUT_MS = parseInt(process.env['CRON_MAX_TIMEOUT_MS'] ?? '900000', 10);

@Injectable()
export class CronSchedulerService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private runningCount = 0;

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly taskRunRepo: TaskRunRepository,
    private readonly cronGuard: CronGuardService,
    private readonly taskProcessor: CronTaskProcessorService,
    private readonly policyRepo: PolicyRepository,
    private readonly userRepo: UserRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recoverOrphanedRuns();
    this.start();
  }

  private async recoverOrphanedRuns(): Promise<void> {
    try {
      const count = await this.taskRunRepo.markOrphanedRuns(CRON_MAX_TIMEOUT_MS);
      if (count > 0) {
        logger.warn({ count }, 'cron:recovered orphaned TaskRuns on startup');
      }
    } catch (err) {
      logger.error({ err }, 'cron:orphan recovery failed — continuing startup');
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.timer) return;
    logger.info(
      { pollInterval: SCHEDULER_POLL_INTERVAL, batchSize: SCHEDULER_BATCH_SIZE },
      'cron:scheduler started',
    );
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        logger.error({ err }, 'cron:tick error');
      });
    }, SCHEDULER_POLL_INTERVAL);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('cron:scheduler stopped');
    }
  }

  async tick(): Promise<void> {
    const availableSlots = Math.min(
      SCHEDULER_BATCH_SIZE,
      MAX_CONCURRENT_CRON_RUNS_GLOBAL - this.runningCount,
    );
    if (availableSlots <= 0) {
      logger.debug({ running: this.runningCount }, 'cron:tick skipped — no available slots');
      return;
    }

    const dueTasks = await this.taskRepo.findDue(new Date(), availableSlots);
    if (dueTasks.length === 0) return;

    let dispatched = 0;
    let deferred = 0;

    for (const task of dueTasks) {
      if (dispatched >= availableSlots) {
        deferred++;
        continue;
      }

      // Skip tasks with no owner — cannot resolve plan limits without a user
      if (!task.createdByUserId) {
        logger.warn({ taskId: task.id }, 'cron:dispatch skipped — no createdByUserId');
        deferred++;
        continue;
      }

      try {
        const user = await this.userRepo.findById(task.createdByUserId);
        const policy = await this.policyRepo.findById(user.policyId);

        const guardResult = await this.cronGuard.canDispatch(
          {
            id: task.id,
            createdByUserId: task.createdByUserId,
            consecutiveFailures: task.consecutiveFailures,
          },
          {
            cronEnabled: policy.cronEnabled,
            maxScheduledTasks: policy.maxScheduledTasks,
            minCronIntervalSecs: policy.minCronIntervalSecs,
            maxTokensPerCronRun: policy.maxTokensPerCronRun,
          },
          MAX_CONSECUTIVE_FAILURES,
          MAX_CONCURRENT_CRON_RUNS_PER_USER,
        );

        if (!guardResult.allowed) {
          logger.info({ taskId: task.id, reason: guardResult.reason }, 'cron:dispatch skipped');
          deferred++;
          continue;
        }

        dispatched++;
        this.runningCount++;

        // Fire and forget — processor handles its own error logging
        this.taskProcessor.execute(task as unknown as ProcessableTask).finally(() => {
          this.runningCount--;
        });
      } catch (err) {
        logger.error({ taskId: task.id, err }, 'cron:dispatch error');
        deferred++;
      }
    }

    if (dispatched > 0 || deferred > 0) {
      logger.info({ dispatched, deferred, running: this.runningCount }, 'cron:tick');
    }
  }
}
