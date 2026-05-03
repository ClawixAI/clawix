/**
 * Anthropic LLM provider — wraps the `@anthropic-ai/sdk` and normalizes responses
 * to the shared {@link LLMProvider} interface.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  createLLMResponse,
  createLogger,
  type ChatMessage,
  type ChatOptions,
  type LLMProvider,
  type LLMResponse,
  type ToolCallRequest,
} from '@clawix/shared';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;

const log = createLogger('engine:anthropic');

function mapStopReason(reason: string | null): 'stop' | 'tool_use' | 'max_tokens' | 'error' {
  switch (reason) {
    case 'end_turn':
      return 'stop';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return 'error';
  }
}

function toAnthropicMessage(msg: ChatMessage): Anthropic.MessageParam {
  if (msg.role === 'tool') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: msg.toolCallId ?? '',
          content: msg.content,
        },
      ],
    };
  }

  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    const contentBlocks: Anthropic.ContentBlockParam[] = [];
    if (msg.content) {
      contentBlocks.push({ type: 'text', text: msg.content });
    }
    for (const tc of msg.toolCalls) {
      contentBlocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.arguments as Record<string, unknown>,
      });
    }
    return { role: 'assistant', content: contentBlocks };
  }

  return {
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  };
}

function toAnthropicTool(tool: {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}

export interface AnthropicProviderOptions {
  /**
   * Whether to inject Anthropic prompt-caching markers (`cache_control`) on
   * the system block and last tool definition. Defaults to true.
   * Set to false for Anthropic-wire-compatible third-party gateways
   * (e.g. kimi-code) that may not support cache_control.
   */
  readonly enableCaching?: boolean;
}

/**
 * LLM provider for Anthropic Claude models.
 *
 * Wraps the official `@anthropic-ai/sdk` and normalizes responses to the
 * shared {@link LLMResponse} format used throughout Clawix.
 *
 * Key differences from OpenAI:
 * - System prompt is a top-level `system` param, not a message in the array
 * - Returns content blocks (text + tool_use) instead of a single content string
 * - Uses `stop_reason` instead of `finish_reason`
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly enableCaching: boolean;

  constructor(apiKey: string, baseURL?: string, options?: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    this.enableCaching = options?.enableCaching ?? true;
  }

  async chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const model = options?.model ?? DEFAULT_MODEL;
    const maxTokens = options?.settings?.maxTokens ?? DEFAULT_MAX_TOKENS;

    log.debug({ model, messageCount: messages.length }, 'Sending chat request');

    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const systemBlock: Anthropic.MessageCreateParamsNonStreaming['system'] | undefined = systemMsg
      ? this.enableCaching
        ? [{ type: 'text', text: systemMsg.content, cache_control: { type: 'ephemeral' } }]
        : systemMsg.content
      : undefined;

    const baseTools =
      options?.tools && options.tools.length > 0 ? options.tools.map(toAnthropicTool) : undefined;
    const toolsForRequest: Anthropic.Tool[] | undefined =
      baseTools && this.enableCaching
        ? baseTools.map((tool, idx) =>
            idx === baseTools.length - 1
              ? ({ ...tool, cache_control: { type: 'ephemeral' } } as Anthropic.Tool)
              : tool,
          )
        : baseTools;

    const requestParams: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      messages: nonSystemMessages.map(toAnthropicMessage),
      ...(systemBlock !== undefined ? { system: systemBlock } : {}),
      ...(options?.settings?.temperature !== undefined && {
        temperature: options.settings.temperature,
      }),
      ...(options?.settings?.topP !== undefined && {
        top_p: options.settings.topP,
      }),
      ...(options?.settings?.stopSequences && {
        stop_sequences: options.settings.stopSequences as string[],
      }),
      ...(toolsForRequest ? { tools: toolsForRequest } : {}),
    };

    const response = await this.client.messages.create(
      requestParams,
      options?.abortSignal ? { signal: options.abortSignal } : undefined,
    );

    let textContent = '';
    const toolCalls: ToolCallRequest[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    const finishReason = mapStopReason(response.stop_reason);

    const cacheCreation = response.usage.cache_creation_input_tokens ?? undefined;
    const cacheRead = response.usage.cache_read_input_tokens ?? undefined;
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const totalTokens = inputTokens + outputTokens + (cacheCreation ?? 0) + (cacheRead ?? 0);

    log.debug(
      {
        model,
        finishReason,
        toolCallCount: toolCalls.length,
        inputTokens,
        outputTokens,
        cacheCreationInputTokens: cacheCreation,
        cacheReadInputTokens: cacheRead,
      },
      'Received chat response',
    );

    return createLLMResponse({
      content: textContent || null,
      toolCalls,
      finishReason,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        ...(cacheCreation !== undefined ? { cacheCreationInputTokens: cacheCreation } : {}),
        ...(cacheRead !== undefined ? { cacheReadInputTokens: cacheRead } : {}),
      },
    });
  }
}
