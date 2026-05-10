import { Injectable } from '@nestjs/common';

import type { Notification, NotificationType, Prisma } from '../generated/prisma/client.js';
import { NotificationRepository } from '../db/notification.repository.js';
import { NotificationsGateway } from './notifications.gateway.js';

interface CreateInput {
  readonly recipientId: string;
  readonly type: NotificationType;
  readonly payload: Prisma.InputJsonValue;
}

/**
 * Single funnel for "create a notification + tell the user". Workflow services
 * (e.g. GroupAccessService) call this instead of the bare repo so we never
 * forget to broadcast — and unit tests can mock one collaborator instead of
 * two.
 */
@Injectable()
export class NotificationFanoutService {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(input: CreateInput): Promise<Notification> {
    const row = await this.repo.create(input);
    // Broadcast best-effort. WS delivery is supplementary — the row is the
    // source of truth and the bell's poll/REST path will catch it anyway.
    try {
      this.gateway.notify(input.recipientId, row);
    } catch {
      // Swallow — never fail a write because a socket was misbehaving.
    }
    return row;
  }
}
