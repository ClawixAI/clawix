/**
 * ContainerCapacityLedger — one host-wide ceiling for agent containers.
 *
 * The container pool caps its own warm (20) + ephemeral (10) slots, but
 * sub-agent containers start via direct `docker run` outside pool accounting,
 * so nothing bounded the real total on the host. This ledger counts the
 * pool's live containers (via its stats) plus the sub-agent containers it
 * admits, against MAX_TOTAL_CONTAINERS.
 *
 * In-process, single-replica — same documented stance as AgentRunRegistry
 * and the executor watchdog (see CLAUDE.md scaling-cliff note).
 */
import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import { ContainerPoolService } from './container-pool.service.js';
import { containersSubAgentActive } from './agent-loop-metrics.js';

const logger = createLogger('engine:container-capacity');

/** Snapshot of host container occupancy for the admin capacity surface. */
export interface CapacitySnapshot {
  readonly ceiling: number;
  readonly pooled: { active: number; idle: number; ephemeral: number; total: number };
  readonly subAgentActive: number;
  readonly total: number;
}

@Injectable()
export class ContainerCapacityLedger {
  private subAgentActive_ = 0;
  private readonly ceiling: number;

  constructor(private readonly containerPool: ContainerPoolService) {
    // Default = pool warm (20) + ephemeral (10) + sub-agent headroom (10).
    this.ceiling = parseInt(process.env['MAX_TOTAL_CONTAINERS'] ?? '40', 10);
  }

  get maxTotal(): number {
    return this.ceiling;
  }

  get subAgentActive(): number {
    return this.subAgentActive_;
  }

  /**
   * Admit one more sub-agent container under the host ceiling.
   * Returns false (and admits nothing) when pooled + sub-agent containers
   * already meet the ceiling — the caller fails the run fast with a clear
   * error instead of oversubscribing the host.
   */
  tryAcquireSubAgent(): boolean {
    const total = this.containerPool.stats().total + this.subAgentActive_;
    if (total >= this.ceiling) {
      logger.warn(
        { total, ceiling: this.ceiling, subAgentActive: this.subAgentActive_ },
        'Host container ceiling reached; refusing sub-agent container',
      );
      return false;
    }
    this.subAgentActive_++;
    containersSubAgentActive.set(this.subAgentActive_);
    return true;
  }

  /** Release a previously-admitted sub-agent container slot. */
  releaseSubAgent(): void {
    this.subAgentActive_ = Math.max(0, this.subAgentActive_ - 1);
    containersSubAgentActive.set(this.subAgentActive_);
  }

  /** Occupancy snapshot for GET /admin/capacity. */
  snapshot(): CapacitySnapshot {
    const pooled = this.containerPool.stats();
    return {
      ceiling: this.ceiling,
      pooled,
      subAgentActive: this.subAgentActive_,
      total: pooled.total + this.subAgentActive_,
    };
  }
}
