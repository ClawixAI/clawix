import { describe, it, expect, beforeEach } from 'vitest';

import { WikiShareRepository } from '../wiki-share.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

function makeWikiShare(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'share-1',
    pageId: 'page-1',
    sharedBy: 'user-1',
    targetType: 'ORG' as const,
    groupId: null,
    sharedAt: new Date('2026-05-17T00:00:00Z'),
    revokedAt: null,
    isRevoked: false,
    ...overrides,
  };
}

describe('WikiShareRepository', () => {
  let repo: WikiShareRepository;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repo = new WikiShareRepository(mockPrisma as unknown as PrismaService);
  });

  // ───────────────────────────────────────────────
  // setOrgShare
  // ───────────────────────────────────────────────

  describe('setOrgShare', () => {
    it('creates a new ORG share row when none exists', async () => {
      const created = makeWikiShare({ id: 'share-new' });
      mockPrisma.wikiShare.findFirst.mockResolvedValue(null);
      mockPrisma.wikiShare.create.mockResolvedValue(created);

      const result = await repo.setOrgShare('page-1', 'user-1');

      expect(mockPrisma.wikiShare.findFirst).toHaveBeenCalledWith({
        where: { pageId: 'page-1', targetType: 'ORG' },
      });
      expect(mockPrisma.wikiShare.create).toHaveBeenCalledWith({
        data: { pageId: 'page-1', sharedBy: 'user-1', targetType: 'ORG' },
      });
      expect(result).toEqual(created);
    });

    it('no-ops (returns existing) when an active ORG share already exists', async () => {
      const existing = makeWikiShare({ id: 'share-existing', isRevoked: false });
      mockPrisma.wikiShare.findFirst.mockResolvedValue(existing);

      const result = await repo.setOrgShare('page-1', 'user-1');

      expect(mockPrisma.wikiShare.create).not.toHaveBeenCalled();
      expect(mockPrisma.wikiShare.update).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    it('un-revokes an existing revoked row (idempotent after revokeOrgShare)', async () => {
      const revoked = makeWikiShare({
        id: 'share-revoked',
        isRevoked: true,
        revokedAt: new Date(),
      });
      const unrevoked = makeWikiShare({ id: 'share-revoked', isRevoked: false, revokedAt: null });
      mockPrisma.wikiShare.findFirst.mockResolvedValue(revoked);
      mockPrisma.wikiShare.update.mockResolvedValue(unrevoked);

      const result = await repo.setOrgShare('page-1', 'user-1');

      expect(mockPrisma.wikiShare.create).not.toHaveBeenCalled();
      expect(mockPrisma.wikiShare.update).toHaveBeenCalledWith({
        where: { id: 'share-revoked' },
        data: expect.objectContaining({ isRevoked: false, revokedAt: null }),
      });
      expect(result.id).toBe('share-revoked');
      expect(result.isRevoked).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // setGroupShare
  // ───────────────────────────────────────────────

  describe('setGroupShare', () => {
    it('creates a new GROUP share row scoped to the given group when none exists', async () => {
      const created = makeWikiShare({ id: 'share-g1', targetType: 'GROUP', groupId: 'group-1' });
      mockPrisma.wikiShare.findFirst.mockResolvedValue(null);
      mockPrisma.wikiShare.create.mockResolvedValue(created);

      const result = await repo.setGroupShare('page-1', 'group-1', 'user-1');

      expect(mockPrisma.wikiShare.findFirst).toHaveBeenCalledWith({
        where: { pageId: 'page-1', targetType: 'GROUP', groupId: 'group-1' },
      });
      expect(mockPrisma.wikiShare.create).toHaveBeenCalledWith({
        data: { pageId: 'page-1', sharedBy: 'user-1', targetType: 'GROUP', groupId: 'group-1' },
      });
      expect(result).toEqual(created);
    });

    it('un-revokes an existing revoked GROUP row (idempotent after revokeShareById)', async () => {
      const revoked = makeWikiShare({
        id: 'share-g-rev',
        targetType: 'GROUP',
        groupId: 'group-1',
        isRevoked: true,
        revokedAt: new Date(),
      });
      const unrevoked = makeWikiShare({
        id: 'share-g-rev',
        targetType: 'GROUP',
        groupId: 'group-1',
        isRevoked: false,
        revokedAt: null,
      });
      mockPrisma.wikiShare.findFirst.mockResolvedValue(revoked);
      mockPrisma.wikiShare.update.mockResolvedValue(unrevoked);

      const result = await repo.setGroupShare('page-1', 'group-1', 'user-1');

      expect(mockPrisma.wikiShare.create).not.toHaveBeenCalled();
      expect(mockPrisma.wikiShare.update).toHaveBeenCalledWith({
        where: { id: 'share-g-rev' },
        data: expect.objectContaining({ isRevoked: false, revokedAt: null }),
      });
      expect(result.id).toBe('share-g-rev');
      expect(result.isRevoked).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // revokeShareById
  // ───────────────────────────────────────────────

  describe('revokeShareById', () => {
    it('returns true when the share is successfully revoked', async () => {
      mockPrisma.wikiShare.updateMany.mockResolvedValue({ count: 1 });

      const result = await repo.revokeShareById('share-1');

      expect(mockPrisma.wikiShare.updateMany).toHaveBeenCalledWith({
        where: { id: 'share-1', isRevoked: false },
        data: expect.objectContaining({ isRevoked: true }),
      });
      expect(result).toBe(true);
    });

    it('returns false when the share is already revoked (count 0)', async () => {
      mockPrisma.wikiShare.updateMany.mockResolvedValue({ count: 0 });

      const result = await repo.revokeShareById('share-already-revoked');

      expect(result).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // findActiveSharesForPage
  // ───────────────────────────────────────────────

  describe('findActiveSharesForPage', () => {
    it('returns only isRevoked=false rows for the given page', async () => {
      const active = [
        makeWikiShare({ id: 'share-a1', isRevoked: false }),
        makeWikiShare({
          id: 'share-a2',
          isRevoked: false,
          targetType: 'GROUP',
          groupId: 'group-1',
        }),
      ];
      mockPrisma.wikiShare.findMany.mockResolvedValue(active);

      const result = await repo.findActiveSharesForPage('page-1');

      expect(mockPrisma.wikiShare.findMany).toHaveBeenCalledWith({
        where: { pageId: 'page-1', isRevoked: false },
      });
      expect(result).toEqual(active);
    });
  });

  // ───────────────────────────────────────────────
  // findPageIdsWithOrgShare
  // ───────────────────────────────────────────────

  describe('findPageIdsWithOrgShare', () => {
    it('returns the subset of pageIds that have an active ORG share', async () => {
      mockPrisma.wikiShare.findMany.mockResolvedValue([{ pageId: 'page-1' }, { pageId: 'page-3' }]);

      const result = await repo.findPageIdsWithOrgShare(['page-1', 'page-2', 'page-3']);

      expect(mockPrisma.wikiShare.findMany).toHaveBeenCalledWith({
        where: {
          pageId: { in: ['page-1', 'page-2', 'page-3'] },
          targetType: 'ORG',
          isRevoked: false,
        },
        select: { pageId: true },
      });
      expect(result).toEqual(['page-1', 'page-3']);
    });

    it('returns an empty array without querying when pageIds is empty', async () => {
      const result = await repo.findPageIdsWithOrgShare([]);

      expect(mockPrisma.wikiShare.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});
