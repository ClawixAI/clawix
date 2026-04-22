import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type { CreateTaskInput, UpdateTaskInput } from '@clawix/shared';

import { TaskRepository } from '../db/task.repository.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { CronGuardService } from '../engine/cron-guard.service.js';
import { computeNextRun } from '../engine/cron-next-run.js';
import { SystemSettingsService } from '../system-settings/system-settings.service.js';

const logger = createLogger('tasks:service');

@Injectable()
export class TasksService {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly cronGuard: CronGuardService,
    private readonly policyRepo: PolicyRepository,
    private readonly userRepo: UserRepository,
    private readonly systemSettingsService: SystemSettingsService,
  ) {}

  async findAll(userId: string, pagination: { page: number; limit: number }) {
    logger.debug({ userId }, 'findAll tasks');
    return this.taskRepo.findAll(pagination);
  }

  async findById(id: string) {
    logger.debug({ id }, 'findById task');
    return this.taskRepo.findById(id);
  }

  async create(userId: string, input: CreateTaskInput) {
    const settings = await this.systemSettingsService.get();
    const defaultTz = settings.defaultTimezone;

    const user = await this.userRepo.findById(userId);
    const policy = await this.policyRepo.findById(user.policyId);

    const guardResult = await this.cronGuard.canCreate(
      userId,
      input.schedule,
      { isInCronExecution: false },
      {
        cronEnabled: policy.cronEnabled,
        maxScheduledTasks: policy.maxScheduledTasks,
        minCronIntervalSecs: policy.minCronIntervalSecs,
        maxTokensPerCronRun: policy.maxTokensPerCronRun,
      },
      defaultTz,
    );

    if (!guardResult.allowed) {
      throw new Error(guardResult.reason ?? 'Task creation denied');
    }

    const task = await this.taskRepo.create({
      ...input,
      createdByUserId: userId,
      channelId: input.channelId ?? null,
    });

    // Compute and set initial nextRunAt
    const nextRunAt = computeNextRun(input.schedule, defaultTz);
    if (nextRunAt) {
      await this.taskRepo.updateNextRunAt(task.id, nextRunAt);
    }

    logger.debug({ taskId: task.id, userId }, 'task created');
    return task;
  }

  async update(id: string, userId: string, input: UpdateTaskInput) {
    const task = await this.taskRepo.findById(id);
    if (task.createdByUserId !== userId) {
      throw new Error('Not authorized to update this task');
    }

    // When the schedule changes, re-validate it under the org TZ and
    // recompute nextRunAt — avoids bypassing the at-offset rule and other
    // shape checks that canCreate enforces on create.
    let defaultTz: string | undefined;
    if (input.schedule) {
      const settings = await this.systemSettingsService.get();
      defaultTz = settings.defaultTimezone;

      const user = await this.userRepo.findById(userId);
      const policy = await this.policyRepo.findById(user.policyId);

      const guardResult = await this.cronGuard.canUpdate(
        input.schedule,
        {
          cronEnabled: policy.cronEnabled,
          maxScheduledTasks: policy.maxScheduledTasks,
          minCronIntervalSecs: policy.minCronIntervalSecs,
          maxTokensPerCronRun: policy.maxTokensPerCronRun,
        },
        defaultTz,
      );

      if (!guardResult.allowed) {
        throw new Error(guardResult.reason ?? 'Task update denied');
      }
    }

    const result = await this.taskRepo.update(id, input);

    if (input.schedule && defaultTz) {
      const nextRunAt = computeNextRun(input.schedule, defaultTz);
      await this.taskRepo.updateNextRunAt(id, nextRunAt);
    }

    // Reset failures when user edits the job
    if (task.consecutiveFailures > 0) {
      await this.taskRepo.resetFailures(id);
    }

    logger.debug({ taskId: id, userId }, 'task updated');
    return result;
  }

  async remove(id: string, userId: string) {
    const task = await this.taskRepo.findById(id);
    if (task.createdByUserId !== userId) {
      throw new Error('Not authorized to remove this task');
    }

    logger.debug({ taskId: id, userId }, 'task removed');
    return this.taskRepo.delete(id);
  }
}
