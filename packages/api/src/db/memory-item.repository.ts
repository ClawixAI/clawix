import { Injectable } from '@nestjs/common';

import type { MemoryItem, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { extractText } from '../engine/memory-utils.js';

interface CreateMemoryItemData {
  readonly ownerId: string;
  readonly content: unknown;
  readonly tags?: readonly string[];
}

interface UpdateMemoryItemData {
  readonly content?: unknown;
  readonly tags?: readonly string[];
}

/**
 * Repository for MemoryItem records.
 *
 * Visibility rules for `findVisibleToUser` (matches the original Phase-1 plan):
 *  - Private: owned by the user
 *  - Group-shared: shared to a group the user belongs to (not revoked)
 *  - Org-shared: shared to the entire org (not revoked)
 */
@Injectable()
export class MemoryItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find all memory items visible to the given user, ordered by most recent first.
   */
  async findVisibleToUser(userId: string): Promise<readonly MemoryItem[]> {
    const groupRows = await this.prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    const groupIds = groupRows.map((r) => r.groupId);

    return this.prisma.memoryItem.findMany({
      where: {
        OR: [
          { ownerId: userId },
          {
            shares: {
              some: {
                targetType: 'GROUP',
                groupId: { in: groupIds },
                isRevoked: false,
              },
            },
          },
          {
            shares: {
              some: {
                targetType: 'ORG',
                isRevoked: false,
              },
            },
          },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Filter the given memoryItem ids down to those with an active
   * `MemoryShare(targetType=ORG, isRevoked=false)` row. Used to derive
   * the `isOrgShared` flag returned to the dashboard.
   */
  async findItemIdsWithOrgShare(itemIds: readonly string[]): Promise<readonly string[]> {
    if (itemIds.length === 0) return [];
    const rows = await this.prisma.memoryShare.findMany({
      where: {
        memoryItemId: { in: [...itemIds] },
        targetType: 'ORG',
        isRevoked: false,
      },
      select: { memoryItemId: true },
    });
    return rows.map((r) => r.memoryItemId);
  }

  /**
   * Add an active `MemoryShare(ORG)` row for this memoryItem if one isn't
   * already in place. Idempotent: revives a previously-revoked org share
   * row instead of creating a duplicate.
   */
  async setOrgShare(memoryItemId: string, sharedBy: string): Promise<void> {
    const existing = await this.prisma.memoryShare.findFirst({
      where: { memoryItemId, targetType: 'ORG' },
    });
    if (existing) {
      if (existing.isRevoked) {
        await this.prisma.memoryShare.update({
          where: { id: existing.id },
          data: { isRevoked: false, revokedAt: null },
        });
      }
      return;
    }
    await this.prisma.memoryShare.create({
      data: { memoryItemId, sharedBy, targetType: 'ORG' },
    });
  }

  /** Mark every active org-share row for this memoryItem as revoked. */
  async revokeOrgShare(memoryItemId: string): Promise<void> {
    await this.prisma.memoryShare.updateMany({
      where: { memoryItemId, targetType: 'ORG', isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
  }

  async create(data: CreateMemoryItemData): Promise<MemoryItem> {
    return this.prisma.memoryItem.create({
      data: {
        ownerId: data.ownerId,
        content: data.content as Prisma.InputJsonValue,
        tags: [...(data.tags ?? [])],
      },
    });
  }

  async update(id: string, data: UpdateMemoryItemData): Promise<MemoryItem> {
    const patch: Record<string, unknown> = {};
    if (data.content !== undefined) patch['content'] = data.content;
    if (data.tags !== undefined) patch['tags'] = [...data.tags];
    return this.prisma.memoryItem.update({
      where: { id },
      data: patch as Prisma.MemoryItemUpdateInput,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.memoryItem.delete({ where: { id } });
  }

  async findById(id: string): Promise<MemoryItem | null> {
    return this.prisma.memoryItem.findUnique({ where: { id } });
  }

  async listOwnedByUser(userId: string): Promise<readonly MemoryItem[]> {
    return this.prisma.memoryItem.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Search memory items by text content and/or tags.
   *
   * Two-pass approach: fetches the candidate set (owned-only when scope='mine',
   * full visible set otherwise), then filters in-app by query
   * (case-insensitive substring on content.text) and tags (AND — all specified
   * tags must be present).
   */
  async search(
    userId: string,
    options: {
      readonly query?: string;
      readonly tags?: readonly string[];
      readonly maxResults?: number;
      readonly scope?: 'mine' | 'visible';
    },
  ): Promise<readonly MemoryItem[]> {
    const candidates =
      options.scope === 'mine'
        ? await this.listOwnedByUser(userId)
        : await this.findVisibleToUser(userId);
    const maxResults = options.maxResults ?? 20;

    let filtered = candidates as MemoryItem[];

    if (options.query) {
      const lowerQuery = options.query.toLowerCase();
      filtered = filtered.filter((item) => {
        const text = extractText(item.content);
        return text.toLowerCase().includes(lowerQuery);
      });
    }

    if (options.tags && options.tags.length > 0) {
      filtered = filtered.filter((item) => options.tags!.every((tag) => item.tags.includes(tag)));
    }

    return filtered.slice(0, maxResults);
  }

  /**
   * Find daily note memory items for the last N days, owned by the user.
   * Daily notes are tagged with `daily:YYYY-MM-DD`.
   *
   * Scoped to ownerId only (not group/org-shared) — daily notes are per-user private by design.
   */
  async findDailyNotes(userId: string, days: number): Promise<readonly MemoryItem[]> {
    if (days <= 0) {
      return [];
    }

    const tags: string[] = [];
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      tags.push(`daily:${date.toISOString().slice(0, 10)}`);
    }

    return this.prisma.memoryItem.findMany({
      where: {
        ownerId: userId,
        tags: { hasSome: tags },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Return all unique tags across visible memory items, excluding daily: tags.
   */
  async findDistinctTags(userId: string): Promise<readonly string[]> {
    const items = await this.findVisibleToUser(userId);
    const tagSet = new Set<string>();
    for (const item of items) {
      for (const tag of item.tags) {
        if (!tag.startsWith('daily:')) {
          tagSet.add(tag);
        }
      }
    }
    return [...tagSet].sort();
  }
}
