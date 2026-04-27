/**
 * LLM provider interface — the contract every provider must implement.
 */

import type { GenerationSettings, LLMResponse, ToolCallRequest } from './types.js';

/** Schema definition for a tool the model may invoke. */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** A single message in a multi-turn conversation. */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly senderId?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ToolCallRequest[];
}

/** Options for a chat completion request. */
export interface ChatOptions {
  readonly model?: string;
  readonly tools?: readonly ToolDefinition[];
  readonly settings?: GenerationSettings;
  readonly toolChoice?: 'auto' | 'none' | { readonly name: string };
  /**
   * Abort signal forwarded to the underlying SDK call. When the signal fires,
   * the in-flight HTTP request to the provider is cancelled — closing the
   * socket so the provider stops generating (and billing) tokens.
   */
  readonly abortSignal?: AbortSignal;
}

/** Common interface for all LLM providers. */
export interface LLMProvider {
  readonly name: string;
  chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<LLMResponse>;
}
