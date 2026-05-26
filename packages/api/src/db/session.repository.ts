import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@clawix/shared';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import type { Prisma, Session } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginatedResponse, buildPaginationArgs, handlePrismaError } from './utils.js';

export interface RecallSessionInfo {
  readonly id: string;
  readonly topic: string | null;
  readonly createdAt: Date;
  readonly firstUserMessages: string[];
}

/** Shared select for recall queries: title sources + first ≤3 user messages. */
const RECALL_SESSION_SELECT = {
  id: true,
  topic: true,
  createdAt: true,
  sessionMessages: {
    where: { role: 'user' },
    orderBy: { ordering: 'asc' },
    take: 3,
    select: { content: true },
  },
} satisfies Prisma.SessionSelect;

function toRecallSessionInfo(row: {
  id: string;
  topic: string | null;
  createdAt: Date;
  sessionMessages: { content: string }[];
}): RecallSessionInfo {
  return {
    id: row.id,
    topic: row.topic,
    createdAt: row.createdAt,
    firstUserMessages: row.sessionMessages.map((m) => m.content),
  };
}

interface CreateSessionData {
  readonly userId: string;
  readonly agentDefinitionId: string;
  readonly channelId?: string | null;
}

interface UpdateSessionData {
  readonly isActive?: boolean;
  readonly lastConsolidatedAt?: Date;
  readonly channelId?: string | null;
  readonly topic?: string | null;
}

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Session> {
    const result = await this.prisma.session.findUnique({ where: { id } });

    if (!result) {
      throw new NotFoundError('Session', id);
    }

    return result;
  }

  /**
   * Persist the rendered system prompt for a session if not already set.
   * Uses a `cachedSystemPrompt: null` predicate so concurrent first-call
   * races are idempotent: the second concurrent run's UPDATE matches zero
   * rows and silently no-ops. Both runs' rendered output is byte-identical
   * by construction, so the user sees no inconsistency.
   */
  async setCachedSystemPrompt(id: string, prompt: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id, cachedSystemPrompt: null },
      data: { cachedSystemPrompt: prompt },
    });
  }

  /**
   * Drop the cached system prompt on every active session so the next turn
   * re-renders against fresh shared context (public memory, etc). Intended
   * to be called when admin-curated context changes — without this, existing
   * sessions keep their stale cached prompt and never see new cards.
   */
  async clearAllCachedSystemPrompts(): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { cachedSystemPrompt: { not: null }, isActive: true },
      data: { cachedSystemPrompt: null },
    });
    return result.count;
  }

  async findAll(pagination: PaginationInput): Promise<PaginatedResponse<Session>> {
    const { skip, take } = buildPaginationArgs(pagination);

    const [data, total] = await Promise.all([
      this.prisma.session.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.session.count(),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findActive(pagination: PaginationInput): Promise<PaginatedResponse<Session>> {
    const { skip, take } = buildPaginationArgs(pagination);
    const where = { isActive: true };

    const [data, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.session.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findByUserId(
    userId: string,
    pagination: PaginationInput,
    channelId?: string,
    includeArchived?: boolean,
  ): Promise<PaginatedResponse<Session>> {
    const { skip, take } = buildPaginationArgs(pagination);
    const where: { userId: string; channelId?: string; isActive?: boolean } = { userId };
    if (!includeArchived) where.isActive = true;
    if (channelId) where.channelId = channelId;

    const [sessions, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          sessionMessages: {
            where: { role: 'user' },
            orderBy: { ordering: 'asc' },
            take: 1,
            select: { content: true },
          },
        },
      }),
      this.prisma.session.count({ where }),
    ]);

    // Use stored topic, fall back to first user message if not set
    const data: Session[] = sessions.map((session) => {
      const firstUserMsg = session.sessionMessages[0];
      const derivedTopic = firstUserMsg?.content?.slice(0, 100) ?? null;
      const { sessionMessages: _, ...rest } = session;
      return { ...rest, topic: rest.topic ?? derivedTopic };
    });

    return buildPaginatedResponse(data, total, pagination);
  }

  async updateTopic(id: string, topic: string | null): Promise<Session> {
    try {
      return await this.prisma.session.update({
        where: { id },
        data: { topic },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'Session');
    }
  }

  async findActiveByUserId(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: CreateSessionData): Promise<Session> {
    try {
      return await this.prisma.session.create({
        data: {
          userId: data.userId,
          agentDefinitionId: data.agentDefinitionId,
          ...(data.channelId !== undefined ? { channelId: data.channelId } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'Session');
    }
  }

  async update(id: string, data: UpdateSessionData): Promise<Session> {
    try {
      return await this.prisma.session.update({
        where: { id },
        data,
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'Session');
    }
  }

  async deactivate(id: string): Promise<Session> {
    try {
      return await this.prisma.session.update({
        where: { id },
        data: { isActive: false },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'Session');
    }
  }

  async delete(id: string): Promise<Session> {
    try {
      return await this.prisma.session.delete({ where: { id } });
    } catch (error: unknown) {
      handlePrismaError(error, 'Session');
    }
  }

  /** Most-recent sessions for the user (optionally excluding one), with the
   *  first ≤3 user messages — for the Recent Sessions injection. */
  async findRecentForRecall(
    userId: string,
    limit: number,
    excludeSessionId?: string,
  ): Promise<RecallSessionInfo[]> {
    const where: { userId: string; id?: { not: string } } = { userId };
    if (excludeSessionId !== undefined) where.id = { not: excludeSessionId };

    const rows = await this.prisma.session.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: RECALL_SESSION_SELECT,
    });

    return rows.map(toRecallSessionInfo);
  }

  /** Title-source data for a set of sessions — for labeling search hits. */
  async findRecallTitleData(sessionIds: readonly string[]): Promise<RecallSessionInfo[]> {
    if (sessionIds.length === 0) return [];

    const rows = await this.prisma.session.findMany({
      where: { id: { in: [...sessionIds] } },
      select: RECALL_SESSION_SELECT,
    });

    return rows.map(toRecallSessionInfo);
  }
}
