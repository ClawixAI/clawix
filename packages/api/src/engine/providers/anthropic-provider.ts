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

  constructor(apiKey: string, baseURL?: string) {
    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
  }

  async chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const model = options?.model ?? DEFAULT_MODEL;
    const maxTokens = options?.settings?.maxTokens ?? DEFAULT_MAX_TOKENS;

    log.debug({ model, messageCount: messages.length }, 'Sending chat request');

    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const requestParams: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      messages: nonSystemMessages.map(toAnthropicMessage),
      ...(systemMsg ? { system: systemMsg.content } : {}),
      ...(options?.settings?.temperature !== undefined && {
        temperature: options.settings.temperature,
      }),
      ...(options?.settings?.topP !== undefined && {
        top_p: options.settings.topP,
      }),
      ...(options?.settings?.stopSequences && {
        stop_sequences: options.settings.stopSequences as string[],
      }),
      ...(options?.tools &&
        options.tools.length > 0 && {
          tools: options.tools.map(toAnthropicTool),
        }),
    };

    const response = await this.client.messages.create(requestParams);

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

    log.debug(
      {
        model,
        finishReason,
        toolCallCount: toolCalls.length,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      'Received chat response',
    );

    return createLLMResponse({
      content: textContent || null,
      toolCalls,
      finishReason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    });
  }
}
