import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HealthCheckService } from '@nestjs/terminus';
import { HealthController } from '../health.controller.js';
import type { PrismaHealthIndicator } from '../prisma.health-indicator.js';
import type { RedisHealthIndicator } from '../redis.health-indicator.js';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: { check: ReturnType<typeof vi.fn> };
  let prismaHealth: { isHealthy: ReturnType<typeof vi.fn> };
  let redisHealth: { isHealthy: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prismaHealth = {
      isHealthy: vi.fn().mockResolvedValue({ database: { status: 'up' } }),
    };
    redisHealth = {
      isHealthy: vi.fn().mockResolvedValue({ redis: { status: 'up' } }),
    };
    healthCheckService = {
      check: vi.fn().mockImplementation(async (indicators: (() => Promise<unknown>)[]) => {
        const info: Record<string, unknown> = {};
        for (const fn of indicators) {
          const result = await fn();
          Object.assign(info, result);
        }
        return { status: 'ok', info };
      }),
    };

    controller = new HealthController(
      healthCheckService as unknown as HealthCheckService,
      prismaHealth as unknown as PrismaHealthIndicator,
      redisHealth as unknown as RedisHealthIndicator,
    );
  });

  it('GET /health/live returns ok with no dependency checks', async () => {
    const result = await controller.live();

    expect(result).toMatchObject({ status: 'ok' });
    expect(prismaHealth.isHealthy).not.toHaveBeenCalled();
    expect(redisHealth.isHealthy).not.toHaveBeenCalled();
  });

  it('GET /health/ready returns healthy when all indicators pass', async () => {
    const result = await controller.ready();

    expect(result).toMatchObject({
      status: 'ok',
      info: {
        database: { status: 'up' },
        redis: { status: 'up' },
      },
    });
  });

  it('GET /health/ready returns error when database fails', async () => {
    prismaHealth.isHealthy.mockResolvedValue({
      database: { status: 'down', message: 'Connection refused' },
    });

    const result = await controller.ready();

    expect(result).toMatchObject({
      info: { database: { status: 'down' } },
    });
  });

  it('GET /health/ready returns error when Redis fails', async () => {
    redisHealth.isHealthy.mockResolvedValue({
      redis: { status: 'down', message: 'Redis ping failed' },
    });

    const result = await controller.ready();

    expect(result).toMatchObject({
      info: { redis: { status: 'down' } },
    });
  });
});
