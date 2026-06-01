import type { ChatMessage } from '@clawix/shared';
import type { SessionManagerService } from '../session-manager.service.js';
import type { MessageStore, SaveMessagesOptions } from './message-store.js';

export class SessionMessageStore implements MessageStore {
  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly sessionId: string,
  ) {}

  loadMessages(): Promise<ChatMessage[]> {
    return this.sessionManager.loadMessages(this.sessionId);
  }

  saveMessages(
    messages: readonly ChatMessage[],
    opts?: SaveMessagesOptions,
  ): Promise<readonly string[]> {
    return this.sessionManager.saveMessages(this.sessionId, messages, opts);
  }
}
