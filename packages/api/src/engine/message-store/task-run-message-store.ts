import type { ChatMessage } from '@clawix/shared';
import type { TaskRunMessageRepository } from '../../db/task-run-message.repository.js';
import type { MessageStore } from './message-store.js';

export class TaskRunMessageStore implements MessageStore {
  constructor(
    private readonly repo: TaskRunMessageRepository,
    private readonly taskRunId: string,
  ) {}

  async loadMessages(): Promise<ChatMessage[]> {
    const rows = await this.repo.findByTaskRunId(this.taskRunId);
    return rows.map((row) => {
      const base: ChatMessage = {
        role: row.role as ChatMessage['role'],
        content: row.content,
      };
      return {
        ...base,
        ...(row.toolCallId != null ? { toolCallId: row.toolCallId } : {}),
        ...(row.toolCalls != null
          ? { toolCalls: row.toolCalls as unknown as ChatMessage['toolCalls'] }
          : {}),
      };
    });
  }

  saveMessages(messages: readonly ChatMessage[]): Promise<readonly string[]> {
    return this.repo.appendMany(
      this.taskRunId,
      messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: m.content,
        ...(m.toolCallId !== undefined ? { toolCallId: m.toolCallId } : {}),
        ...(m.toolCalls !== undefined ? { toolCalls: m.toolCalls } : {}),
      })),
    );
  }
}
