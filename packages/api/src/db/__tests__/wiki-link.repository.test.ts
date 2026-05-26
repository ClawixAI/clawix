import { describe, it, expect, beforeEach } from 'vitest';

import { WikiLinkRepository } from '../wiki-link.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

const now = new Date('2026-05-17T00:00:00Z');

function makeWikiLink(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'link-1',
    fromPageId: 'page-a',
    toPageId: 'page-b',
    ...overrides,
  };
}

function makeWikiPage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'page-a',
    ownerId: 'user-1',
    title: 'Page A',
    slug: 'page-a',
    summary: 's',
    content: 'c',
    tags: [] as string[],
    scope: 'ARCHIVED' as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('WikiLinkRepository', () => {
  let repo: WikiLinkRepository;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repo = new WikiLinkRepository(mockPrisma as unknown as PrismaService);
  });

  describe('rebuildForPage', () => {
    it('creates links for resolved slugs and ignores unresolved ones', async () => {
      // Pages a, b, c exist; 'unknown-slug' does not
      const pageA = makeWikiPage({ id: 'page-a', slug: 'a' });
      const pageB = makeWikiPage({ id: 'page-b', slug: 'b' });
      const pageC = makeWikiPage({ id: 'page-c', slug: 'c' });

      // wikiPage.findMany resolves b and c only (unknown-slug not found)
      mockPrisma.wikiPage.findMany.mockResolvedValue([pageB, pageC]);
      // No existing links for page-a
      mockPrisma.wikiLink.findMany.mockResolvedValue([]);
      mockPrisma.wikiLink.create.mockResolvedValue(makeWikiLink());
      mockPrisma.wikiLink.deleteMany.mockResolvedValue({ count: 0 });

      await repo.rebuildForPage(pageA.id, 'user-1', '[[b]] [[c]] [[unknown-slug]]');

      // Should query pages for slugs b, c, unknown-slug
      expect(mockPrisma.wikiPage.findMany).toHaveBeenCalledWith({
        where: {
          ownerId: 'user-1',
          slug: { in: expect.arrayContaining(['b', 'c', 'unknown-slug']) },
        },
        select: { id: true },
      });

      // Should check existing links for page-a
      expect(mockPrisma.wikiLink.findMany).toHaveBeenCalledWith({
        where: { fromPageId: 'page-a' },
        select: { id: true, toPageId: true },
      });

      // Transaction should create links to page-b and page-c (no deletes)
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.wikiLink.create).toHaveBeenCalledTimes(2);
      const createCalls = mockPrisma.wikiLink.create.mock.calls.map((c) => c[0]);
      const toIds = createCalls.map((c: { data: { toPageId: string } }) => c.data.toPageId).sort();
      expect(toIds).toEqual(['page-b', 'page-c'].sort());
    });

    it('deletes stale links and keeps valid ones when content changes', async () => {
      // Existing links: a→b and a→c
      const existingLinks = [
        makeWikiLink({ id: 'link-ab', fromPageId: 'page-a', toPageId: 'page-b' }),
        makeWikiLink({ id: 'link-ac', fromPageId: 'page-a', toPageId: 'page-c' }),
      ];
      // New content only references [[b]], so page-c link is stale
      const pageB = makeWikiPage({ id: 'page-b', slug: 'b' });

      mockPrisma.wikiPage.findMany.mockResolvedValue([pageB]);
      mockPrisma.wikiLink.findMany.mockResolvedValue(existingLinks);
      mockPrisma.wikiLink.create.mockResolvedValue(makeWikiLink());
      mockPrisma.wikiLink.deleteMany.mockResolvedValue({ count: 1 });

      await repo.rebuildForPage('page-a', 'user-1', '[[b]]');

      // Should delete the stale a→c link
      expect(mockPrisma.wikiLink.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['link-ac'] } },
      });
      // Should NOT create a new a→b link (already exists)
      expect(mockPrisma.wikiLink.create).not.toHaveBeenCalled();
    });
  });

  describe('findBacklinks', () => {
    it('returns WikiLink rows pointing at the target page', async () => {
      const links = [
        makeWikiLink({ id: 'link-1', fromPageId: 'page-x', toPageId: 'page-b' }),
        makeWikiLink({ id: 'link-2', fromPageId: 'page-y', toPageId: 'page-b' }),
      ];
      mockPrisma.wikiLink.findMany.mockResolvedValue(links);

      const result = await repo.findBacklinks('page-b');

      expect(mockPrisma.wikiLink.findMany).toHaveBeenCalledWith({
        where: { toPageId: 'page-b' },
      });
      expect(result).toEqual(links);
    });
  });

  describe('deleteAllForPage', () => {
    it('deletes both incoming and outgoing links for the page', async () => {
      mockPrisma.wikiLink.deleteMany.mockResolvedValue({ count: 3 });

      await repo.deleteAllForPage('page-a');

      expect(mockPrisma.wikiLink.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ fromPageId: 'page-a' }, { toPageId: 'page-a' }] },
      });
    });
  });

  describe('findEdgesAmongPages', () => {
    it('queries wikiLink.findMany with both endpoints constrained to the given ids', async () => {
      mockPrisma.wikiLink.findMany.mockResolvedValue([
        { fromPageId: 'page-a', toPageId: 'page-b' },
      ]);

      const edges = await repo.findEdgesAmongPages(['page-a', 'page-b']);

      expect(mockPrisma.wikiLink.findMany).toHaveBeenCalledWith({
        where: {
          fromPageId: { in: ['page-a', 'page-b'] },
          toPageId: { in: ['page-a', 'page-b'] },
        },
        select: { fromPageId: true, toPageId: true },
      });
      expect(edges).toEqual([{ fromPageId: 'page-a', toPageId: 'page-b' }]);
    });

    it('short-circuits to [] when fewer than 2 pages are given (no prisma call)', async () => {
      expect(await repo.findEdgesAmongPages([])).toEqual([]);
      expect(await repo.findEdgesAmongPages(['page-a'])).toEqual([]);
      expect(mockPrisma.wikiLink.findMany).not.toHaveBeenCalled();
    });
  });
});
