import type { ChatMessage } from '@clawix/shared';

/**
 * Persistence abstraction for agent run transcripts.
 *
 * Two implementations:
 *   - SessionMessageStore — user-chat sessions (SessionMessage table).
 *   - TaskRunMessageStore — scheduled task runs (TaskRunMessage table).
 */
export interface MessageStore {
  loadMessages(): Promise<ChatMessage[]>;
  saveMessages(messages: readonly ChatMessage[]): Promise<readonly string[]>;
}
