import type { ChatMessage } from '@clawix/shared';

/**
 * Decide which of a run's persisted loop messages should be HIDDEN from the
 * chat-history display so that history mirrors what the user saw live.
 *
 * A streamed run surfaced every reasoning step to the user as its own chat
 * bubble, so all steps stay visible in history. A non-streamed run only ever
 * showed the user a single combined final reply — so the intermediate assistant
 * prose and tool-call/result steps are hidden from history, leaving just the
 * final assistant message (which equals the live `result.output`).
 *
 * The rows are still persisted in full (the reasoning loop's tool-call/result
 * pairs are required to reconstruct conversation context on the next turn); only
 * their visibility in the history display endpoint changes.
 *
 * @param messages - The loop-generated messages being persisted, in order.
 * @param streamingUsed - Whether the run actually streamed steps to the user.
 * @returns A boolean array aligned to `messages` (`true` = hide from history).
 *   All-false when streamed, or when no assistant message exists (defensive —
 *   never hide every message).
 */
export function computeHiddenInHistory(
  messages: readonly ChatMessage[],
  streamingUsed: boolean,
): boolean[] {
  if (streamingUsed) return messages.map(() => false);

  let finalAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') {
      finalAssistantIdx = i;
      break;
    }
  }
  if (finalAssistantIdx === -1) return messages.map(() => false);

  return messages.map((_, i) => i !== finalAssistantIdx);
}
