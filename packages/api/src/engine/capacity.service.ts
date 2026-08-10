/**
 * CapacityService — pool capacity vs committed load, for admin visibility
 * and the warn-on-onboarding guard (#198).
 *
 * Committed load = Σ over active users of the concurrent containers their
 * plan permits (maxConcurrentPrimaryRuns + maxConcurrentSubAgents). It is a
 * worst-case commitment, not a live count — the point is to surface
 * over-commit at onboarding time instead of as a runtime lottery.
 */
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { ContainerCapacityLedger } from './container-capacity.ledger.js';
import { TaskExecutorService } from './task-executor.service.js';

/** Full capacity report served by GET /admin/capacity. */
export interface CapacityReport {
  readonly containers: {
    readonly ceiling: number;
    readonly total: number;
    readonly pooled: { active: number; idle: number; ephemeral: number; total: number };
    readonly subAgentActive: number;
  };
  readonly executor: { readonly active: number; readonly pending: number };
  readonly activeUsers: number;
  readonly committedLoad: number;
  readonly overCommitted: boolean;
  readonly warning: string | null;
}

@Injectable()
export class CapacityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: ContainerCapacityLedger,
    private readonly taskExecutor: TaskExecutorService,
  ) {}

  /** Worst-case concurrent-container commitment across active users. */
  async committedLoad(): Promise<{ activeUsers: number; committed: number }> {
    const groups = await this.prisma.user.groupBy({
      by: ['policyId'],
      where: { isActive: true },
      _count: { _all: true },
    });
    if (groups.length === 0) return { activeUsers: 0, committed: 0 };

    const policies = await this.prisma.policy.findMany({
      where: { id: { in: groups.map((g) => g.policyId) } },
      select: { id: true, maxConcurrentPrimaryRuns: true, maxConcurrentSubAgents: true },
    });
    const perPolicy = new Map(
      policies.map((p) => [p.id, p.maxConcurrentPrimaryRuns + p.maxConcurrentSubAgents]),
    );

    let committed = 0;
    let activeUsers = 0;
    for (const group of groups) {
      activeUsers += group._count._all;
      committed += group._count._all * (perPolicy.get(group.policyId) ?? 0);
    }
    return { activeUsers, committed };
  }

  /** Full report for GET /admin/capacity. */
  async report(): Promise<CapacityReport> {
    const snapshot = this.ledger.snapshot();
    const { activeUsers, committed } = await this.committedLoad();
    const overCommitted = committed > snapshot.ceiling;

    return {
      containers: {
        ceiling: snapshot.ceiling,
        total: snapshot.total,
        pooled: snapshot.pooled,
        subAgentActive: snapshot.subAgentActive,
      },
      executor: {
        active: this.taskExecutor.activeCount,
        pending: this.taskExecutor.pendingCount,
      },
      activeUsers,
      committedLoad: committed,
      overCommitted,
      warning: overCommitted ? this.warningText(committed, activeUsers, snapshot.ceiling) : null,
    };
  }

  /**
   * Onboarding guard: the warning string when the current committed load
   * over-commits the host ceiling, else null. Warn-and-allow by design —
   * the admin stays in control; this is a heads-up, not a wall.
   */
  async onboardingWarning(): Promise<string | null> {
    const { activeUsers, committed } = await this.committedLoad();
    const ceiling = this.ledger.maxTotal;
    return committed > ceiling ? this.warningText(committed, activeUsers, ceiling) : null;
  }

  private warningText(committed: number, activeUsers: number, ceiling: number): string {
    return (
      `Committed load is ${committed} concurrent containers across ${activeUsers} active user(s), ` +
      `exceeding the host container ceiling of ${ceiling}. Under full load some runs will queue or ` +
      'be refused. Consider raising MAX_TOTAL_CONTAINERS, tightening plan quotas, or deactivating users.'
    );
  }
}
