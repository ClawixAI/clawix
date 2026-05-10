import { Injectable } from '@nestjs/common';

import type { Notification, NotificationType, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface CreateInput {
  readonly recipientId: string;
  readonly type: NotificationType;
  readonly payload: Prisma.InputJsonValue;
}

/**
 * Minimal `Notification` repo. Read/list helpers and read/unread flips land
 * in Task 12 alongside the bell UI; this stub exists so workflow services
 * (e.g. GroupAccessService) can fan out a row when state changes.
 */
@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateInput): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        recipientId: input.recipientId,
        type: input.type,
        payload: input.payload,
      },
    });
  }

  async listForRecipient(
    recipientId: string,
    options: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<readonly Notification[]> {
    return this.prisma.notification.findMany({
      where: {
        recipientId,
        ...(options.unreadOnly ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 50,
    });
  }

  async countUnread(recipientId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientId, isRead: false },
    });
  }

  /**
   * Mark a single notification as read but only if it belongs to the caller.
   * Atomic: returns true if the row matched the recipient guard, false if
   * the recipient mismatched (don't leak existence to other users).
   */
  async markRead(id: string, recipientId: string): Promise<boolean> {
    const result = await this.prisma.notification.updateMany({
      where: { id, recipientId },
      data: { isRead: true },
    });
    return result.count === 1;
  }

  async markAllRead(recipientId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId, isRead: false },
      data: { isRead: true },
    });
    return result.count;
  }
}
