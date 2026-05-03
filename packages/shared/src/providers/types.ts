/**
 * Core LLM provider types for multi-provider abstraction.
 */

/** Reason the model stopped generating. */
export type FinishReason = 'stop' | 'tool_use' | 'max_tokens' | 'error';

/** A request from the model to invoke a tool. */
export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  /**
   * Provider-specific opaque payload that must be roundtripped through the message
   * history. Gemini stores `{ google: { thoughtSignature: string } }` here so the
   * signature can be echoed back on subsequent turns. Other providers ignore it.
   */
  readonly providerExtra?: Readonly<Record<string, unknown>>;
}

/** Token usage for a single LLM call. */
export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /**
   * Tokens written to the prompt cache on this call (Anthropic only).
   * Charged at 1.25× the regular input rate (5-min TTL).
   * Undefined for providers that don't support prompt caching.
   */
  readonly cacheCreationInputTokens?: number;
  /**
   * Tokens read from the prompt cache on this call (Anthropic only).
   * Charged at 0.1× the regular input rate (90% discount).
   * Undefined for providers that don't support prompt caching.
   */
  readonly cacheReadInputTokens?: number;
}

/** An extended-thinking block returned by the model. */
export interface ThinkingBlock {
  readonly type: 'thinking';
  readonly thinking: string;
}

/** Normalized response from any LLM provider. */
export interface LLMResponse {
  readonly content: string | null;
  readonly toolCalls: readonly ToolCallRequest[];
  readonly finishReason: FinishReason;
  readonly usage: LLMUsage;
  readonly thinkingBlocks: readonly ThinkingBlock[] | null;
}

/** Tuning knobs passed to the model. */
export interface GenerationSettings {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly stopSequences?: readonly string[];
}

const EMPTY_TOOL_CALLS: readonly ToolCallRequest[] = Object.freeze([]);

const ZERO_USAGE: LLMUsage = Object.freeze({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

/**
 * Type guard: checks whether `value` is a valid {@link ToolCallRequest}.
 */
export function isToolCallRequest(value: unknown): value is ToolCallRequest {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }

  if (Array.isArray(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj['id'] === 'string' &&
    typeof obj['name'] === 'string' &&
    typeof obj['arguments'] === 'object' &&
    obj['arguments'] !== null &&
    !Array.isArray(obj['arguments'])
  );
}

/**
 * Factory: creates an {@link LLMResponse} with sensible defaults.
 *
 * Defaults: content=null, toolCalls=[], finishReason='stop',
 * usage=zero, thinkingBlocks=null.
 */
export function createLLMResponse(partial: Partial<LLMResponse>): LLMResponse {
  return {
    content: partial.content ?? null,
    toolCalls: partial.toolCalls ?? EMPTY_TOOL_CALLS,
    finishReason: partial.finishReason ?? 'stop',
    usage: partial.usage ?? ZERO_USAGE,
    thinkingBlocks: partial.thinkingBlocks ?? null,
  };
}
