import { describe, it, expect, beforeEach } from 'vitest';

import { GroupRepository } from '../group.repository.js';
import { createMockPrismaService, type MockPrismaService } from './mock-prisma.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('GroupRepository extensions', () => {
  let repo: GroupRepository;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    repo = new GroupRepository(mockPrisma as unknown as PrismaService);
  });

  describe('listMembershipsForUser', () => {
    it('returns memberships for the user joined with the group', async () => {
      const rows = [
        {
          groupId: 'g1',
          userId: 'u1',
          role: 'OWNER',
          joinedAt: new Date('2026-05-01'),
          group: { id: 'g1', name: 'Alpha', description: null, createdById: 'u1' },
        },
      ];
      mockPrisma.groupMember.findMany.mockResolvedValue(rows);

      const result = await repo.listMembershipsForUser('u1');

      expect(mockPrisma.groupMember.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', group: { deletedAt: null } },
        include: {
          group: {
            include: { _count: { select: { members: true } } },
          },
        },
        orderBy: { joinedAt: 'asc' },
      });
      expect(result).toEqual(rows);
    });
  });

  describe('isOwner', () => {
    it('returns true when user has OWNER role in group', async () => {
      mockPrisma.groupMember.findUnique.mockResolvedValue({
        groupId: 'g1',
        userId: 'u1',
        role: 'OWNER',
        joinedAt: new Date(),
      });

      const result = await repo.isOwner('g1', 'u1');

      expect(mockPrisma.groupMember.findUnique).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 'g1', userId: 'u1' } },
      });
      expect(result).toBe(true);
    });

    it('returns false when user is a member but not OWNER', async () => {
      mockPrisma.groupMember.findUnique.mockResolvedValue({
        groupId: 'g1',
        userId: 'u2',
        role: 'MEMBER',
        joinedAt: new Date(),
      });

      const result = await repo.isOwner('g1', 'u2');
      expect(result).toBe(false);
    });

    it('returns false when user is not a member at all', async () => {
      mockPrisma.groupMember.findUnique.mockResolvedValue(null);
      const result = await repo.isOwner('g1', 'unknown');
      expect(result).toBe(false);
    });
  });
});
