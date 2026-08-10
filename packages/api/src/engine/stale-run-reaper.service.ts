import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';

import { createLogger } from '@clawix/shared';

import { PrismaService } from '../prisma/prisma.service.js';
import { AgentRunRegistry } from './agent-run-registry.service.js';
import { SubAgentResultPublisher } from './sub-agent-result.publisher.js';
import { agentReaperReapedTotal } from './agent-loop-metrics.js';

const logger = createLogger('engine:stale-run-reaper');

/** Runs older than this are considered stale and will be force-failed. */
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/** How often the reaper sweeps. */
const SWEEP_INTERVAL_MS = 60 * 1000; // every 60 seconds

/** Error string recorded on reaped runs and delivered to waiting parents. */
const REAP_ERROR = 'Agent run timed out (stale run reaper)';

@Injectable()
export class StaleRunReaperService implements OnModuleInit, OnModuleDestroy {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRunRegistry: AgentRunRegistry,
    private readonly resultPublisher: SubAgentResultPublisher,
  ) {}

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

    // Collect the rows first so we can abort their in-process controllers. A
    // bare updateMany only flips the DB row: the awaited run keeps executing,
    // its slot stays occupied, and the parent is never re-invoked. Aborting
    // the controller actually stops the run and lets it report back.
    const stale = await this.prisma.agentRun.findMany({
      where: { status: 'running', startedAt: { lt: cutoff } },
      select: { id: true, parentAgentRunId: true },
    });

    if (stale.length === 0) return 0;

    let reaped = 0;
    for (const run of stale) {
      // Best-effort: abort() returns false when the controller is gone (e.g.
      // another process, or lost on restart) — an orphan no executor path can
      // report on anymore.
      const hadController = this.agentRunRegistry.abort(run.id, 'stale_timeout');

      // Per-row guarded update: if the watchdog or a legitimate completion won
      // the race since findMany, count is 0 and we skip — that path already
      // notified the parent.
      const result = await this.prisma.agentRun.updateMany({
        where: { id: run.id, status: 'running' },
        data: {
          status: 'failed',
          error: REAP_ERROR,
          completedAt: new Date(),
        },
      });
      if (result.count === 0) continue;
      reaped++;

      // Orphaned child: with no in-process controller the executor will never
      // publish this outcome — the reaper is the parent's last messenger.
      // (When a controller WAS aborted, the executor's own catch/watchdog path
      // publishes the failure, so publishing here would double-deliver.)
      if (!hadController && run.parentAgentRunId) {
        void this.resultPublisher.publishFailure(run.id, new Error(REAP_ERROR));
      }
    }

    if (reaped > 0) {
      agentReaperReapedTotal.inc(reaped);
      logger.warn({ count: reaped }, 'Reaped stale agent runs');
    }

    return reaped;
  }
}
