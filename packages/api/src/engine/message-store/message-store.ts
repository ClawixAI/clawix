import type { ChatMessage } from '@clawix/shared';

/** Options for persisting a batch of messages. */
export interface SaveMessagesOptions {
  /**
   * Per-message flag, aligned to the `messages` array. `true` hides the row
   * from the chat-history display endpoint (used for the intermediate steps of
   * a non-streamed run). Stores that lack a history surface may ignore it.
   */
  readonly hiddenInHistory?: readonly boolean[];
}

/**
 * Persistence abstraction for agent run transcripts.
 *
 * Two implementations:
 *   - SessionMessageStore — user-chat sessions (SessionMessage table).
 *   - TaskRunMessageStore — scheduled task runs (TaskRunMessage table).
 */
export interface MessageStore {
  loadMessages(): Promise<ChatMessage[]>;
  saveMessages(
    messages: readonly ChatMessage[],
    opts?: SaveMessagesOptions,
  ): Promise<readonly string[]>;
}
