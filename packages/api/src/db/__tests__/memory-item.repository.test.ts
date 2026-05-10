import { describe, it, expect, beforeEach } from 'vitest';

import { MemoryItemRepository } from '../memory-item.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('MemoryItemRepository', () => {
  let repo: MemoryItemRepository;
  let mockPrisma: MockPrismaService;

  const mockMemoryItem = {
    id: 'mem-1',
    ownerId: 'user-1',
    content: { text: 'User prefers concise answers' },
    tags: ['preference'],
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-15'),
  };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repo = new MemoryItemRepository(mockPrisma as unknown as PrismaService);
  });

  describe('findVisibleToUser', () => {
    it('queries with OR for private, group-shared, and org-shared items', async () => {
      mockPrisma.groupMember.findMany.mockResolvedValue([{ groupId: 'group-1', userId: 'user-1' }]);
      mockPrisma.memoryItem.findMany.mockResolvedValue([mockMemoryItem]);

      const result = await repo.findVisibleToUser('user-1');

      expect(mockPrisma.groupMember.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { groupId: true },
      });

      expect(mockPrisma.memoryItem.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { ownerId: 'user-1' },
            {
              shares: {
                some: {
                  targetType: 'GROUP',
                  groupId: { in: ['group-1'] },
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

      expect(result).toEqual([mockMemoryItem]);
    });

    it('should handle user with no group memberships', async () => {
      mockPrisma.groupMember.findMany.mockResolvedValue([]);
      mockPrisma.memoryItem.findMany.mockResolvedValue([mockMemoryItem]);

      await repo.findVisibleToUser('user-1');

      const call = mockPrisma.memoryItem.findMany.mock.calls[0]![0]!;
      const orClauses = (call as Record<string, unknown>)['where'] as Record<string, unknown[]>;
      const groupClause = orClauses['OR']![1] as Record<string, unknown>;
      const shares = groupClause['shares'] as Record<string, Record<string, unknown>>;
      expect(shares['some']!['groupId']).toEqual({ in: [] });
    });

    it('should return empty array when no memory items exist', async () => {
      mockPrisma.groupMember.findMany.mockResolvedValue([]);
      mockPrisma.memoryItem.findMany.mockResolvedValue([]);

      const result = await repo.findVisibleToUser('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('inserts a row with ownerId, content, tags', async () => {
      mockPrisma.memoryItem.create.mockResolvedValue(mockMemoryItem);

      const result = await repo.create({
        ownerId: 'user-1',
        content: { text: 'hello' },
        tags: ['domain:hr', 'public'],
      });

      expect(mockPrisma.memoryItem.create).toHaveBeenCalledWith({
        data: {
          ownerId: 'user-1',
          content: { text: 'hello' },
          tags: ['domain:hr', 'public'],
        },
      });
      expect(result).toEqual(mockMemoryItem);
    });

    it('defaults tags to [] when not provided', async () => {
      mockPrisma.memoryItem.create.mockResolvedValue(mockMemoryItem);

      await repo.create({ ownerId: 'user-1', content: 'plain text' });

      expect(mockPrisma.memoryItem.create).toHaveBeenCalledWith({
        data: { ownerId: 'user-1', content: 'plain text', tags: [] },
      });
    });
  });

  describe('update', () => {
    it('patches content and tags', async () => {
      mockPrisma.memoryItem.update.mockResolvedValue({ ...mockMemoryItem, tags: ['domain:hr'] });

      await repo.update('mem-1', { content: 'new', tags: ['domain:hr'] });

      expect(mockPrisma.memoryItem.update).toHaveBeenCalledWith({
        where: { id: 'mem-1' },
        data: { content: 'new', tags: ['domain:hr'] },
      });
    });

    it('omits undefined fields from the patch', async () => {
      mockPrisma.memoryItem.update.mockResolvedValue(mockMemoryItem);

      await repo.update('mem-1', { tags: ['domain:hr'] });

      expect(mockPrisma.memoryItem.update).toHaveBeenCalledWith({
        where: { id: 'mem-1' },
        data: { tags: ['domain:hr'] },
      });
    });
  });

  describe('delete', () => {
    it('deletes by id', async () => {
      mockPrisma.memoryItem.delete.mockResolvedValue(mockMemoryItem);

      await repo.delete('mem-1');

      expect(mockPrisma.memoryItem.delete).toHaveBeenCalledWith({
        where: { id: 'mem-1' },
      });
    });
  });

  describe('findById', () => {
    it('returns the row when found', async () => {
      mockPrisma.memoryItem.findUnique.mockResolvedValue(mockMemoryItem);

      const result = await repo.findById('mem-1');

      expect(mockPrisma.memoryItem.findUnique).toHaveBeenCalledWith({ where: { id: 'mem-1' } });
      expect(result).toEqual(mockMemoryItem);
    });

    it('returns null when not found (does not throw)', async () => {
      mockPrisma.memoryItem.findUnique.mockResolvedValue(null);

      const result = await repo.findById('missing');

      expect(result).toBeNull();
    });
  });

  describe('listOwnedByUser', () => {
    it('returns rows owned by the user, newest first', async () => {
      mockPrisma.memoryItem.findMany.mockResolvedValue([mockMemoryItem]);

      const result = await repo.listOwnedByUser('user-1');

      expect(mockPrisma.memoryItem.findMany).toHaveBeenCalledWith({
        where: { ownerId: 'user-1' },
        orderBy: { updatedAt: 'desc' },
      });
      expect(result).toEqual([mockMemoryItem]);
    });
  });

  describe('search', () => {
    const mockItems = [
      {
        id: 'mem-1',
        ownerId: 'user-1',
        content: { text: 'User prefers dark mode' },
        tags: ['preference', 'ui'],
        createdAt: new Date('2026-03-01'),
        updatedAt: new Date('2026-03-15'),
      },
      {
        id: 'mem-2',
        ownerId: 'user-2',
        content: { text: 'API uses OAuth2' },
        tags: ['project', 'decision'],
        createdAt: new Date('2026-03-02'),
        updatedAt: new Date('2026-03-14'),
      },
      {
        id: 'mem-3',
        ownerId: 'user-1',
        content: { text: 'Dark theme is preferred for all dashboards' },
        tags: ['preference'],
        createdAt: new Date('2026-03-03'),
        updatedAt: new Date('2026-03-13'),
      },
    ];

    beforeEach(() => {
      mockPrisma.groupMember.findMany.mockResolvedValue([]);
      mockPrisma.memoryItem.findMany.mockResolvedValue(mockItems);
    });

    it('filters by query (case-insensitive substring on content.text)', async () => {
      const result = await repo.search('user-1', { query: 'dark' });

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('mem-1');
      expect(result[1]!.id).toBe('mem-3');
    });

    it('filters by tags (AND logic — all tags must be present)', async () => {
      const result = await repo.search('user-1', { tags: ['preference', 'ui'] });

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('mem-1');
    });

    it('filters by query + tags combined (AND)', async () => {
      const result = await repo.search('user-1', { query: 'dark', tags: ['preference', 'ui'] });

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('mem-1');
    });

    it('returns empty array when no matches', async () => {
      const result = await repo.search('user-1', { query: 'nonexistent' });

      expect(result).toEqual([]);
    });

    it('limits results to maxResults (default 20)', async () => {
      const manyItems = Array.from({ length: 25 }, (_, i) => ({
        ...mockItems[0]!,
        id: `mem-${i}`,
        updatedAt: new Date(2026, 2, i + 1),
      }));
      mockPrisma.memoryItem.findMany.mockResolvedValue(manyItems);

      const result = await repo.search('user-1', { query: 'dark' });

      expect(result).toHaveLength(20);
    });

    it('accepts a custom maxResults', async () => {
      const result = await repo.search('user-1', { query: 'dark', maxResults: 1 });

      expect(result).toHaveLength(1);
    });
  });

  describe('findDailyNotes', () => {
    it('should return items with daily: tags from the last N days', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const dailyItem = {
        id: 'mem-daily-1',
        ownerId: 'user-1',
        content: { text: 'Daily note for today' },
        tags: [`daily:${today}`],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.memoryItem.findMany.mockResolvedValue([dailyItem]);

      const result = await repo.findDailyNotes('user-1', 3);

      expect(mockPrisma.memoryItem.findMany).toHaveBeenCalledWith({
        where: {
          ownerId: 'user-1',
          tags: {
            hasSome: expect.arrayContaining([`daily:${today}`]),
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(result).toEqual([dailyItem]);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tags: expect.arrayContaining([`daily:${today}`]),
          }),
        ]),
      );
    });

    it('should generate tags for the correct number of days', async () => {
      mockPrisma.memoryItem.findMany.mockResolvedValue([]);

      await repo.findDailyNotes('user-1', 5);

      const call = mockPrisma.memoryItem.findMany.mock.calls[0]![0] as {
        where: { tags: { hasSome: string[] } };
      };
      const tags = call.where.tags.hasSome;

      expect(tags).toHaveLength(5);
      for (const tag of tags) {
        expect(tag).toMatch(/^daily:\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('should return empty array when no daily notes exist', async () => {
      mockPrisma.memoryItem.findMany.mockResolvedValue([]);

      const result = await repo.findDailyNotes('user-1', 3);

      expect(result).toEqual([]);
    });

    it('should return empty array when days <= 0', async () => {
      const resultZero = await repo.findDailyNotes('user-1', 0);
      const resultNegative = await repo.findDailyNotes('user-1', -5);

      expect(resultZero).toEqual([]);
      expect(resultNegative).toEqual([]);
      expect(mockPrisma.memoryItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findDistinctTags', () => {
    it('should return unique non-daily tags visible to user', async () => {
      const items = [
        {
          id: 'mem-1',
          ownerId: 'user-1',
          content: { text: 'Preference item' },
          tags: ['preference', 'ui'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'mem-2',
          ownerId: 'user-1',
          content: { text: 'Daily note' },
          tags: ['daily:2026-04-10', 'preference'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'mem-3',
          ownerId: 'user-1',
          content: { text: 'Project decision' },
          tags: ['project', 'decision'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.groupMember.findMany.mockResolvedValue([]);
      mockPrisma.memoryItem.findMany.mockResolvedValue(items);

      const tags = await repo.findDistinctTags('user-1');

      expect(tags).toContain('preference');
      expect(tags).toContain('ui');
      expect(tags).toContain('project');
      expect(tags).toContain('decision');
      expect(tags).not.toContain('daily:2026-04-10');
      // Should not contain any daily: tags
      for (const tag of tags) {
        expect(tag).not.toMatch(/^daily:/);
      }
    });

    it('should return tags sorted alphabetically', async () => {
      const items = [
        {
          id: 'mem-1',
          ownerId: 'user-1',
          content: { text: 'Item' },
          tags: ['zebra', 'alpha', 'middle'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.groupMember.findMany.mockResolvedValue([]);
      mockPrisma.memoryItem.findMany.mockResolvedValue(items);

      const tags = await repo.findDistinctTags('user-1');

      expect(tags).toEqual(['alpha', 'middle', 'zebra']);
    });

    it('should deduplicate tags across items', async () => {
      const items = [
        {
          id: 'mem-1',
          ownerId: 'user-1',
          content: { text: 'Item 1' },
          tags: ['preference'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'mem-2',
          ownerId: 'user-1',
          content: { text: 'Item 2' },
          tags: ['preference'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.groupMember.findMany.mockResolvedValue([]);
      mockPrisma.memoryItem.findMany.mockResolvedValue(items);

      const tags = await repo.findDistinctTags('user-1');

      expect(tags).toEqual(['preference']);
    });

    it('should return empty array when no items exist', async () => {
      mockPrisma.groupMember.findMany.mockResolvedValue([]);
      mockPrisma.memoryItem.findMany.mockResolvedValue([]);

      const tags = await repo.findDistinctTags('user-1');

      expect(tags).toEqual([]);
    });
  });
});
