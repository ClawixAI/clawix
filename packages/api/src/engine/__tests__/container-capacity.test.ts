import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ContainerCapacityLedger } from '../container-capacity.ledger.js';
import { CapacityService } from '../capacity.service.js';
import type { ContainerPoolService } from '../container-pool.service.js';
import type { TaskExecutorService } from '../task-executor.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('ContainerCapacityLedger', () => {
  let poolStats: { active: number; idle: number; ephemeral: number; total: number };
  let ledger: ContainerCapacityLedger;

  beforeEach(() => {
    process.env['MAX_TOTAL_CONTAINERS'] = '5';
    poolStats = { active: 2, idle: 1, ephemeral: 0, total: 3 };
    ledger = new ContainerCapacityLedger({
      stats: () => poolStats,
    } as unknown as ContainerPoolService);
  });

  it('admits sub-agent containers while pooled + sub-agent total is under the ceiling', () => {
    expect(ledger.tryAcquireSubAgent()).toBe(true); // 3 + 0 < 5
    expect(ledger.tryAcquireSubAgent()).toBe(true); // 3 + 1 < 5
    expect(ledger.subAgentActive).toBe(2);
  });

  it('refuses at the ceiling and admits nothing', () => {
    ledger.tryAcquireSubAgent();
    ledger.tryAcquireSubAgent(); // total now 5 = ceiling
    expect(ledger.tryAcquireSubAgent()).toBe(false);
    expect(ledger.subAgentActive).toBe(2);
  });

  it('counts live pool occupancy — pool growth shrinks sub-agent headroom', () => {
    poolStats = { ...poolStats, total: 5 };
    expect(ledger.tryAcquireSubAgent()).toBe(false);
  });

  it('release frees a slot and never goes negative', () => {
    ledger.tryAcquireSubAgent();
    ledger.releaseSubAgent();
    ledger.releaseSubAgent(); // extra release is a no-op
    expect(ledger.subAgentActive).toBe(0);
    expect(ledger.tryAcquireSubAgent()).toBe(true);
  });

  it('snapshot reports pooled + sub-agent totals against the ceiling', () => {
    ledger.tryAcquireSubAgent();
    expect(ledger.snapshot()).toEqual({
      ceiling: 5,
      pooled: poolStats,
      subAgentActive: 1,
      total: 4,
    });
  });
});

describe('CapacityService', () => {
  let mockPrisma: {
    user: { groupBy: ReturnType<typeof vi.fn> };
    policy: { findMany: ReturnType<typeof vi.fn> };
  };
  let ledger: { snapshot: ReturnType<typeof vi.fn>; maxTotal: number };
  let executor: { activeCount: number; pendingCount: number };
  let service: CapacityService;

  beforeEach(() => {
    mockPrisma = {
      user: {
        groupBy: vi.fn().mockResolvedValue([
          { policyId: 'pol-std', _count: { _all: 3 } },
          { policyId: 'pol-ext', _count: { _all: 1 } },
        ]),
      },
      policy: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'pol-std', maxConcurrentPrimaryRuns: 2, maxConcurrentSubAgents: 2 },
          { id: 'pol-ext', maxConcurrentPrimaryRuns: 4, maxConcurrentSubAgents: 5 },
        ]),
      },
    };
    ledger = {
      snapshot: vi.fn().mockReturnValue({
        ceiling: 20,
        pooled: { active: 1, idle: 2, ephemeral: 0, total: 3 },
        subAgentActive: 1,
        total: 4,
      }),
      maxTotal: 20,
    };
    executor = { activeCount: 1, pendingCount: 0 };

    service = new CapacityService(
      mockPrisma as unknown as PrismaService,
      ledger as unknown as ContainerCapacityLedger,
      executor as unknown as TaskExecutorService,
    );
  });

  it('computes committed load as Σ users × their plan concurrency', async () => {
    // 3 × (2+2) + 1 × (4+5) = 21
    const { activeUsers, committed } = await service.committedLoad();
    expect(activeUsers).toBe(4);
    expect(committed).toBe(21);
    expect(mockPrisma.user.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('report flags over-commit and carries a warning', async () => {
    const report = await service.report();
    expect(report.committedLoad).toBe(21);
    expect(report.overCommitted).toBe(true); // 21 > 20
    expect(report.warning).toContain('exceeding the host container ceiling of 20');
    expect(report.containers.total).toBe(4);
    expect(report.executor).toEqual({ active: 1, pending: 0 });
  });

  it('onboardingWarning is null while committed load fits the ceiling', async () => {
    mockPrisma.user.groupBy.mockResolvedValue([{ policyId: 'pol-std', _count: { _all: 2 } }]); // 8 ≤ 20
    expect(await service.onboardingWarning()).toBeNull();
  });

  it('onboardingWarning names the numbers when over-committed', async () => {
    const warning = await service.onboardingWarning();
    expect(warning).toContain('21 concurrent containers');
    expect(warning).toContain('4 active user(s)');
  });
});
