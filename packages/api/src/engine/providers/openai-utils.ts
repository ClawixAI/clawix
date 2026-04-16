/**
 * Shared utility functions for OpenAI-compatible providers.
 *
 * Used by {@link OpenAIProvider} and other OpenAI-compatible providers to avoid
 * code duplication for message/tool conversion, finish-reason mapping,
 * and tool-call parsing.
 */

import type OpenAI from 'openai';
import type {
  ChatMessage,
  ChatOptions,
  FinishReason,
  ToolCallRequest,
  ToolDefinition,
} from '@clawix/shared';
import { createLogger } from '@clawix/shared';

const log = createLogger('engine:openai-utils');

/** Map OpenAI finish reasons to our normalized {@link FinishReason}. */
export function mapFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'stop':
      return 'stop';
    case 'content_filter':
      return 'error';
    default:
      return 'stop';
  }
}

/** Convert a {@link ChatMessage} to the OpenAI SDK message format. */
export function toOpenAIMessage(msg: ChatMessage): OpenAI.ChatCompletionMessageParam {
  if (msg.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: msg.toolCallId ?? '',
      content: msg.content,
    };
  }

  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: msg.content,
      tool_calls: msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    };
  }

  return {
    role: msg.role,
    content: msg.content,
  };
}

/** Convert a {@link ToolDefinition} to the OpenAI tool format. */
export function toOpenAITool(tool: ToolDefinition): OpenAI.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  };
}

/**
 * Parse tool calls from an OpenAI response choice.
 *
 * Malformed JSON in tool-call arguments is logged and the bad call is
 * filtered out rather than throwing an unhandled error.
 */
export function parseToolCalls(
  toolCalls: OpenAI.ChatCompletionMessageToolCall[] | undefined | null,
): readonly ToolCallRequest[] {
  if (!toolCalls || toolCalls.length === 0) {
    return [];
  }

  return toolCalls
    .filter((tc): tc is OpenAI.ChatCompletionMessageFunctionToolCall => tc.type === 'function')
    .map((tc) => {
      try {
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        };
      } catch (error) {
        log.error(
          { toolCallId: tc.id, name: tc.function.name, rawArguments: tc.function.arguments, error },
          'Failed to parse tool call arguments — skipping tool call',
        );
        return null;
      }
    })
    .filter((tc): tc is ToolCallRequest => tc !== null);
}

/**
 * Map the normalized `toolChoice` option to the OpenAI `tool_choice` parameter.
 */
export function mapToolChoice(
  toolChoice: ChatOptions['toolChoice'],
): OpenAI.ChatCompletionToolChoiceOption | undefined {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (toolChoice === 'auto' || toolChoice === 'none') {
    return toolChoice;
  }

  return {
    type: 'function',
    function: { name: toolChoice.name },
  };
}
