/**
 * MemoryConsolidationService — LLM-driven summarisation of old session messages.
 *
 * Replaces simple truncation with semantic memory consolidation:
 * - Estimates session token usage
 * - When over the context window threshold, calls an LLM to summarise the oldest messages
 * - Persists the summary as a synthetic `[MEMORY SUMMARY]` system message
 * - Optionally writes consolidated memory to the agent's container workspace (MEMORY.md)
 * - Falls back to raw archival after 3 consecutive LLM failures
 */

import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { createLogger } from '@clawix/shared';
import type { ToolDefinition } from '@clawix/shared';

import { PrismaService } from '../prisma/prisma.service.js';
// import { SessionRepository } from '../db/session.repository.js';
import { TokenCounterService } from './token-counter.service.js';
import type { IContainerRunner } from './container-runner.js';
import { createProvider } from './providers/provider-factory.js';
import { ProviderConfigService } from '../provider-config/provider-config.service.js';
import { buildConsolidationSystemPrompt, buildConsolidationUserPrompt } from './compact-prompt.js';
import { microcompactMessages } from './microcompact.js';

// ------------------------------------------------------------------ //
//  Constants                                                          //
// ------------------------------------------------------------------ //

const DEFAULT_CONTEXT_WINDOW_TOKENS = 65_536;
const MAX_CONSOLIDATION_ROUNDS = 5;
const MAX_CONSECUTIVE_FAILURES = 3;
const MEMORY_SUMMARY_PREFIX = '[MEMORY SUMMARY]';
const CONSOLIDATION_PROVIDER = 'openai';
const CONSOLIDATION_MODEL = 'gpt-4o-mini';

const logger = createLogger('engine:memory-consolidation');

// ------------------------------------------------------------------ //
//  Types                                                              //
// ------------------------------------------------------------------ //

export interface TokenWarningState {
  readonly estimated: number;
  readonly threshold: number;
  readonly ratio: number;
  readonly warning: 'none' | 'approaching' | 'critical';
}

export interface ConsolidationOptions {
  readonly containerId?: string;
  readonly containerRunner?: IContainerRunner;
  readonly contextWindowTokens?: number;
  readonly force?: boolean;
  readonly agentRunId: string;
  readonly userId: string;
  readonly customInstructions?: string;
}

export interface ConsolidationResult {
  readonly consolidated: boolean;
  readonly preTokens?: number;
  readonly postTokens?: number;
  readonly roundsUsed?: number;
  readonly archivedCount?: number;
}

// ------------------------------------------------------------------ //
//  Zod schema for save_memory tool call validation                   //
// ------------------------------------------------------------------ //

const SaveMemoryArgsSchema = z.object({
  history_entry: z.string().min(1),
  memory_update: z.string().min(1),
});

// ------------------------------------------------------------------ //
//  Tool definition for the consolidation LLM call                    //
// ------------------------------------------------------------------ //

const SAVE_MEMORY_TOOL: ToolDefinition = {
  name: 'save_memory',
  description:
    'Save a summary of the conversation history to persistent memory. ' +
    'Write a chronological log entry and an updated working memory context.',
  inputSchema: {
    type: 'object',
    properties: {
      history_entry: {
        type: 'string',
        description: 'A concise log entry describing what happened in the consolidated messages.',
      },
      memory_update: {
        type: 'string',
        description:
          'An updated memory context that captures the key facts, decisions, and ' +
          'ongoing state relevant to continuing this session.',
      },
    },
    required: ['history_entry', 'memory_update'],
  },
};

// ------------------------------------------------------------------ //
//  Helpers                                                            //
// ------------------------------------------------------------------ //

/**
 * Estimate token count for a string using the heuristic: ceil(length / 4).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Normalize provider-variant argument shapes into a plain object.
 *
 * Some providers return tool call arguments as a raw JSON string or
 * wrapped in an array. This normalizes before Zod validation.
 */
