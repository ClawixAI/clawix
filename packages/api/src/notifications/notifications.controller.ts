import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';

import type { JwtPayload } from '../auth/auth.types.js';
import type { Notification } from '../generated/prisma/client.js';
import { NotificationRepository } from '../db/notification.repository.js';

interface AuthenticatedRequest {
  readonly user: JwtPayload;
}

/**
 * Bell-style notification feed. Read-only listing + per-row and bulk
 * mark-read. Notification creation is internal (services fan out rows
 * directly via NotificationRepository) and not exposed here.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly repo: NotificationRepository) {}

  @Get()
  async list(
    @Query('unread') unread: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ items: readonly Notification[]; unreadCount: number }> {
    const [items, unreadCount] = await Promise.all([
      this.repo.listForRecipient(req.user.sub, { unreadOnly: unread === 'true' }),
      this.repo.countUnread(req.user.sub),
    ]);
    return { items, unreadCount };
  }

  @Post(':id/read')
  @HttpCode(204)
  async markRead(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.repo.markRead(id, req.user.sub);
  }

  @Post('read-all')
  @HttpCode(204)
  async markAllRead(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.repo.markAllRead(req.user.sub);
  }
}
