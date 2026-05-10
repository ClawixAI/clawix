import { describe, it, expect, beforeEach } from 'vitest';

import { GroupInviteRepository } from '../group-invite.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

const baseRow = {
  id: 'inv-1',
  groupId: 'group-1',
  inviteeId: 'user-B',
  invitedById: 'user-A',
  status: 'PENDING' as const,
  reviewedAt: null,
  createdAt: new Date('2026-05-10T00:00:00Z'),
};

describe('GroupInviteRepository', () => {
  let repo: GroupInviteRepository;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repo = new GroupInviteRepository(mockPrisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('writes a PENDING row with the given fields', async () => {
      mockPrisma.groupInvite.create.mockResolvedValue(baseRow);

      const result = await repo.create({
        groupId: 'group-1',
        inviteeId: 'user-B',
        invitedById: 'user-A',
      });

      expect(mockPrisma.groupInvite.create).toHaveBeenCalledWith({
        data: { groupId: 'group-1', inviteeId: 'user-B', invitedById: 'user-A' },
      });
      expect(result).toEqual(baseRow);
    });
  });

  describe('findById', () => {
    it('returns row when found', async () => {
      mockPrisma.groupInvite.findUnique.mockResolvedValue(baseRow);

      const result = await repo.findById('inv-1');

      expect(mockPrisma.groupInvite.findUnique).toHaveBeenCalledWith({ where: { id: 'inv-1' } });
      expect(result).toEqual(baseRow);
    });

    it('returns null when not found', async () => {
      mockPrisma.groupInvite.findUnique.mockResolvedValue(null);
      const result = await repo.findById('missing');
      expect(result).toBeNull();
    });
  });

  describe('findExistingPending', () => {
    it('queries by groupId + inviteeId + status=PENDING', async () => {
      mockPrisma.groupInvite.findFirst.mockResolvedValue(baseRow);

      const result = await repo.findExistingPending('group-1', 'user-B');

      expect(mockPrisma.groupInvite.findFirst).toHaveBeenCalledWith({
        where: { groupId: 'group-1', inviteeId: 'user-B', status: 'PENDING' },
      });
      expect(result).toEqual(baseRow);
    });
  });

  describe('listPendingByInvitee', () => {
    it('returns PENDING rows for the user with createdAt desc order', async () => {
      mockPrisma.groupInvite.findMany.mockResolvedValue([baseRow]);

      await repo.listPendingByInvitee('user-B');

      expect(mockPrisma.groupInvite.findMany).toHaveBeenCalledWith({
        where: { inviteeId: 'user-B', status: 'PENDING' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('listSentByUser', () => {
    it('returns all rows where invitedById matches', async () => {
      mockPrisma.groupInvite.findMany.mockResolvedValue([baseRow]);

      await repo.listSentByUser('user-A');

      expect(mockPrisma.groupInvite.findMany).toHaveBeenCalledWith({
        where: { invitedById: 'user-A' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('listPendingByGroup', () => {
    it('returns PENDING rows for the group', async () => {
      mockPrisma.groupInvite.findMany.mockResolvedValue([baseRow]);

      await repo.listPendingByGroup('group-1');

      expect(mockPrisma.groupInvite.findMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1', status: 'PENDING' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('transitionStatus', () => {
    it('atomically transitions when row is in fromStatus (returns true)', async () => {
      mockPrisma.groupInvite.updateMany.mockResolvedValue({ count: 1 });

      const result = await repo.transitionStatus({
        id: 'inv-1',
        fromStatus: 'PENDING',
        toStatus: 'ACCEPTED',
      });

      expect(mockPrisma.groupInvite.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', status: 'PENDING' },
        data: { status: 'ACCEPTED', reviewedAt: expect.any(Date) },
      });
      expect(result).toBe(true);
    });

    it('returns false when row is no longer in fromStatus (race lost)', async () => {
      mockPrisma.groupInvite.updateMany.mockResolvedValue({ count: 0 });

      const result = await repo.transitionStatus({
        id: 'inv-1',
        fromStatus: 'PENDING',
        toStatus: 'ACCEPTED',
      });

      expect(result).toBe(false);
    });
  });
});