export function normalizeSaveMemoryArgs(args: unknown): Record<string, unknown> | null {
  if (typeof args === 'string') {
    try {
      const parsed: unknown = JSON.parse(args);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (Array.isArray(args)) {
    if (
      args.length > 0 &&
      typeof args[0] === 'object' &&
      args[0] !== null &&
      !Array.isArray(args[0])
    ) {
      return args[0] as Record<string, unknown>;
    }
    return null;
  }

  if (typeof args === 'object' && args !== null) {
    return args as Record<string, unknown>;
  }

  return null;
}

// ------------------------------------------------------------------ //
//  toolChoice fallback detection                                      //
// ------------------------------------------------------------------ //

const TOOL_CHOICE_KEYWORDS = ['tool_choice', 'toolchoice'] as const;
const TOOL_CHOICE_REJECTION_PHRASES = [
  'does not support',
  'not supported',
  'should be ["none", "auto"]',
] as const;

/**
 * Detect provider errors caused by forced tool_choice being unsupported.
 * Requires BOTH a tool_choice keyword AND a rejection phrase to avoid
 * false positives from unrelated "does not support" errors.
 */
export function isToolChoiceUnsupported(message: string | null | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  const hasKeyword = TOOL_CHOICE_KEYWORDS.some((k) => lower.includes(k));
  const hasRejection = TOOL_CHOICE_REJECTION_PHRASES.some((p) => lower.includes(p));
  return hasKeyword && hasRejection;
}

interface MessageRow {
  readonly id: string;
  readonly sessionId: string;
  readonly role: string;
  readonly content: string;
  readonly toolCallId: string | null;
  readonly toolCalls: unknown;
  readonly ordering: number;
  readonly createdAt: Date;
}

// ------------------------------------------------------------------ //
//  MemoryConsolidationService                                         //
// ------------------------------------------------------------------ //

@Injectable()
export class MemoryConsolidationService {
  private readonly sessionLocks = new Map<string, Promise<ConsolidationResult>>();

  constructor(
    private readonly prisma: PrismaService,
    // private readonly sessionRepo: SessionRepository,
    private readonly tokenCounter: TokenCounterService,
    private readonly providerConfig: ProviderConfigService,
  ) {}

  /**
   * Estimate the total token cost of all messages in a session.
   * Uses the heuristic: ceil(content.length / 4) + ceil(JSON.stringify(toolCalls).length / 4).
   */
  async estimateSessionTokens(sessionId: string): Promise<number> {
    const rows = await this.prisma.sessionMessage.findMany({
      where: { sessionId, archivedAt: null },
      orderBy: { ordering: 'asc' },
    });

    return rows.reduce((sum, row) => {
      const contentTokens = estimateTokens(row.content);
      const toolCallsTokens =
        row.toolCalls != null ? estimateTokens(JSON.stringify(row.toolCalls)) : 0;
      return sum + contentTokens + toolCallsTokens;
    }, 0);
  }

  /**
   * Return the current token warning state for a session.
   *
   * The warning level is based on the ratio of estimated tokens to the effective
   * context window threshold:
   *  - 'none'       — ratio < 0.75
   *  - 'approaching' — 0.75 ≤ ratio < 0.90
   *  - 'critical'   — ratio ≥ 0.90
   */
  async getTokenWarningState(sessionId: string, threshold?: number): Promise<TokenWarningState> {
    const envTokens = parseInt(process.env['CONTEXT_WINDOW_TOKENS'] ?? '', 10);
    const effectiveThreshold =
      threshold ?? (Number.isNaN(envTokens) ? DEFAULT_CONTEXT_WINDOW_TOKENS : envTokens);

    const estimated = await this.estimateSessionTokens(sessionId);
    const ratio = effectiveThreshold > 0 ? estimated / effectiveThreshold : 0;

    let warning: TokenWarningState['warning'] = 'none';
    if (ratio >= 0.9) {
      warning = 'critical';
    } else if (ratio >= 0.75) {
      warning = 'approaching';
    }

    return { estimated, threshold: effectiveThreshold, ratio, warning };
  }

  /**
   * Check if the session exceeds the context window threshold, and if so,
   * consolidate old messages via LLM summarisation.
   *
   * Chains behind any in-flight consolidation for the same sessionId to
   * prevent concurrent consolidations from racing.
   */
  async consolidateIfNeeded(
    sessionId: string,
    options: ConsolidationOptions,
  ): Promise<ConsolidationResult> {
    const prev =
      this.sessionLocks.get(sessionId) ??
      Promise.resolve<ConsolidationResult>({ consolidated: false });
    const resultPromise = prev.then(() => this.doConsolidate(sessionId, options));
    const chainPromise = resultPromise.catch((): ConsolidationResult => ({ consolidated: false }));
    this.sessionLocks.set(sessionId, chainPromise);
    try {
      return await resultPromise;
    } finally {
      if (this.sessionLocks.get(sessionId) === chainPromise) {
        this.sessionLocks.delete(sessionId);
      }
    }
  }

  /**
   * Core consolidation logic.
   *
   * Up to MAX_CONSOLIDATION_ROUNDS are run. Each round:
   * 1. Loads messages and finds the chunk to consolidate.
   * 2. Calls the LLM with a save_memory tool.
   * 3. On success: deletes old messages, upserts summary, writes MEMORY.md.
   * 4. On 3 consecutive validation failures: falls back to raw archival.
   */
  private async doConsolidate(
    sessionId: string,
    options: ConsolidationOptions,
  ): Promise<ConsolidationResult> {
    const envTokens = parseInt(process.env['CONTEXT_WINDOW_TOKENS'] ?? '', 10);
    const threshold =
      options.contextWindowTokens ??
      (Number.isNaN(envTokens) ? DEFAULT_CONTEXT_WINDOW_TOKENS : envTokens);

    const estimated = await this.estimateSessionTokens(sessionId);
    if (!options.force && estimated <= threshold) {
      logger.debug(
        { sessionId, estimated, threshold },
        'Session under threshold — skipping consolidation',
      );
      return { consolidated: false };
    }

    logger.info(
      { sessionId, estimated, threshold },
      'Session over threshold — starting consolidation',
    );

    const target = Math.floor(threshold / 2);
    let consecutiveFailures = 0;
    let roundsUsed = 0;
    let lastEstimate = estimated;
    let archivedCount = 0;

    for (let round = 0; round < MAX_CONSOLIDATION_ROUNDS; round++) {
      const rows = (await this.prisma.sessionMessage.findMany({
        where: { sessionId, archivedAt: null },
        orderBy: { ordering: 'asc' },
      })) as MessageRow[];

      if (rows.length === 0) break;

      // Find existing summary row (ordering 0, system role, starts with MEMORY_SUMMARY_PREFIX)
      const summaryRow = rows.find(
        (r) =>
          r.ordering === 0 && r.role === 'system' && r.content.startsWith(MEMORY_SUMMARY_PREFIX),
      );

      // Messages eligible for consolidation: everything after the summary row (or all if none)
      const afterSummary = summaryRow
        ? rows.filter((r) => r.ordering > 0 && r.id !== summaryRow.id)
        : rows;

      // Find a consolidation chunk: accumulate messages until we have enough tokens to bring us
      // under target. We consolidate from the beginning of afterSummary, always including at
      // least one full conversation turn (user + assistant) to avoid compacting only one message.
      // When forced (e.g. /compact command) and under threshold, overBy would be negative,
      // so we ensure a minimum of half the estimated tokens to compact a meaningful portion.
      const chunk: MessageRow[] = [];
      let chunkTokens = 0;
      const rawOverBy = estimated - target;
      const overBy = options.force ? Math.max(rawOverBy, Math.floor(estimated / 2)) : rawOverBy;
      let seenAssistant = false;

      for (const row of afterSummary) {
        chunk.push(row);
        chunkTokens +=
          estimateTokens(row.content) +
          (row.toolCalls != null ? estimateTokens(JSON.stringify(row.toolCalls)) : 0);
        if (row.role === 'assistant') {
          seenAssistant = true;
        }
        // Stop at an assistant-turn boundary once we have enough tokens to remove
        // and have included at least one full conversation turn.
        // Breaking on assistant (not user) ensures we never split a user-assistant
        // pair: the chunk always ends with a complete turn, and remaining messages
        // start with the next user message.
        if (chunkTokens >= overBy && row.role === 'assistant' && seenAssistant) {
          break;
        }
      }

      if (chunk.length === 0) {
        logger.warn({ sessionId, round }, 'No messages to consolidate — stopping');
        break;
      }

      // Build the consolidation prompt
      const existingSummary = summaryRow
        ? summaryRow.content.slice(MEMORY_SUMMARY_PREFIX.length).trim()
        : '';

      const compactedChunk = microcompactMessages(chunk);
      const formattedChunk = compactedChunk
        .map((r) => `[${r.createdAt.toISOString()}] ${r.role}: ${r.content}`)
        .join('\n');

      const systemPrompt = buildConsolidationSystemPrompt(existingSummary);

      const userPrompt = buildConsolidationUserPrompt(formattedChunk, options.customInstructions);

      // Resolve provider/key (DB first, env var fallback)
      const providerName = process.env['CONSOLIDATION_PROVIDER'] ?? CONSOLIDATION_PROVIDER;
      let resolved: Awaited<ReturnType<ProviderConfigService['resolveProvider']>>;
      try {
        resolved = await this.providerConfig.resolveProvider(providerName);
      } catch (err: unknown) {
        logger.error({ err, providerName }, 'Cannot resolve API key for consolidation provider');
        consecutiveFailures += MAX_CONSECUTIVE_FAILURES; // trigger fallback
        break;
      }

      const provider = createProvider(
        providerName,
        resolved.apiKey,
        resolved.apiBaseUrl ?? undefined,
      );

      let response;
      let usedAutoFallback = false;
      try {
        response = await provider.chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          {
            model: process.env['CONSOLIDATION_MODEL'] ?? CONSOLIDATION_MODEL,
            tools: [SAVE_MEMORY_TOOL],
            toolChoice: { name: 'save_memory' },
          },
        );

        // Check for finishReason: 'error' with tool_choice rejection in content
        if (response.finishReason === 'error' && isToolChoiceUnsupported(response.content)) {
          logger.warn({ sessionId, round }, 'Forced toolChoice unsupported, retrying with auto');
          usedAutoFallback = true;
          response = await provider.chat(
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            {
              model: process.env['CONSOLIDATION_MODEL'] ?? CONSOLIDATION_MODEL,
              tools: [SAVE_MEMORY_TOOL],
              toolChoice: 'auto',
            },
          );
        }
      } catch (err: unknown) {
        // Check if the thrown error is a tool_choice rejection
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!usedAutoFallback && isToolChoiceUnsupported(errMsg)) {
          logger.warn(
            { sessionId, round },
            'Forced toolChoice unsupported (thrown), retrying with auto',
          );
          try {
            response = await provider.chat(
              [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              {
                model: process.env['CONSOLIDATION_MODEL'] ?? CONSOLIDATION_MODEL,
                tools: [SAVE_MEMORY_TOOL],
                toolChoice: 'auto',
              },
            );
          } catch (retryErr: unknown) {
            consecutiveFailures++;
            logger.warn(
              { err: retryErr, sessionId, round, consecutiveFailures },
              'toolChoice auto retry also failed',
            );
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              await this.rawArchiveFallback(sessionId, chunk, options);
              const postTokens = await this.estimateSessionTokens(sessionId);
              return {
                consolidated: true,
                preTokens: estimated,
                postTokens,
                roundsUsed: round + 1,
                archivedCount: archivedCount + chunk.length,
              };
            }
            continue;
          }
        } else {
          consecutiveFailures++;
          logger.warn(
            { err, sessionId, round, consecutiveFailures },
            'LLM call failed during consolidation',
          );
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            await this.rawArchiveFallback(sessionId, chunk, options);
            const postTokens = await this.estimateSessionTokens(sessionId);
            return {
              consolidated: true,
              preTokens: estimated,
              postTokens,
              roundsUsed: round + 1,
              archivedCount: archivedCount + chunk.length,
            };
          }
          continue;
        }
      }

      // Validate the tool call response
      const saveMemoryCall = response.toolCalls.find((tc) => tc.name === 'save_memory');
      const normalized = saveMemoryCall ? normalizeSaveMemoryArgs(saveMemoryCall.arguments) : null;
      const parseResult = normalized
        ? SaveMemoryArgsSchema.safeParse(normalized)
        : {
            success: false as const,
            error: new Error('No save_memory tool call or unparseable arguments'),
          };

      if (!parseResult.success) {
        consecutiveFailures++;
        logger.warn(
          { sessionId, round, consecutiveFailures, error: String(parseResult.error) },
          'save_memory validation failed',
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          await this.rawArchiveFallback(sessionId, chunk, options);
          const postTokens = await this.estimateSessionTokens(sessionId);
          return {
            consolidated: true,
            preTokens: estimated,
            postTokens,
            roundsUsed: round + 1,
            archivedCount: archivedCount + chunk.length,
          };
        }
        continue;
      }

      // Success — reset failure counter
      consecutiveFailures = 0;
      roundsUsed++;
      const { memory_update } = parseResult.data;

      // Persist: archive consolidated messages + old summary (if any), create new summary
      const idsToArchive = [...chunk.map((r) => r.id), ...(summaryRow ? [summaryRow.id] : [])];

      await this.prisma.sessionMessage.updateMany({
        where: { id: { in: idsToArchive } },
        data: { archivedAt: new Date() },
      });
      archivedCount += idsToArchive.length;

      await this.prisma.sessionMessage.createMany({
        data: [
          {
            sessionId,
            role: 'system',
            content: `${MEMORY_SUMMARY_PREFIX}\n${memory_update}`,
            ordering: 0,
          },
        ],
      });

      // Write memory_update to MEMORY.md if container available
      if (options.containerId && options.containerRunner) {
        const consolidated = `\n## Consolidated\n\n${memory_update}\n`;
        await options.containerRunner
          .exec(
            options.containerId,
            ['sh', '-c', 'mkdir -p /workspace/memory && cat >> /workspace/memory/MEMORY.md'],
            { stdin: consolidated },
          )
          .catch((err: unknown) => {
            logger.warn({ err }, 'Failed to write to MEMORY.md');
          });
      }

      // Update Session.lastConsolidatedAt
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { lastConsolidatedAt: new Date() },
      });

      // Record token usage
      await this.tokenCounter.recordAggregateUsage({
        usage: response.usage,
        agentRunId: options.agentRunId,
        userId: options.userId,
        providerName,
        model: process.env['CONSOLIDATION_MODEL'] ?? CONSOLIDATION_MODEL,
      });

      logger.info(
        { sessionId, round, archivedCount: idsToArchive.length },
        'Memory consolidation round complete',
      );

      // Re-estimate — stop if now under target
      const newEstimate = await this.estimateSessionTokens(sessionId);
      lastEstimate = newEstimate;
      if (newEstimate <= threshold) {
        logger.debug({ sessionId, newEstimate, threshold }, 'Session now under threshold');
        break;
      }
    }

    const postTokens = lastEstimate;
    logger.info(
      {
        sessionId,
        preTokens: estimated,
        postTokens,
        compressionRatio: estimated > 0 ? +(postTokens / estimated).toFixed(3) : 0,
        roundsUsed,
        trigger: options.force ? 'manual' : 'auto',
        threshold,
      },
      'Consolidation complete',
    );
    return { consolidated: true, preTokens: estimated, postTokens, roundsUsed, archivedCount };
  }

  // ---------------------------------------------------------------- //
  //  Raw archive fallback                                             //
  // ---------------------------------------------------------------- //

  /**
   * Fallback when LLM consolidation repeatedly fails.
   * Archives messages in DB (soft-delete) without writing to any file.
   */
  private async rawArchiveFallback(
    sessionId: string,
    chunk: MessageRow[],
    _options: ConsolidationOptions,
  ): Promise<void> {
    logger.warn(
      { sessionId, chunkSize: chunk.length },
      'Falling back to raw archive consolidation (no file write)',
    );

    await this.prisma.sessionMessage.updateMany({
      where: { id: { in: chunk.map((r) => r.id) } },
      data: { archivedAt: new Date() },
    });

    logger.info({ sessionId, archivedCount: chunk.length }, 'Raw archive complete');
  }
}
