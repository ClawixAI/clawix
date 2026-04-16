import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type { CronSchedule } from '@clawix/shared';
import { CronExpressionParser } from 'cron-parser';

import { TaskRepository } from '../db/task.repository.js';

const logger = createLogger('engine:cron-guard');

/** Parse human-readable interval like "30s", "5m", "1h" into seconds. */
function parseIntervalToSeconds(interval: string): number | null {
  const match = /^(\d+)(s|m|h|d)$/.exec(interval);
  if (!match) return null;
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit] ?? 1);
}

/** Estimate effective interval of a cron expression in seconds. */
function estimateCronIntervalSeconds(expression: string, tz?: string): number | null {
  try {
    const options = tz ? { tz } : {};
    const interval = CronExpressionParser.parse(expression, options);
    const first = interval.next().getTime();
    const second = interval.next().getTime();
    return Math.floor((second - first) / 1000);
  } catch {
    return null;
  }
}

/** Validate cron expression is parseable. */
function isValidCronExpression(expression: string, tz?: string): boolean {
  try {
    const options = tz ? { tz } : {};
    CronExpressionParser.parse(expression, options);
    return true;
  } catch {
    return false;
  }
}

/** Validate IANA timezone. */
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface GuardResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface CronContext {
  readonly isInCronExecution: boolean;
}

export interface PolicyLimits {
  readonly cronEnabled: boolean;
  readonly maxScheduledTasks: number;
  readonly minCronIntervalSecs: number;
  readonly maxTokensPerCronRun: number | null;
}

@Injectable()
export class CronGuardService {
  constructor(private readonly taskRepo: TaskRepository) {}

  async canCreate(
    userId: string,
    schedule: CronSchedule,
    context: CronContext,
    policy: PolicyLimits,
  ): Promise<GuardResult> {
    if (!policy.cronEnabled) {
      return { allowed: false, reason: 'Cron is not available on your policy' };
    }

    if (context.isInCronExecution) {
      return { allowed: false, reason: 'Cannot create cron jobs during scheduled execution' };
    }

    const activeCount = await this.taskRepo.findActiveCountByUser(userId);
    if (activeCount >= policy.maxScheduledTasks) {
      return {
        allowed: false,
        reason: `You've reached your limit of ${policy.maxScheduledTasks} scheduled tasks`,
      };
    }

    if (schedule.type === 'at') {
      const time = new Date(schedule.time).getTime();
      if (isNaN(time)) {
        return { allowed: false, reason: `Invalid date/time: ${schedule.time}` };
      }
      if (time <= Date.now()) {
        return { allowed: false, reason: 'Scheduled time is in the past' };
      }
    }

    if (schedule.type === 'every') {
      const seconds = parseIntervalToSeconds(schedule.interval);
      if (seconds === null) {
        return {
          allowed: false,
          reason: `Invalid interval format: ${schedule.interval}. Use e.g. "30s", "5m", "1h"`,
        };
      }
      if (seconds < policy.minCronIntervalSecs) {
        return {
          allowed: false,
          reason: `Minimum interval is ${policy.minCronIntervalSecs} seconds on your policy`,
        };
      }
    }

    if (schedule.type === 'cron') {
      if ('tz' in schedule && schedule.tz && !isValidTimezone(schedule.tz)) {
        return { allowed: false, reason: `Unknown timezone: ${schedule.tz}` };
      }

      const tz = 'tz' in schedule ? schedule.tz : undefined;
      if (!isValidCronExpression(schedule.expression, tz)) {
        return { allowed: false, reason: `Invalid cron expression: ${schedule.expression}` };
      }

      const intervalSecs = estimateCronIntervalSeconds(schedule.expression, tz);
      if (intervalSecs !== null && intervalSecs < policy.minCronIntervalSecs) {
        return {
          allowed: false,
          reason: `Minimum interval is ${policy.minCronIntervalSecs} seconds on your policy`,
        };
      }
    }

    logger.debug({ userId, scheduleType: schedule.type }, 'canCreate: allowed');
    return { allowed: true };
  }

  async canDispatch(
    task: {
      readonly id: string;
      readonly createdByUserId: string;
      readonly consecutiveFailures: number;
    },
    policy: PolicyLimits,
    maxConsecutiveFailures: number,
    maxConcurrentPerUser: number,
  ): Promise<GuardResult> {
    if (!policy.cronEnabled) {
      return { allowed: false, reason: 'Cron disabled on policy' };
    }

    if (task.consecutiveFailures >= maxConsecutiveFailures) {
      return {
        allowed: false,
        reason: `Max consecutive failures reached (${maxConsecutiveFailures})`,
      };
    }

    const runningCount = await this.taskRepo.findRunningCountByUser(task.createdByUserId);
    if (runningCount >= maxConcurrentPerUser) {
      return { allowed: false, reason: 'Concurrent cron run limit reached' };
    }

    logger.debug({ taskId: task.id }, 'canDispatch: allowed');
    return { allowed: true };
  }
}
