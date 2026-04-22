import { describe, expect, it } from 'vitest';
import { computeNextRun } from '../cron-next-run.js';

describe('computeNextRun', () => {
  describe('at schedule', () => {
    it('returns the time if in the future', () => {
      const future = new Date(Date.now() + 3600000).toISOString();
      const result = computeNextRun({ type: 'at', time: future }, 'UTC');
      expect(result).toEqual(new Date(future));
    });

    it('returns null if in the past', () => {
      const past = new Date(Date.now() - 3600000).toISOString();
      const result = computeNextRun({ type: 'at', time: past }, 'UTC');
      expect(result).toBeNull();
    });
  });

  describe('every schedule', () => {
    it('computes next run from now for hours', () => {
      const result = computeNextRun({ type: 'every', interval: '1h' }, 'UTC');
      expect(result).not.toBeNull();
      const diff = result!.getTime() - Date.now();
      expect(diff).toBeGreaterThan(3595000);
      expect(diff).toBeLessThan(3605000);
    });

    it('computes next run for minutes', () => {
      const result = computeNextRun({ type: 'every', interval: '5m' }, 'UTC');
      expect(result).not.toBeNull();
      const diff = result!.getTime() - Date.now();
      expect(diff).toBeGreaterThan(295000);
      expect(diff).toBeLessThan(305000);
    });

    it('computes next run for seconds', () => {
      const result = computeNextRun({ type: 'every', interval: '60s' }, 'UTC');
      expect(result).not.toBeNull();
      const diff = result!.getTime() - Date.now();
      expect(diff).toBeGreaterThan(55000);
      expect(diff).toBeLessThan(65000);
    });

    it('returns null for invalid interval', () => {
      expect(computeNextRun({ type: 'every', interval: 'invalid' }, 'UTC')).toBeNull();
    });

    it('returns null for zero interval', () => {
      expect(computeNextRun({ type: 'every', interval: '0s' }, 'UTC')).toBeNull();
    });
  });

  describe('cron schedule', () => {
    it('computes next occurrence for hourly', () => {
      const result = computeNextRun({ type: 'cron', expression: '0 * * * *' }, 'UTC');
      expect(result).not.toBeNull();
      expect(result!.getTime()).toBeGreaterThan(Date.now());
    });

    it('respects timezone', () => {
      const result = computeNextRun(
        {
          type: 'cron',
          expression: '0 9 * * *',
          tz: 'America/New_York',
        },
        'UTC',
      );
      expect(result).not.toBeNull();
    });

    it('returns null for invalid expression', () => {
      expect(computeNextRun({ type: 'cron', expression: 'invalid' }, 'UTC')).toBeNull();
    });
  });
});

describe('computeNextRun — defaultTz fallback', () => {
  it('uses defaultTz when schedule.tz is absent', () => {
    // "0 9 * * *" = 09:00 daily. Under America/New_York that is 13:00 UTC (EST)
    // or 14:00 UTC (EDT) depending on DST. Under UTC it is 09:00 UTC.
    const nyRun = computeNextRun({ type: 'cron', expression: '0 9 * * *' }, 'America/New_York');
    const utcRun = computeNextRun({ type: 'cron', expression: '0 9 * * *' }, 'UTC');
    expect(nyRun).not.toBeNull();
    expect(utcRun).not.toBeNull();
    // NY 09:00 is UTC 13:00 or 14:00; UTC 09:00 is UTC 09:00 — always differ.
    expect(nyRun!.toISOString()).not.toBe(utcRun!.toISOString());
  });

  it('prefers explicit schedule.tz over defaultTz', () => {
    const a = computeNextRun(
      { type: 'cron', expression: '0 9 * * *', tz: 'Asia/Tokyo' },
      'America/New_York',
    );
    const b = computeNextRun({ type: 'cron', expression: '0 9 * * *', tz: 'Asia/Tokyo' }, 'UTC');
    expect(a!.toISOString()).toBe(b!.toISOString());
  });
});
