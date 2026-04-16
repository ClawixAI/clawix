import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HealthIndicatorService } from '@nestjs/terminus';
import { RedisHealthIndicator } from '../redis.health-indicator.js';
import type { RedisService } from '../../cache/redis.service.js';

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let redis: { ping: ReturnType<typeof vi.fn> };
  let upFn: ReturnType<typeof vi.fn>;
  let downFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    redis = { ping: vi.fn() };
    upFn = vi.fn().mockReturnValue({ redis: { status: 'up' } });
    downFn = vi.fn().mockImplementation((details) => ({ redis: { status: 'down', ...details } }));

    const healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upFn, down: downFn }),
    } as unknown as HealthIndicatorService;

    indicator = new RedisHealthIndicator(redis as unknown as RedisService, healthIndicatorService);
  });

  it('returns up when Redis responds with pong', async () => {
    redis.ping.mockResolvedValue(true);

    const result = await indicator.isHealthy('redis');

    expect(result).toMatchObject({ redis: { status: 'up' } });
    expect(upFn).toHaveBeenCalled();
  });

  it('returns down when Redis ping returns false', async () => {
    redis.ping.mockResolvedValue(false);

    const result = await indicator.isHealthy('redis');

    expect(result).toMatchObject({
      redis: { status: 'down', message: 'Redis ping failed' },
    });
  });

  it('returns down when Redis ping throws', async () => {
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await indicator.isHealthy('redis');

    expect(result).toMatchObject({
      redis: { status: 'down', message: 'ECONNREFUSED' },
    });
  });
});
