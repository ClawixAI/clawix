import { Injectable } from '@nestjs/common';

import type { WikiShare } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class WikiShareRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensures an active ORG share row exists for the page.
   * - If no row exists: creates a new one.
   * - If a revoked row exists: un-revokes it (idempotent).
   * - If an active row already exists: returns it unchanged.
   */
  async setOrgShare(pageId: string, sharedBy: string): Promise<WikiShare> {
    const existing = await this.prisma.wikiShare.findFirst({
      where: { pageId, targetType: 'ORG' },
    });

    if (existing) {
      if (!existing.isRevoked) return existing;
      return this.prisma.wikiShare.update({
        where: { id: existing.id },
        data: { isRevoked: false, revokedAt: null, sharedBy, sharedAt: new Date() },
      });
    }

    return this.prisma.wikiShare.create({
      data: { pageId, sharedBy, targetType: 'ORG' },
    });
  }

  /**
   * Revokes all active ORG shares for the given page.
   */
  async revokeOrgShare(pageId: string): Promise<void> {
    await this.prisma.wikiShare.updateMany({
      where: { pageId, targetType: 'ORG', isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
  }

  /**
   * Ensures an active GROUP share row exists for the page + group combination.
   * Same idempotency semantics as setOrgShare.
   */
  async setGroupShare(pageId: string, groupId: string, sharedBy: string): Promise<WikiShare> {
    const existing = await this.prisma.wikiShare.findFirst({
      where: { pageId, targetType: 'GROUP', groupId },
    });

    if (existing) {
      if (!existing.isRevoked) return existing;
      return this.prisma.wikiShare.update({
        where: { id: existing.id },
        data: { isRevoked: false, revokedAt: null, sharedBy, sharedAt: new Date() },
      });
    }

    return this.prisma.wikiShare.create({
      data: { pageId, sharedBy, targetType: 'GROUP', groupId },
    });
  }

  /**
   * Revokes a single share by ID.
   * @returns `true` if the row was revoked, `false` if it was already revoked.
   */
  async revokeShareById(shareId: string): Promise<boolean> {
    const res = await this.prisma.wikiShare.updateMany({
      where: { id: shareId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
    return res.count > 0;
  }

  /**
   * Returns all active (non-revoked) shares for the given page.
   */
  async findActiveSharesForPage(pageId: string): Promise<readonly WikiShare[]> {
    return this.prisma.wikiShare.findMany({ where: { pageId, isRevoked: false } });
  }

  /**
   * Given a list of page IDs, returns the subset that have an active ORG share.
   * Used by the dashboard service to derive the `isOrgShared` flag in bulk.
   */
  async findPageIdsWithOrgShare(pageIds: readonly string[]): Promise<readonly string[]> {
    if (pageIds.length === 0) return [];

    const rows = await this.prisma.wikiShare.findMany({
      where: { pageId: { in: [...pageIds] }, targetType: 'ORG', isRevoked: false },
      select: { pageId: true },
    });

    return rows.map((r) => r.pageId);
  }
}
