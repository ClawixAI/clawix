import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { MemoryService } from '../memory.service.js';
import type { MemoryItemRepository } from '../../db/memory-item.repository.js';
import type { AuditLogRepository } from '../../db/audit-log.repository.js';
import type { SessionRepository } from '../../db/session.repository.js';

const mockItem = {
  id: 'mem-1',
  ownerId: 'user-A',
  content: { text: 'leave policy details' },
  tags: ['domain:hr'],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createMockRepo() {
  return {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findById: vi.fn(),
    listOwnedByUser: vi.fn().mockResolvedValue([]),
    findVisibleToUser: vi.fn().mockResolvedValue([]),
    findItemIdsWithOrgShare: vi.fn().mockResolvedValue([]),
    setOrgShare: vi.fn().mockResolvedValue(undefined),
    revokeOrgShare: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAudit() {
  return { create: vi.fn() };
}

function createMockSessionRepo() {
  return { clearAllCachedSystemPrompts: vi.fn().mockResolvedValue(0) };
}

describe('MemoryService', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let audit: ReturnType<typeof createMockAudit>;
  let sessionRepo: ReturnType<typeof createMockSessionRepo>;
  let service: MemoryService;

  beforeEach(() => {
    repo = createMockRepo();
    audit = createMockAudit();
    sessionRepo = createMockSessionRepo();
    service = new MemoryService(
      repo as unknown as MemoryItemRepository,
      audit as unknown as AuditLogRepository,
      sessionRepo as unknown as SessionRepository,
    );
  });

  // ---------------------------------------------------------------- //
  //  create                                                           //
  // ---------------------------------------------------------------- //

  describe('create', () => {
    it('inserts row with caller as owner; audits memory.create', async () => {
      repo.create.mockResolvedValue(mockItem);

      const result = await service.create('user-A', 'developer', {
        content: 'leave policy details',
        tags: ['domain:hr'],
      });

      expect(repo.create).toHaveBeenCalledWith({
        ownerId: 'user-A',
        content: 'leave policy details',
        tags: ['domain:hr'],
      });
      expect(audit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-A',
          action: 'memory.create',
          resource: 'MemoryItem',
          resourceId: 'mem-1',
        }),
      );
      expect(result).toEqual({ ...mockItem, isOrgShared: false });
    });

    it('rejects when zero domain: tags are present', async () => {
      await expect(
        service.create('user-A', 'developer', { content: 'x', tags: ['urgent'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects when two or more domain: tags are present', async () => {
      await expect(
        service.create('user-A', 'developer', {
          content: 'x',
          tags: ['domain:hr', 'domain:eng'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects daily: tags from this surface', async () => {
      await expect(
        service.create('user-A', 'developer', {
          content: 'x',
          tags: ['domain:hr', 'daily:2026-05-10'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('admin can create with orgShared:true; audits memory.org_share + writes MemoryShare', async () => {
      repo.create.mockResolvedValue(mockItem);

      const result = await service.create('user-A', 'admin', {
        content: 'x',
        tags: ['domain:hr'],
        orgShared: true,
      });

      expect(repo.setOrgShare).toHaveBeenCalledWith('mem-1', 'user-A');
      expect(audit.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'memory.create' }),
      );
      expect(audit.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'memory.org_share', resourceId: 'mem-1' }),
      );
      expect(result.isOrgShared).toBe(true);
    });

    it('developer cannot create with orgShared:true (403)', async () => {
      await expect(
        service.create('user-A', 'developer', {
          content: 'x',
          tags: ['domain:hr'],
          orgShared: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.setOrgShare).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- //
  //  update                                                           //
  // ---------------------------------------------------------------- //

  describe('update', () => {
    it('owner can update; audits memory.update', async () => {
      repo.findById.mockResolvedValue(mockItem);
      repo.update.mockResolvedValue({ ...mockItem, content: 'new' });

      await service.update('mem-1', 'user-A', 'developer', { content: 'new' });

      expect(repo.update).toHaveBeenCalledWith('mem-1', { content: 'new' });
      expect(audit.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'memory.update', userId: 'user-A' }),
      );
    });

    it('non-owner is rejected with 403', async () => {
      repo.findById.mockResolvedValue(mockItem);

      await expect(
        service.update('mem-1', 'attacker', 'developer', { content: 'pwn' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('missing item is 404', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.update('mem-missing', 'user-A', 'developer', { content: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('admin can flip orgShared:true; writes MemoryShare + audits memory.org_share', async () => {
      repo.findById.mockResolvedValue({ ...mockItem, tags: ['domain:hr'] });
      repo.findItemIdsWithOrgShare.mockResolvedValue([]); // not yet shared
      repo.update.mockResolvedValue({ ...mockItem });

      await service.update('mem-1', 'user-A', 'admin', { orgShared: true });

      expect(repo.setOrgShare).toHaveBeenCalledWith('mem-1', 'user-A');
      expect(audit.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'memory.org_share' }),
      );
    });

    it('developer cannot ADD orgShared (403)', async () => {
      repo.findById.mockResolvedValue({ ...mockItem, tags: ['domain:hr'] });
      repo.findItemIdsWithOrgShare.mockResolvedValue([]); // not yet shared

      await expect(
        service.update('mem-1', 'user-A', 'developer', { orgShared: true }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.setOrgShare).not.toHaveBeenCalled();
    });

    it('developer can REMOVE orgShared from their own memory; audits memory.org_unshare', async () => {
      repo.findById.mockResolvedValue({ ...mockItem, tags: ['domain:hr'] });
      repo.findItemIdsWithOrgShare.mockResolvedValue(['mem-1']); // currently shared
      repo.update.mockResolvedValue({ ...mockItem });

      await service.update('mem-1', 'user-A', 'developer', { orgShared: false });

      expect(repo.revokeOrgShare).toHaveBeenCalledWith('mem-1');
      expect(audit.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'memory.org_unshare' }),
      );
    });

    it('idempotent: orgShared:true on already-shared item is a no-op for admin', async () => {
      repo.findById.mockResolvedValue({ ...mockItem, tags: ['domain:hr'] });
      repo.findItemIdsWithOrgShare.mockResolvedValue(['mem-1']); // already shared
      repo.update.mockResolvedValue({ ...mockItem });

      await service.update('mem-1', 'user-A', 'admin', { orgShared: true });

      expect(repo.setOrgShare).not.toHaveBeenCalled();
      // No new memory.org_share audit either
      expect(audit.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'memory.org_share' }),
      );
    });

    it('rejects update that ends up with two domain: tags', async () => {
      repo.findById.mockResolvedValue(mockItem);

      await expect(
        service.update('mem-1', 'user-A', 'developer', { tags: ['domain:hr', 'domain:eng'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects update that strips the only domain: tag', async () => {
      repo.findById.mockResolvedValue(mockItem);

      await expect(
        service.update('mem-1', 'user-A', 'developer', { tags: ['urgent'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('content-only update preserves existing tags (skips domain check)', async () => {
      repo.findById.mockResolvedValue(mockItem);
      repo.update.mockResolvedValue({ ...mockItem, content: 'updated' });

      await service.update('mem-1', 'user-A', 'developer', { content: 'updated' });

      expect(repo.update).toHaveBeenCalledWith('mem-1', { content: 'updated' });
    });
  });

  // ---------------------------------------------------------------- //
  //  delete                                                           //
  // ---------------------------------------------------------------- //

  describe('delete', () => {
    it('owner can delete; audits memory.delete', async () => {
      repo.findById.mockResolvedValue(mockItem);

      await service.delete('mem-1', 'user-A');

      expect(repo.delete).toHaveBeenCalledWith('mem-1');
      expect(audit.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'memory.delete', userId: 'user-A' }),
      );
    });

    it('non-owner rejected with 403', async () => {
      repo.findById.mockResolvedValue(mockItem);

      await expect(service.delete('mem-1', 'attacker')).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('missing item is 404', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.delete('missing', 'user-A')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------------------------------------------------------------- //
  //  list / read                                                      //
  // ---------------------------------------------------------------- //

  describe('list', () => {
    it('scope=mine delegates to listOwnedByUser', async () => {
      repo.listOwnedByUser.mockResolvedValue([mockItem]);

      const result = await service.list('user-A', 'mine');

      expect(repo.listOwnedByUser).toHaveBeenCalledWith('user-A');
      expect(result).toEqual([{ ...mockItem, isOrgShared: false }]);
    });

    it('scope=visible delegates to findVisibleToUser', async () => {
      repo.findVisibleToUser.mockResolvedValue([mockItem]);

      const result = await service.list('user-A', 'visible');

      expect(repo.findVisibleToUser).toHaveBeenCalledWith('user-A');
      expect(result).toEqual([{ ...mockItem, isOrgShared: false }]);
    });
  });

  describe('read', () => {
    it('returns the item when caller is the owner', async () => {
      repo.findById.mockResolvedValue(mockItem);
      repo.findVisibleToUser.mockResolvedValue([mockItem]);

      const result = await service.read('mem-1', 'user-A');

      expect(result).toEqual({ ...mockItem, isOrgShared: false });
    });

    it('returns the item when it is visible to the caller via findVisibleToUser', async () => {
      const otherOwned = { ...mockItem, ownerId: 'user-B', tags: ['domain:hr'] };
      repo.findById.mockResolvedValue(otherOwned);
      repo.findVisibleToUser.mockResolvedValue([otherOwned]);
      repo.findItemIdsWithOrgShare.mockResolvedValue(['mem-1']); // visible via org share

      const result = await service.read('mem-1', 'user-A');

      expect(result).toEqual({ ...otherOwned, isOrgShared: true });
    });

    it('404 when item is not visible to caller (existence not leaked)', async () => {
      const otherOwned = { ...mockItem, ownerId: 'user-B', tags: ['domain:hr'] };
      repo.findById.mockResolvedValue(otherOwned);
      repo.findVisibleToUser.mockResolvedValue([]);

      await expect(service.read('mem-1', 'user-A')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 when item does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.read('missing', 'user-A')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
