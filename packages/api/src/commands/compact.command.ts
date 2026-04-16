import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type {
  SessionCommand,
  SessionCommandContext,
  SessionCommandResult,
} from './session-command.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AgentRunRepository } from '../db/agent-run.repository.js';
import { MemoryConsolidationService } from '../engine/memory-consolidation.service.js';
import type { ConsolidationResult } from '../engine/memory-consolidation.service.js';

const MIN_MESSAGES_TO_COMPACT = 4;
const logger = createLogger('commands:compact');

function formatTokens(tokens: number | undefined): string {
  if (tokens === undefined) return '?';
  return `~${Math.round(tokens / 1000)}K`;
}

function buildCompactResponseText(result: ConsolidationResult): string {
  if (!result.consolidated) {
    return 'Session is already within context limits. No compaction needed.';
  }
  const pre = formatTokens(result.preTokens);
  const post = formatTokens(result.postTokens);
  const rounds = result.roundsUsed ?? 1;
  const archived = result.archivedCount ?? 0;
  return `Session compacted. Context reduced from ${pre} to ${post} tokens (${rounds} round(s), ${archived} messages archived).`;
}

@Injectable()
export class CompactCommand implements SessionCommand {
  readonly name = 'compact';
  readonly description = 'Summarize conversation context to free up space';

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRunRepo: AgentRunRepository,
    private readonly consolidation: MemoryConsolidationService,
  ) {}

  async execute(ctx: SessionCommandContext): Promise<SessionCommandResult> {
    const nonSystemCount = await this.prisma.sessionMessage.count({
      where: { sessionId: ctx.sessionId, role: { not: 'system' }, archivedAt: null },
    });

    if (nonSystemCount < MIN_MESSAGES_TO_COMPACT) {
      return { text: 'Session is too short to compact.' };
    }

    const agentRun = await this.agentRunRepo.create({
      agentDefinitionId: ctx.agentDefinitionId,
      sessionId: ctx.sessionId,
      input: '[system] /compact',
      status: 'running',
    });

    try {
      const result: ConsolidationResult = await this.consolidation.consolidateIfNeeded(
        ctx.sessionId,
        {
          agentRunId: agentRun.id,
          userId: ctx.userId,
          force: true,
          customInstructions: ctx.args,
        },
      );

      await this.agentRunRepo.update(agentRun.id, {
        status: 'completed',
        completedAt: new Date(),
      });

      const text = buildCompactResponseText(result);
      return { text };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, sessionId: ctx.sessionId }, '/compact failed');

      await this.agentRunRepo.update(agentRun.id, {
        status: 'failed',
        error: errorMessage,
        completedAt: new Date(),
      });

      return { text: 'Compaction failed. Please try again later.' };
    }
  }
}
