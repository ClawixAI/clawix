import { describe, it, expect, beforeEach } from 'vitest';

import { WikiPageRepository } from '../wiki-page.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

const now = new Date('2026-05-17T00:00:00Z');

function makeWikiPage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'page-1',
    ownerId: 'user-1',
    title: 'Leave Policy',
    slug: 'leave-policy',
    summary: 's',
    content: 'c',
    tags: [] as string[],
    scope: 'ARCHIVED' as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('WikiPageRepository', () => {
  let repo: WikiPageRepository;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repo = new WikiPageRepository(mockPrisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('derives a unique slug from title', async () => {
      // No conflict found → returns the base slug
      mockPrisma.wikiPage.findFirst.mockResolvedValue(null);
      mockPrisma.wikiPage.create.mockResolvedValue(makeWikiPage({ slug: 'leave-policy' }));

      const result = await repo.create({
        ownerId: 'user-1',
        title: 'Leave Policy',
        summary: 's',
        content: 'c',
      });

      expect(mockPrisma.wikiPage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'leave-policy', ownerId: 'user-1' }),
        }),
      );
      expect(result.slug).toBe('leave-policy');
    });

    it('appends -2 when base slug is taken', async () => {
      // First call (base slug check) → conflict; second call → no conflict
      mockPrisma.wikiPage.findFirst
        .mockResolvedValueOnce(makeWikiPage()) // 'leave-policy' taken
        .mockResolvedValueOnce(null); // 'leave-policy-2' free
      mockPrisma.wikiPage.create.mockResolvedValue(makeWikiPage({ slug: 'leave-policy-2' }));

      const result = await repo.create({
        ownerId: 'user-1',
        title: 'Leave Policy',
        summary: 's',
        content: 'c',
      });

      expect(result.slug).toBe('leave-policy-2');
      expect(mockPrisma.wikiPage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'leave-policy-2' }),
        }),
      );
    });

    it('normalizes tags to lowercase', async () => {
      mockPrisma.wikiPage.findFirst.mockResolvedValue(null);
      mockPrisma.wikiPage.create.mockResolvedValue(
        makeWikiPage({ tags: ['domain:hr', 'kind:profile'] }),
      );

      await repo.create({
        ownerId: 'user-1',
        title: 'X',
        summary: 's',
        content: 'c',
        tags: ['Domain:HR', 'KIND:Profile'],
      });

      expect(mockPrisma.wikiPage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tags: ['domain:hr', 'kind:profile'] }),
        }),
      );
    });

    it('defaults scope to ARCHIVED when not provided', async () => {
      mockPrisma.wikiPage.findFirst.mockResolvedValue(null);
      mockPrisma.wikiPage.create.mockResolvedValue(makeWikiPage({ scope: 'ARCHIVED' }));

      await repo.create({ ownerId: 'user-1', title: 'T', summary: 's', content: 'c' });

      expect(mockPrisma.wikiPage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ scope: 'ARCHIVED' }),
        }),
      );
    });

    it('rejects the reserved slug "_schema"', async () => {
      await expect(
        repo.create({ ownerId: 'user-1', title: '_schema', summary: 's', content: 'c' }),
      ).rejects.toThrow(/reserved/i);
      expect(mockPrisma.wikiPage.create).not.toHaveBeenCalled();
    });
  });

  describe('updateByOwner', () => {
    it('returns null when page does not exist', async () => {
      mockPrisma.wikiPage.findUnique.mockResolvedValue(null);

      const result = await repo.updateByOwner('bob', 'page-99', { content: 'x' });
      expect(result).toBeNull();
    });

    it('returns null when caller is not the owner', async () => {
      mockPrisma.wikiPage.findUnique.mockResolvedValue(makeWikiPage({ ownerId: 'alice' }));

      const result = await repo.updateByOwner('bob', 'page-1', { content: 'x' });
      expect(result).toBeNull();
      expect(mockPrisma.wikiPage.update).not.toHaveBeenCalled();
    });

    it('updates content when caller is the owner', async () => {
      const existing = makeWikiPage({ ownerId: 'alice' });
      mockPrisma.wikiPage.findUnique.mockResolvedValue(existing);
      mockPrisma.wikiPage.update.mockResolvedValue({ ...existing, content: 'new content' });

      const result = await repo.updateByOwner('alice', 'page-1', { content: 'new content' });

      expect(mockPrisma.wikiPage.update).toHaveBeenCalledWith({
        where: { id: 'page-1' },
        data: expect.objectContaining({ content: 'new content' }),
      });
      expect(result).not.toBeNull();
    });

    it('normalizes tags to lowercase on update', async () => {
      const existing = makeWikiPage({ ownerId: 'alice' });
      mockPrisma.wikiPage.findUnique.mockResolvedValue(existing);
      mockPrisma.wikiPage.update.mockResolvedValue({ ...existing, tags: ['domain:hr'] });

      await repo.updateByOwner('alice', 'page-1', { tags: ['Domain:HR'] });

      expect(mockPrisma.wikiPage.update).toHaveBeenCalledWith({
        where: { id: 'page-1' },
        data: expect.objectContaining({ tags: ['domain:hr'] }),
      });
    });
  });

  describe('deleteByOwner', () => {
    it('returns false when page not found', async () => {
      mockPrisma.wikiPage.findUnique.mockResolvedValue(null);
      const result = await repo.deleteByOwner('alice', 'page-99');
      expect(result).toBe(false);
      expect(mockPrisma.wikiPage.delete).not.toHaveBeenCalled();
    });

    it('returns false when caller is not the owner', async () => {
      mockPrisma.wikiPage.findUnique.mockResolvedValue(makeWikiPage({ ownerId: 'alice' }));
      const result = await repo.deleteByOwner('bob', 'page-1');
      expect(result).toBe(false);
    });

    it('deletes and returns true when caller is the owner', async () => {
      mockPrisma.wikiPage.findUnique.mockResolvedValue(makeWikiPage({ ownerId: 'alice' }));
      mockPrisma.wikiPage.delete.mockResolvedValue(makeWikiPage({ ownerId: 'alice' }));

      const result = await repo.deleteByOwner('alice', 'page-1');
      expect(result).toBe(true);
      expect(mockPrisma.wikiPage.delete).toHaveBeenCalledWith({ where: { id: 'page-1' } });
    });
  });

  describe('findById', () => {
    it('returns the row when found', async () => {
      const page = makeWikiPage();
      mockPrisma.wikiPage.findUnique.mockResolvedValue(page);

      const result = await repo.findById('page-1');
      expect(mockPrisma.wikiPage.findUnique).toHaveBeenCalledWith({ where: { id: 'page-1' } });
      expect(result).toEqual(page);
    });

    it('returns null when not found', async () => {
      mockPrisma.wikiPage.findUnique.mockResolvedValue(null);
      const result = await repo.findById('missing');
      expect(result).toBeNull();
    });
  });

  describe('findBySlug', () => {
    it('resolves within owner namespace', async () => {
      const page = makeWikiPage();
      mockPrisma.wikiPage.findUnique.mockResolvedValue(page);

      const result = await repo.findBySlug('user-1', 'leave-policy');

      expect(mockPrisma.wikiPage.findUnique).toHaveBeenCalledWith({
        where: { ownerId_slug: { ownerId: 'user-1', slug: 'leave-policy' } },
      });
      expect(result?.id).toBe('page-1');
    });
  });

  describe('findVisibleToUser', () => {
    it('queries with OR for owned, group-shared, and org-shared pages', async () => {
      mockPrisma.groupMember.findMany.mockResolvedValue([{ groupId: 'group-1', userId: 'user-1' }]);
      mockPrisma.wikiPage.findMany.mockResolvedValue([makeWikiPage()]);

      const result = await repo.findVisibleToUser('user-1');

      expect(mockPrisma.groupMember.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { groupId: true },
      });
      expect(mockPrisma.wikiPage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { ownerId: 'user-1' },
              expect.objectContaining({
                shares: expect.objectContaining({
                  some: expect.objectContaining({ targetType: 'GROUP' }),
                }),
              }),
              expect.objectContaining({
                shares: expect.objectContaining({
                  some: expect.objectContaining({ targetType: 'ORG' }),
                }),
              }),
            ]),
          }),
        }),
      );
      expect(result).toEqual([makeWikiPage()]);
    });

    it('handles user with no group memberships', async () => {
      mockPrisma.groupMember.findMany.mockResolvedValue([]);
      mockPrisma.wikiPage.findMany.mockResolvedValue([]);

      await repo.findVisibleToUser('user-1');

      const call = mockPrisma.wikiPage.findMany.mock.calls[0]![0] as {
        where: { OR: unknown[] };
      };
      const groupClause = call.where.OR[1] as { shares: { some: { groupId: { in: string[] } } } };
      expect(groupClause.shares.some.groupId.in).toEqual([]);
    });
  });

  describe('countAmbientOwnedBy', () => {
    it('counts only AMBIENT scope pages for the owner', async () => {
      mockPrisma.wikiPage.count.mockResolvedValue(2);

      const result = await repo.countAmbientOwnedBy('user-1');

      expect(mockPrisma.wikiPage.count).toHaveBeenCalledWith({
        where: { ownerId: 'user-1', scope: 'AMBIENT' },
      });
      expect(result).toBe(2);
    });
  });

  describe('countOwnedBy', () => {
    it('counts all pages owned by user', async () => {
      mockPrisma.wikiPage.count.mockResolvedValue(5);

      const result = await repo.countOwnedBy('user-1');

      expect(mockPrisma.wikiPage.count).toHaveBeenCalledWith({
        where: { ownerId: 'user-1' },
      });
      expect(result).toBe(5);
    });
  });

  describe('findDailyNotes', () => {
    it('queries tags with daily: prefix for last N days', async () => {
      mockPrisma.wikiPage.findMany.mockResolvedValue([]);

      await repo.findDailyNotes('user-1', 3);

      const call = mockPrisma.wikiPage.findMany.mock.calls[0]![0] as {
        where: { tags: { hasSome: string[] } };
      };
      expect(call.where.tags.hasSome).toHaveLength(3);
      for (const tag of call.where.tags.hasSome) {
        expect(tag).toMatch(/^daily:\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  describe('findDistinctTagsVisibleToUser', () => {
    it('returns sorted unique tags excluding daily: tags', async () => {
      mockPrisma.groupMember.findMany.mockResolvedValue([]);
      mockPrisma.wikiPage.findMany.mockResolvedValue([
        makeWikiPage({ tags: ['domain:hr', 'kind:profile', 'daily:2026-05-17'] }),
        makeWikiPage({ id: 'page-2', tags: ['domain:hr', 'kind:person'] }),
      ]);

      const tags = await repo.findDistinctTagsVisibleToUser('user-1');

      expect(tags).toEqual(['domain:hr', 'kind:person', 'kind:profile']);
      expect(tags).not.toContain('daily:2026-05-17');
    });
  });
});
