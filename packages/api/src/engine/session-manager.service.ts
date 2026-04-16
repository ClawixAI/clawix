import { Injectable } from '@nestjs/common';
import { createLogger, ValidationError } from '@clawix/shared';
import type { ChatMessage } from '@clawix/shared';

import type { Session } from '../generated/prisma/client.js';
import { SessionRepository } from '../db/session.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

const logger = createLogger('engine:session-manager');

interface GetOrCreateOptions {
  readonly userId: string;
  readonly agentDefinitionId: string;
  readonly sessionId?: string;
  readonly channelId?: string;
}

@Injectable()
export class SessionManagerService {
  constructor(
    private readonly sessionRepo: SessionRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Returns an existing session (by sessionId) or creates a new one.
   *
   * When sessionId is provided, validates that the session:
   * - exists (throws NotFoundError if not)
   * - belongs to the specified user (throws ValidationError if not)
   * - belongs to the specified agent definition (throws ValidationError if not)
   * - is currently active (throws ValidationError if not)
   *
   * When sessionId is omitted, creates and returns a new session.
   */
  async getOrCreate(options: GetOrCreateOptions): Promise<Session> {
    const { userId, agentDefinitionId, sessionId, channelId } = options;

    if (!sessionId) {
      // Channel-aware: look for existing active session by composite key
      if (channelId) {
        const existing = await this.prisma.session.findFirst({
          where: {
            userId,
            agentDefinitionId,
            channelId,
            isActive: true,
          },
        });

        if (existing) {
          logger.info(
            { userId, agentDefinitionId, channelId, sessionId: existing.id },
            'Resuming channel session',
          );
          return existing;
        }
      }

      logger.info({ userId, agentDefinitionId, channelId }, 'Creating new session');
      return this.sessionRepo.create({
        userId,
        agentDefinitionId,
        ...(channelId !== undefined ? { channelId } : {}),
      });
    }

    logger.info({ sessionId, userId, agentDefinitionId }, 'Resuming existing session');
    const session = await this.sessionRepo.findById(sessionId);

    if (session.userId !== userId) {
      throw new ValidationError(`Session '${sessionId}' does not belong to user '${userId}'`);
    }

    if (session.agentDefinitionId !== agentDefinitionId) {
      throw new ValidationError(
        `Session '${sessionId}' is not associated with agent definition '${agentDefinitionId}'`,
      );
    }

    if (!session.isActive) {
      throw new ValidationError(`Session '${sessionId}' is inactive`);
    }

    return session;
  }

  /**
   * Loads all messages for a session, ordered by their sequence ordering.
   * Maps DB rows to ChatMessage objects, spreading optional fields only when present.
   */
  async loadMessages(sessionId: string): Promise<ChatMessage[]> {
    logger.debug({ sessionId }, 'Loading session messages');

    const rows = await this.prisma.sessionMessage.findMany({
      where: { sessionId, archivedAt: null },
      orderBy: { ordering: 'asc' },
    });

    return rows.map((row) => {
      const base: ChatMessage = {
        role: row.role as ChatMessage['role'],
        content: row.content,
      };

      return {
        ...base,
        ...(row.toolCallId != null ? { toolCallId: row.toolCallId } : {}),
        ...(row.toolCalls != null
          ? { toolCalls: row.toolCalls as unknown as ChatMessage['toolCalls'] }
          : {}),
      };
    });
  }

  /**
   * Appends messages to a session, computing ordering offsets from the current count.
   * Ordering for each new message = currentCount + index.
   */
  async saveMessages(
    sessionId: string,
    messages: readonly ChatMessage[],
  ): Promise<readonly string[]> {
    const currentCount = await this.prisma.sessionMessage.count({
      where: { sessionId, archivedAt: null },
    });

    logger.debug({ sessionId, currentCount, newCount: messages.length }, 'Saving session messages');

    const ids = await this.prisma.$transaction(async (tx) => {
      const createdIds: string[] = [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!;
        const created = await tx.sessionMessage.create({
          data: {
            sessionId,
            role: msg.role,
            content: msg.content,
            senderId: msg.senderId,
            toolCallId: msg.toolCallId,
            toolCalls: msg.toolCalls ? JSON.parse(JSON.stringify(msg.toolCalls)) : undefined,
            ordering: currentCount + i,
          },
        });
        createdIds.push(created.id);
      }
      return createdIds;
    });

    return ids;
  }

  /**
   * Truncation-based compaction: keeps the system message (if any) plus the last
   * `maxMessages` non-system messages. Archives the rest via soft-delete (`archivedAt`
   * timestamp). No-op if total active non-system message count is at or under the threshold.
   *
   * @param sessionId - The session to compact.
   * @param maxMessages - Maximum number of non-system messages to retain (default: 50).
   *
   * @note Phase 3E — `AgentRunnerService` now calls `MemoryConsolidationService.consolidateIfNeeded`
   *   instead of this method for semantic LLM-driven summarisation. Consolidated memory is persisted
   *   as a synthetic `role: 'system'` message with a `[MEMORY SUMMARY]` prefix (not `'assistant'`).
   *   This method remains available for direct truncation when semantic consolidation is not needed.
   */
  async compact(sessionId: string, maxMessages = 50): Promise<void> {
    const rows = await this.prisma.sessionMessage.findMany({
      where: { sessionId, archivedAt: null },
      orderBy: { ordering: 'asc' },
    });

    if (rows.length === 0) {
      return;
    }

    const systemMessages = rows.filter((r) => r.role === 'system');
    const nonSystemMessages = rows.filter((r) => r.role !== 'system');

    if (nonSystemMessages.length <= maxMessages) {
      logger.debug(
        { sessionId, count: nonSystemMessages.length, maxMessages },
        'Session under compaction threshold, skipping',
      );
      return;
    }

    const toKeepNonSystem = nonSystemMessages.slice(-maxMessages);
    const toArchiveNonSystem = nonSystemMessages.slice(0, nonSystemMessages.length - maxMessages);

    const idsToArchive = toArchiveNonSystem.map((r) => r.id);

    logger.info(
      {
        sessionId,
        archiving: idsToArchive.length,
        keeping: systemMessages.length + toKeepNonSystem.length,
      },
      'Compacting session messages',
    );

    await this.prisma.sessionMessage.updateMany({
      where: { id: { in: idsToArchive } },
      data: { archivedAt: new Date() },
    });
  }

  /**
   * Marks a session as inactive. Inactive sessions cannot be resumed via getOrCreate.
   */
  async deactivate(sessionId: string): Promise<Session> {
    logger.info({ sessionId }, 'Deactivating session');
    return this.sessionRepo.update(sessionId, { isActive: false });
  }
}
