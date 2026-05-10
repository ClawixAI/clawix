import { Injectable } from '@nestjs/common';

import { createLogger } from '@clawix/shared';

import { PrismaService } from '../prisma/prisma.service.js';

const logger = createLogger('engine:agent-run-registry');

/**
 * Tracks AbortControllers for active agent runs in this process.
 *
 * Single-replica deployment: all running runs hold a controller here.
 * On process restart, controllers are lost; the StaleRunReaperService
 * sweeps orphaned `running` rows after 10 minutes.
 */
@Injectable()
export class AgentRunRegistry {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly prisma: PrismaService) {}

  register(agentRunId: string, controller: AbortController): void {
    this.controllers.set(agentRunId, controller);
  }

  unregister(agentRunId: string): void {
    this.controllers.delete(agentRunId);
  }

  /**
   * Abort the controller for a specific run.
   * Returns true if a controller was found and aborted, false otherwise.
   */
  abort(agentRunId: string, reason: string): boolean {
    const controller = this.controllers.get(agentRunId);
    if (!controller) return false;
    controller.abort(reason);
    return true;
  }

  /**
   * Abort all running agent runs for a user. Fires in-memory aborts for
   * runs registered on this process and writes status='cancelled' to all
   * matching rows (including any that aren't in this process's registry).
   *
   * Uses `WHERE status='running'` to lose the race against a concurrent
   * legitimate completion — runs already in `completed`/`failed`/`cancelled`
   * are not touched.
   */
  async abortAllForUser(userId: string): Promise<{ stopped: number }> {
    const rows = await this.prisma.agentRun.findMany({
      where: { status: 'running', session: { userId } },
      select: { id: true },
    });

    if (rows.length === 0) return { stopped: 0 };

    const ids = rows.map((r) => r.id);

    for (const id of ids) {
      const controller = this.controllers.get(id);
      if (controller) controller.abort('user_stop');
    }

    const result = await this.prisma.agentRun.updateMany({
      where: { id: { in: ids }, status: 'running' },
      data: {
        status: 'cancelled',
        error: 'Stopped by user',
        completedAt: new Date(),
      },
    });

    logger.info({ userId, stopped: result.count }, 'Stopped agent runs for user');
    return { stopped: result.count };
  }
}
