/**
 * CompressorService — produces a compressed messages array when the agent
 * runner hits context_overflow. Algorithm: split conversation at the
 * 2nd-to-last user-message boundary; truncate large tool/system content
 * in the older portion (microcompact-style); summarize via a small LLM
 * call; emit:
 *   [original system messages] +
 *   [synthetic summary system message] +
 *   [last 2 user-message cycles verbatim]
 *
 * If the resulting messages still exceed the model's context window, the
 * next provider call fails again and the recovery loop's compress budget
 * (max 1) is exhausted — the original context_overflow error surfaces to
 * the user. The compressor itself does not know context-window sizes.
 */

import { Injectable, Optional } from '@nestjs/common';
import { createLogger } from '@clawix/shared';
import type { ChatMessage } from '@clawix/shared';

import { buildConsolidationSystemPrompt, buildConsolidationUserPrompt } from './compact-prompt.js';
import { ProviderConfigService } from '../provider-config/provider-config.service.js';
import { SystemSettingsService } from '../system-settings/system-settings.service.js';
import { createProvider as defaultCreateProvider } from './providers/index.js';

const logger = createLogger('engine:compressor');

const COMPRESSION_KEEP_RECENT_CYCLES = 2;
const COMPRESSION_MODEL_SETTING_KEY = 'compressionModel';
const TRUNCATION_THRESHOLD = 500;
const TRUNCATABLE_ROLES = new Set(['tool', 'system']);

interface ProviderModelRef {
  readonly provider: string;
  readonly model: string;
}

interface ProviderFactory {
  readonly create: typeof defaultCreateProvider;
}

/**
 * Walk backwards through messages and return the index of the first
 * message in the keep-verbatim section (immediately at or before the
 * Nth-from-last user message). Returns -1 when there are fewer than N
 * user-message cycles — caller should leave messages unchanged in that
 * case.
 */
function findVerbatimBoundary(messages: readonly ChatMessage[], keepCycles: number): number {
  let userSeen = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === 'user') {
      userSeen += 1;
      if (userSeen === keepCycles) return i;
    }
  }
  return -1;
}

/**
 * Return true when boundary `b` is safe with respect to tool_use/tool_result
 * pairing. A boundary is unsafe when:
 *   1. The kept side starts with a `role === 'tool'` message (orphan tool_result
 *      whose tool_use assistant message is on the older side), OR
 *   2. An assistant message on the older side (index < b) has toolCalls whose
 *      ids appear as `toolCallId` on messages at index >= b (cross-cut pair).
 */
function isBoundarySafe(messages: readonly ChatMessage[], b: number): boolean {
  // Condition 1: orphan tool_result at start of kept side.
  if (messages[b]?.role === 'tool') return false;

  // Condition 2: any tool_use on older side whose tool_result is on kept side.
  const olderToolUseIds = new Set<string>();
  for (let i = 0; i < b; i++) {
    const m = messages[i]!;
    if (m.role === 'assistant' && m.toolCalls) {
      for (const tc of m.toolCalls) {
        if (tc.id) olderToolUseIds.add(tc.id);
      }
    }
  }
  if (olderToolUseIds.size === 0) return true;

  for (let i = b; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === 'tool' && m.toolCallId && olderToolUseIds.has(m.toolCallId)) return false;
  }
  return true;
}

/**
 * Find a safe verbatim boundary that does not split tool_use/tool_result
 * pairs. Starts from the candidate returned by `findVerbatimBoundary` and
 * walks backward one user-message anchor at a time until the boundary is
 * safe. Returns -1 if no safe boundary can be found (caller should leave
 * messages unchanged).
 */
function findSafeBoundary(messages: readonly ChatMessage[], keepCycles: number): number {
  let boundary = findVerbatimBoundary(messages, keepCycles);
  if (boundary <= 0) return boundary;

  while (boundary > 0 && !isBoundarySafe(messages, boundary)) {
    // Walk back to the previous user-message anchor.
    let prevUser = -1;
    for (let i = boundary - 1; i >= 0; i--) {
      if (messages[i]!.role === 'user') {
        prevUser = i;
        break;
      }
    }
    if (prevUser < 0) return -1;
    boundary = prevUser;
  }

  return isBoundarySafe(messages, boundary) ? boundary : -1;
}

