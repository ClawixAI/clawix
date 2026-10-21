import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@clawix/shared';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import type { AgentRunModel } from '../generated/prisma/models.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AgentStatus } from '../generated/prisma/enums.js';

import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginatedResponse, buildPaginationArgs, handlePrismaError } from './utils.js';

type AgentRun = AgentRunModel;

interface CreateAgentRunInput {
  readonly agentDefinitionId: string;
  readonly sessionId?: string;
  readonly input: string;
  readonly status?: AgentStatus;
  readonly parentAgentRunId?: string;
  /** Token budget cap inherited from the spawning parent's BudgetTracker. */
  readonly tokenBudget?: number;
  /** Grace percent in effect at spawn time. */
  readonly tokenGracePercent?: number;
}

interface UpdateAgentRunInput {
  readonly status?: AgentStatus;
  readonly sessionId?: string;
  readonly output?: string;
  readonly error?: string;
  readonly tokenUsage?: Prisma.InputJsonValue;
  readonly completedAt?: Date;
}

@Injectable()
export class AgentRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<AgentRun> {
    const agentRun = await this.prisma.agentRun.findUnique({ where: { id } });

    if (!agentRun) {
      throw new NotFoundError('AgentRun', id);
    }

    return agentRun;
  }

  async findAll(pagination: PaginationInput): Promise<PaginatedResponse<AgentRun>> {
    const paginationArgs = buildPaginationArgs(pagination);

    const [data, total] = await Promise.all([
      this.prisma.agentRun.findMany({
        ...paginationArgs,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.agentRun.count(),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findByStatus(
    status: AgentStatus,
    pagination: PaginationInput,
  ): Promise<PaginatedResponse<AgentRun>> {
    const paginationArgs = buildPaginationArgs(pagination);
    const where = { status };

    const [data, total] = await Promise.all([
      this.prisma.agentRun.findMany({
        where,
        ...paginationArgs,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.agentRun.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findBySessionId(
    sessionId: string,
    pagination: PaginationInput,
  ): Promise<PaginatedResponse<AgentRun>> {
    const paginationArgs = buildPaginationArgs(pagination);
    const where = { sessionId };

    const [data, total] = await Promise.all([
      this.prisma.agentRun.findMany({
        where,
        ...paginationArgs,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.agentRun.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findByAgentDefinitionId(
    agentDefinitionId: string,
    pagination: PaginationInput,
    userId?: string,
  ): Promise<PaginatedResponse<AgentRun>> {
    const paginationArgs = buildPaginationArgs(pagination);
    const where: Prisma.AgentRunWhereInput = {
      agentDefinitionId,
      ...(userId ? { session: { userId } } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.agentRun.findMany({
        where,
        ...paginationArgs,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.agentRun.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findAllByStatus(status: AgentStatus): Promise<readonly AgentRun[]> {
    return this.prisma.agentRun.findMany({
      where: { status },
      orderBy: { startedAt: 'asc' },
    });
  }

  /**
   * The session's currently-running primary run (a user turn or a delivery
   * reinvocation — anything without a parent), or null. Used by the result
   * delivery path to defer reinvocation until the live turn settles, so two
   * runs never write the same session concurrently.
   */
  async findActivePrimaryRun(sessionId: string): Promise<AgentRun | null> {
    return this.prisma.agentRun.findFirst({
      where: { sessionId, status: 'running', parentAgentRunId: null },
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Flip a run to 'cancelled' only while it is still pending/running, so a
   * status the watchdog/reaper/loop already wrote is never overwritten.
   * Returns true when this call performed the flip.
   */
  async cancelIfActive(id: string): Promise<boolean> {
    const result = await this.prisma.agentRun.updateMany({
      where: { id, status: { in: ['pending', 'running'] } },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    return result.count > 0;
  }

  /**
   * Count a user's currently-running primary runs across all their sessions.
   * Backs the per-plan primary admission cap (`Policy.maxConcurrentPrimaryRuns`).
   */
  async countActivePrimaryRunsForUser(userId: string): Promise<number> {
    return this.prisma.agentRun.count({
      where: { status: 'running', parentAgentRunId: null, session: { userId } },
    });
  }

  /**
   * Whether the user has a running primary run in a web-channel session.
   * Lets the web gateway restore the "Thinking…" indicator for a client that
   * reconnects (page reload / re-entry) mid-run, since `typing.start` is only
   * emitted once when the run begins.
   */
  async hasActiveWebPrimaryRunForUser(userId: string): Promise<boolean> {
    const count = await this.prisma.agentRun.count({
      where: {
        status: 'running',
        parentAgentRunId: null,
        session: { userId, channel: { type: 'web' } },
      },
    });
    return count > 0;
  }

  /**
   * Sum the input+output tokens already recorded across every run in a session.
   *
   * Used on crash recovery to seed a fresh shared {@link BudgetTracker} so
   * recovered sibling runs resume from the swarm's cumulative spend instead of
   * each getting a full new allowance. tokenUsage is a JSON blob, so the sum is
   * computed in memory — acceptable on the rare recovery path.
   */
  async sumSessionTokenUsage(sessionId: string): Promise<number> {
    const runs = await this.prisma.agentRun.findMany({
      where: { sessionId },
      select: { tokenUsage: true },
    });

    return runs.reduce((total, run) => {
      const usage = run.tokenUsage as { inputTokens?: number; outputTokens?: number } | null;
      if (usage === null || typeof usage !== 'object') return total;
      return total + (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    }, 0);
  }

  async create(data: CreateAgentRunInput): Promise<AgentRun> {
    try {
      return await this.prisma.agentRun.create({
        data: {
          agentDefinitionId: data.agentDefinitionId,
          ...(data.sessionId !== undefined ? { sessionId: data.sessionId } : {}),
          input: data.input,
          ...(data.status ? { status: data.status } : {}),
          ...(data.parentAgentRunId ? { parentAgentRunId: data.parentAgentRunId } : {}),
          ...(data.tokenBudget !== undefined ? { tokenBudget: data.tokenBudget } : {}),
          ...(data.tokenGracePercent !== undefined
            ? { tokenGracePercent: data.tokenGracePercent }
            : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'AgentRun');
    }
  }

  async findByParentId(parentAgentRunId: string): Promise<readonly AgentRun[]> {
    return this.prisma.agentRun.findMany({
      where: { parentAgentRunId },
      orderBy: { startedAt: 'asc' },
    });
  }

  async update(id: string, data: UpdateAgentRunInput): Promise<AgentRun> {
    try {
      return await this.prisma.agentRun.update({
        where: { id },
        data: {
          ...(data.status ? { status: data.status } : {}),
          // Anchor the execution clock to the pending→running transition.
          // `startedAt` defaults to row-creation time, but a spawned sub-agent
          // can sit in the executor queue before it runs. The stale-run reaper
          // measures staleness from `startedAt`, while the executor watchdog
          // and reasoning-loop timeout are anchored at execution start — so a
          // queued run could be reaped (10 min from creation) before its own
          // watchdog (timeout + 30s from execution) fired. Resetting here keeps
          // all three layers on the same clock so the watchdog wins.
          ...(data.status === 'running' ? { startedAt: new Date() } : {}),
          ...(data.sessionId !== undefined ? { sessionId: data.sessionId } : {}),
          ...(data.output !== undefined ? { output: data.output } : {}),
          ...(data.error !== undefined ? { error: data.error } : {}),
          ...(data.tokenUsage !== undefined ? { tokenUsage: data.tokenUsage } : {}),
          ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'AgentRun');
    }
  }

  async delete(id: string): Promise<AgentRun> {
    try {
      return await this.prisma.agentRun.delete({ where: { id } });
    } catch (error: unknown) {
      handlePrismaError(error, 'AgentRun');
    }
  }
}
