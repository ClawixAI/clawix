/**
 * Utility functions for converting between Clawix's internal message format
 * and OpenAI's Responses API format.
 *
 * The Responses API uses a different input/output structure compared to the
 * Chat Completions API. This module handles the translation layer.
 */

import type {
  ChatMessage,
  FinishReason,
  ToolCallRequest,
  ToolDefinition,
} from '@clawix/shared';
import { createLogger } from '@clawix/shared';

const log = createLogger('engine:openai-responses-utils');

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** A tool definition in the Responses API format. */
export interface ResponsesTool {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** A single item in the Responses API input array. */
export type ResponsesInputItem =
  | {
      readonly type: 'message';
      readonly role: 'user' | 'assistant';
      readonly content: ReadonlyArray<{ readonly type: string; readonly text: string }>;
    }
  | {
      readonly type: 'function_call';
      readonly id: string;
      readonly call_id: string;
      readonly name: string;
      readonly arguments: string;
    }
  | {
      readonly type: 'function_call_output';
      readonly call_id: string;
      readonly output: string;
    };

/** Result of converting ChatMessages to Responses API input. */
export interface ResponsesInput {
  readonly instructions: string | undefined;
  readonly input: string | readonly ResponsesInputItem[];
}

/** Parsed output from a Responses API response. */
export interface ParsedResponsesOutput {
  readonly content: string | null;
  readonly toolCalls: readonly ToolCallRequest[];
  readonly finishReason: FinishReason;
}

/* ------------------------------------------------------------------ */
/*  Model detection                                                    */
/* ------------------------------------------------------------------ */

/**
 * Returns true if the model should use the Responses API.
 *
 * Matches models containing 'codex' or matching the gpt-5 family
 * (e.g. gpt-5, gpt-5.1, gpt-5.4).
 */
export function isCodexModel(model: string): boolean {
  if (model.includes('codex')) {
    return true;
  }
  return /^gpt-5(\.\d)?/.test(model);
}

/* ------------------------------------------------------------------ */
/*  Tool conversion                                                    */
/* ------------------------------------------------------------------ */

/** Convert a {@link ToolDefinition} to the Responses API tool format. */
export function toResponsesTool(tool: ToolDefinition): ResponsesTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  };
}

/* ------------------------------------------------------------------ */
/*  Message conversion                                                 */
/* ------------------------------------------------------------------ */

/**
 * Convert an array of {@link ChatMessage} to Responses API input format.
 *
 * - System messages are extracted and joined as `instructions`.
 * - A single user message with no history is returned as a plain string `input`.
 * - Otherwise, messages are converted to the Responses API input item array.
 */
export function toResponsesInput(messages: readonly ChatMessage[]): ResponsesInput {
  const systemMessages: string[] = [];
  const nonSystemMessages: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push(msg.content);
    } else {
      nonSystemMessages.push(msg);
    }
  }

  const instructions =
    systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined;

  // Simple case: single user message → plain string input
  const firstMsg = nonSystemMessages[0];
  if (nonSystemMessages.length === 1 && firstMsg && firstMsg.role === 'user') {
    return { instructions, input: firstMsg.content };
  }

  const items: ResponsesInputItem[] = [];

  for (const msg of nonSystemMessages) {
    switch (msg.role) {
      case 'user':
        items.push({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: msg.content }],
        });
        break;

      case 'assistant':
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            // Responses API requires IDs starting with 'fc_'
            const fcId = tc.id.startsWith('fc_') ? tc.id : `fc_${tc.id}`;
            items.push({
              type: 'function_call',
              id: fcId,
              call_id: fcId,
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            });
          }
        } else {
          items.push({
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: msg.content }],
          });
        }
        break;

      case 'tool': {
        const toolCallId = msg.toolCallId ?? '';
        const fcCallId = toolCallId.startsWith('fc_') ? toolCallId : `fc_${toolCallId}`;
        items.push({
          type: 'function_call_output',
          call_id: fcCallId,
          output: msg.content,
        });
        break;
      }

      default:
        // system messages already extracted above
        break;
    }
  }

  return { instructions, input: items };
}

/* ------------------------------------------------------------------ */
/*  Output parsing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Parse Responses API output items into a normalized result.
 *
 * - Items with `type: 'message'` have their `output_text` content extracted.
 * - Items with `type: 'function_call'` are parsed into {@link ToolCallRequest}.
 * - finishReason is `'tool_use'` if any tool calls are present, else `'stop'`.
 */
export function parseResponsesOutput(
  output: readonly Record<string, unknown>[],
): ParsedResponsesOutput {
  const textParts: string[] = [];
  const toolCalls: ToolCallRequest[] = [];

  for (const item of output) {
    if (item['type'] === 'message') {
      const content = item['content'] as readonly Record<string, unknown>[] | undefined;
      if (content) {
        for (const part of content) {
          if (part['type'] === 'output_text' && typeof part['text'] === 'string') {
            textParts.push(part['text']);
          }
        }
      }
    } else if (item['type'] === 'function_call') {
      const id = (item['call_id'] ?? item['id'] ?? '') as string;
      const name = (item['name'] ?? '') as string;
      const rawArgs = item['arguments'];

      try {
        const args =
          typeof rawArgs === 'string'
            ? (JSON.parse(rawArgs) as Record<string, unknown>)
            : (rawArgs as Record<string, unknown>) ?? {};

        toolCalls.push({ id, name, arguments: args });
      } catch (error) {
        log.error(
          { id, name, rawArguments: rawArgs, error },
          'Failed to parse Responses API function_call arguments — skipping',
        );
      }
    }
  }

  const content = textParts.length > 0 ? textParts.join('') : null;
  const finishReason: FinishReason = toolCalls.length > 0 ? 'tool_use' : 'stop';

  return { content, toolCalls, finishReason };
}
