/**
 * OpenAI Responses API provider — wraps the `openai` SDK's Responses API
 * and normalizes responses to the shared {@link LLMProvider} interface.
 *
 * Used for Codex and GPT-5.x models that require the Responses API
 * instead of the Chat Completions API.
 */

import OpenAI from 'openai';
import {
  createLLMResponse,
  createLogger,
  type ChatMessage,
  type ChatOptions,
  type LLMProvider,
  type LLMResponse,
} from '@clawix/shared';

import {
  toResponsesInput,
  toResponsesTool,
  parseResponsesOutput,
} from './openai-responses-utils.js';

const DEFAULT_MAX_TOKENS = 16384;

const log = createLogger('engine:openai-responses');

/**
 * LLM provider for OpenAI models using the Responses API (Codex, GPT-5.x).
 *
 * Wraps the official `openai` SDK and normalizes responses to the
 * shared {@link LLMResponse} format used throughout Clawix.
 */
export class OpenAIResponsesProvider implements LLMProvider {
  readonly name = 'openai-responses';
  private readonly client: OpenAI;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      timeout: 120_000, // 2 minute per-request timeout
    });
  }

  async chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const model = options?.model ?? 'gpt-5.1-codex-mini';
    const maxTokens = options?.settings?.maxTokens ?? DEFAULT_MAX_TOKENS;

    log.debug({ model, messageCount: messages.length }, 'Sending Responses API request');

    const { instructions, input } = toResponsesInput(messages);
    const tools =
      options?.tools && options.tools.length > 0
        ? options.tools.map(toResponsesTool)
        : undefined;

    try {
      // Use the responses.create() method from the OpenAI SDK.
      // The TypeScript types may not be updated yet, so we cast through `any`.
      const response = await (this.client as any).responses.create({
        model,
        input,
        ...(instructions ? { instructions } : {}),
        ...(tools ? { tools } : {}),
        ...(options?.settings?.temperature !== undefined && {
          temperature: options.settings.temperature,
        }),
        max_output_tokens: maxTokens,
      });

      const output = (response.output ?? []) as readonly Record<string, unknown>[];
      const usage = response.usage as
        | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
        | undefined;

      const parsed = parseResponsesOutput(output);

      log.debug(
        {
          model,
          finishReason: parsed.finishReason,
          toolCallCount: parsed.toolCalls.length,
          inputTokens: usage?.input_tokens,
          outputTokens: usage?.output_tokens,
        },
        'Received Responses API response',
      );

      return createLLMResponse({
        content: parsed.content,
        toolCalls: parsed.toolCalls,
        finishReason: parsed.finishReason,
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ model, error: message }, 'Responses API call failed');
      throw err;
    }
  }
}
