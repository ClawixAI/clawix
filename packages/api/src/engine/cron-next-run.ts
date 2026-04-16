import type { CronSchedule } from '@clawix/shared';
import { CronExpressionParser } from 'cron-parser';

/** Parse human-readable interval like "30s", "5m", "1h" into milliseconds. */
function parseIntervalToMs(interval: string): number | null {
  const match = /^(\d+)(s|m|h|d)$/.exec(interval);
  if (!match) return null;
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] ?? 1000);
}

/**
 * Compute the next run time for a cron schedule.
 * Returns null if the schedule is exhausted (one-shot in the past, invalid expression).
 */
export function computeNextRun(schedule: CronSchedule): Date | null {
  const now = Date.now();

  if (schedule.type === 'at') {
    const time = new Date(schedule.time).getTime();
    return time > now ? new Date(time) : null;
  }

  if (schedule.type === 'every') {
    const ms = parseIntervalToMs(schedule.interval);
    if (!ms || ms <= 0) return null;
    return new Date(now + ms);
  }

  if (schedule.type === 'cron') {
    try {
      const options = schedule.tz ? { tz: schedule.tz } : {};
      const interval = CronExpressionParser.parse(schedule.expression, options);
      return interval.next().toDate();
    } catch {
      return null;
    }
  }

  return null;
}