/**
 * Truncate large tool/system content in the older portion before sending
 * to the summarizer. User and assistant messages are preserved intact.
 * Returns a new array (no mutation).
 */
function truncateLargeContent(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  return messages.map((msg) => {
    if (!TRUNCATABLE_ROLES.has(msg.role)) return msg;
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content.length <= TRUNCATION_THRESHOLD) return msg;
    const replacement =
      msg.role === 'tool'
        ? `[tool result truncated — originally ${content.length} chars]`
        : `[system message truncated — originally ${content.length} chars]`;
    return { ...msg, content: replacement } as ChatMessage;
  });
}

/**
 * Format messages into a human-readable string for the summarizer LLM.
 */
function formatMessagesForSummarizer(messages: readonly ChatMessage[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n');
}

@Injectable()
export class CompressorService {
  private readonly providerFactory: ProviderFactory;

  constructor(
    private readonly providerConfig: ProviderConfigService,
    private readonly systemSettings: SystemSettingsService,
    @Optional() providerFactory?: ProviderFactory,
  ) {
    this.providerFactory = providerFactory ?? { create: defaultCreateProvider };
  }

  /**
   * Compress messages into [system + summary + last N cycles verbatim].
   * Falls back to fallbackProviderModel if SystemSettings.compressionModel
   * is unset or invalid.
   */
  async compress(
    messages: readonly ChatMessage[],
    fallbackProviderModel: ProviderModelRef,
  ): Promise<readonly ChatMessage[]> {
    const boundary = findSafeBoundary(messages, COMPRESSION_KEEP_RECENT_CYCLES);
    if (boundary <= 0) {
      // Not enough user cycles to bother compressing, or no safe boundary found.
      return messages;
    }

    const systemMessages = messages.filter((m) => m.role === 'system');
    const beforeBoundary = messages.slice(0, boundary).filter((m) => m.role !== 'system');
    // Filter system messages from afterBoundary to prevent duplication — they are
    // already captured in systemMessages above and prepended to the output.
    const afterBoundary = messages.slice(boundary).filter((m) => m.role !== 'system');

    const truncated = truncateLargeContent(beforeBoundary);
    const modelRef = await this.resolveCompressionModel(fallbackProviderModel);
    const summaryText = await this.callSummarizer(truncated, modelRef);

    return [
      ...systemMessages,
      {
        role: 'system',
        content: `[Earlier conversation summary]\n${summaryText}`,
      } as ChatMessage,
      ...afterBoundary,
    ];
  }

  /* ---------------------------- private helpers ---------------------------- */

  private async resolveCompressionModel(fallback: ProviderModelRef): Promise<ProviderModelRef> {
    try {
      const settings = (await this.systemSettings.get()) as Record<string, unknown>;
      const cm = settings[COMPRESSION_MODEL_SETTING_KEY];
      if (
        cm !== null &&
        cm !== undefined &&
        typeof cm === 'object' &&
        'provider' in cm &&
        'model' in cm &&
        typeof (cm as ProviderModelRef).provider === 'string' &&
        typeof (cm as ProviderModelRef).model === 'string'
      ) {
        const ref = cm as ProviderModelRef;
        await this.providerConfig.resolveProvider(ref.provider);
        return ref;
      }
    } catch (err) {
      logger.warn({ err }, 'compressionModel setting invalid — falling back to agent model');
    }
    return fallback;
  }

  private async callSummarizer(
    older: readonly ChatMessage[],
    modelRef: ProviderModelRef,
  ): Promise<string> {
    const resolved = await this.providerConfig.resolveProvider(modelRef.provider);
    const provider = this.providerFactory.create(
      modelRef.provider,
      resolved.apiKey,
      resolved.apiBaseUrl ?? undefined,
      modelRef.model,
    );
    const sysPrompt = buildConsolidationSystemPrompt('');
    const formattedChunk = formatMessagesForSummarizer(older);
    const userPrompt = buildConsolidationUserPrompt(formattedChunk);

    const response = await provider.chat(
      [
        { role: 'system', content: sysPrompt } as ChatMessage,
        { role: 'user', content: userPrompt } as ChatMessage,
      ],
      { model: modelRef.model },
    );
    return response.content ?? '';
  }
}
