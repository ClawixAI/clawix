import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';

import { createLogger } from '@clawix/shared';

import { PrismaService } from '../prisma/prisma.service.js';

const logger = createLogger('engine:stale-run-reaper');

/** Runs older than this are considered stale and will be force-failed. */
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/** How often the reaper sweeps. */
const SWEEP_INTERVAL_MS = 60 * 1000; // every 60 seconds

@Injectable()
export class StaleRunReaperService implements OnModuleInit, OnModuleDestroy {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      void this.reapStaleRuns();
    }, SWEEP_INTERVAL_MS);
    logger.info(
      { thresholdMs: STALE_THRESHOLD_MS, intervalMs: SWEEP_INTERVAL_MS },
      'Stale run reaper started',
    );
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async reapStaleRuns(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    const result = await this.prisma.agentRun.updateMany({
      where: {
        status: 'running',
        startedAt: { lt: cutoff },
      },
      data: {
        status: 'failed',
        error: 'Agent run timed out (stale run reaper)',
        completedAt: new Date(),
      },
    });

    if (result.count > 0) {
      logger.warn({ count: result.count }, 'Reaped stale agent runs');
    }

    return result.count;
  }
}
