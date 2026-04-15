import { Injectable } from '@nestjs/common';

import type { MemoryItem } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { extractText } from '../engine/memory-utils.js';

/**
 * Repository for querying MemoryItem records visible to a user.
 *
 * Visibility rules:
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
   * Search visible memory items by text content and/or tags.
   *
   * Two-pass approach: fetches all visible items via findVisibleToUser,
   * then filters in-app by query (case-insensitive substring on content.text)
   * and tags (AND — all specified tags must be present).
   */
  async search(
    userId: string,
    options: {
      readonly query?: string;
      readonly tags?: readonly string[];
      readonly maxResults?: number;
    },
  ): Promise<readonly MemoryItem[]> {
    const allVisible = await this.findVisibleToUser(userId);
    const maxResults = options.maxResults ?? 20;

    let filtered = allVisible as MemoryItem[];

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
