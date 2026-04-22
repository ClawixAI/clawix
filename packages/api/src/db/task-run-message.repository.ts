import { Injectable } from '@nestjs/common';
import type { Prisma, TaskRunMessage } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface TaskRunMessageInput {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: unknown;
}

@Injectable()
export class TaskRunMessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async appendMany(
    taskRunId: string,
    messages: readonly TaskRunMessageInput[],
  ): Promise<readonly string[]> {
    const currentCount = await this.prisma.taskRunMessage.count({ where: { taskRunId } });
    const ids: string[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      const created = await this.prisma.taskRunMessage.create({
        data: {
          taskRunId,
          role: msg.role,
          content: msg.content,
          ordering: currentCount + i,
          ...(msg.toolCallId !== undefined ? { toolCallId: msg.toolCallId } : {}),
          ...(msg.toolCalls !== undefined
            ? { toolCalls: msg.toolCalls as Prisma.InputJsonValue }
            : {}),
        },
      });
      ids.push(created.id);
    }
    return ids;
  }

  async findByTaskRunId(taskRunId: string): Promise<readonly TaskRunMessage[]> {
    return this.prisma.taskRunMessage.findMany({
      where: { taskRunId },
      orderBy: { ordering: 'asc' },
    });
  }

  async countByTaskRunId(taskRunId: string): Promise<number> {
    return this.prisma.taskRunMessage.count({ where: { taskRunId } });
  }
}
