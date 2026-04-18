/**
 * OpenAI LLM provider — wraps the `openai` SDK and normalizes responses
 * to the shared {@link LLMProvider} interface.
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
  mapFinishReason,
  mapToolChoice,
  parseToolCalls,
  toOpenAIMessage,
  toOpenAITool,
} from './openai-utils.js';

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_MAX_TOKENS = 4096;

const log = createLogger('engine:openai');

/**
 * Returns true for o-series models (o1, o3, o4, etc.) that require
 * max_completion_tokens instead of max_tokens.
 */
function isReasoningModel(model: string): boolean {
  return /^o[1-9]/.test(model);
}

/**
 * LLM provider for OpenAI models (GPT-4o, GPT-4o-mini, etc.).
 *
 * Wraps the official `openai` SDK and normalizes responses to the
 * shared {@link LLMResponse} format used throughout Clawix.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
  }

  async chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const model = options?.model ?? DEFAULT_MODEL;
    const maxTokens = options?.settings?.maxTokens ?? DEFAULT_MAX_TOKENS;

    log.debug({ model, messageCount: messages.length }, 'Sending chat request');

    const toolChoiceParam = mapToolChoice(options?.toolChoice);

    // o-series reasoning models use max_completion_tokens instead of max_tokens
    const useCompletionTokens = isReasoningModel(model);

    const requestBody: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: messages.map(toOpenAIMessage),
      ...(useCompletionTokens
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens }),
      ...(options?.settings?.temperature !== undefined && {
        temperature: options.settings.temperature,
      }),
      ...(options?.settings?.topP !== undefined && {
        top_p: options.settings.topP,
      }),
      ...(options?.settings?.stopSequences && {
        stop: options.settings.stopSequences as string[],
      }),
      ...(options?.tools &&
        options.tools.length > 0 && {
          tools: options.tools.map(toOpenAITool),
        }),
      ...(toolChoiceParam !== undefined && {
        tool_choice: toolChoiceParam,
      }),
    };

    const response = await this.client.chat.completions.create(requestBody);

    const choice = response.choices[0];
    if (!choice) {
      log.warn('OpenAI response had no choices');
      return createLLMResponse({ finishReason: 'error' });
    }

    const finishReason = mapFinishReason(choice.finish_reason);
    const toolCalls = parseToolCalls(choice.message.tool_calls);

    log.debug(
      {
        model,
        finishReason,
        toolCallCount: toolCalls.length,
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
      },
      'Received chat response',
    );

    return createLLMResponse({
      content: choice.message.content ?? null,
      toolCalls,
      finishReason,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    });
  }
}
