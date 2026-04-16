import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from '../prisma.health-indicator.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('PrismaHealthIndicator', () => {
  let indicator: PrismaHealthIndicator;
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };
  let upFn: ReturnType<typeof vi.fn>;
  let downFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    prisma = { $queryRaw: vi.fn() };
    upFn = vi.fn().mockReturnValue({ database: { status: 'up' } });
    downFn = vi
      .fn()
      .mockImplementation((details) => ({ database: { status: 'down', ...details } }));

    const healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upFn, down: downFn }),
    } as unknown as HealthIndicatorService;

    indicator = new PrismaHealthIndicator(
      prisma as unknown as PrismaService,
      healthIndicatorService,
    );
  });

  it('returns up when database responds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const result = await indicator.isHealthy('database');

    expect(result).toMatchObject({ database: { status: 'up' } });
    expect(upFn).toHaveBeenCalled();
  });

  it('returns down when database query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

    const result = await indicator.isHealthy('database');

    expect(result).toMatchObject({
      database: { status: 'down', message: 'Connection refused' },
    });
    expect(downFn).toHaveBeenCalledWith({ message: 'Connection refused' });
  });
});
