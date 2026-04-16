/**
 * Microcompact — pre-processing pass that strips large tool results from messages
 * before they are sent to the consolidation LLM.
 *
 * This reduces token cost of the summarization call without affecting DB state.
 * Only tool-result and system messages exceeding the threshold are truncated.
 * User and assistant messages are always preserved intact.
 */

/** Content length threshold (chars). Messages with content at or below this are kept intact. */
const TRUNCATION_THRESHOLD = 500;

/** Roles eligible for truncation. User and assistant messages are never truncated. */
const TRUNCATABLE_ROLES = new Set(['tool', 'system']);

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

/**
 * Return a new array of messages with large tool/system content replaced by
 * a truncation marker. Original objects are never mutated.
 */
export function microcompactMessages(messages: readonly MessageRow[]): readonly MessageRow[] {
  return messages.map((msg) => {
    if (!TRUNCATABLE_ROLES.has(msg.role)) return msg;
    if (msg.content.length <= TRUNCATION_THRESHOLD) return msg;
    return {
      ...msg,
      content:
        msg.role === 'tool'
          ? `[tool result truncated - originally ${msg.content.length} chars]`
          : `[system message truncated - originally ${msg.content.length} chars]`,
    };
  });
}
