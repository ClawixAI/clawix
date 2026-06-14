import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

import { GroupAccessService } from '../group-access.service.js';
import type { GroupRepository } from '../../db/group.repository.js';
import type { GroupInviteRepository } from '../../db/group-invite.repository.js';
import type { NotificationFanoutService } from '../../notifications/notifications.fanout.js';
import type { AuditLogRepository } from '../../db/audit-log.repository.js';
import type { UserRepository } from '../../db/user.repository.js';
import type { PolicyRepository } from '../../db/policy.repository.js';

function makeRepos() {
  const groupRepo = {
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    restore: vi.fn(),
    findDeleted: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    listMembers: vi.fn(),
    isOwner: vi.fn(),
    listMembershipsForUser: vi.fn(),
    countOwnedByUser: vi.fn().mockResolvedValue(0),
  };
  const inviteRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    findExistingPending: vi.fn(),
    listPendingByInvitee: vi.fn(),
    listSentByUser: vi.fn(),
    listPendingByGroup: vi.fn(),
    transitionStatus: vi.fn(),
  };
  const notifications = { create: vi.fn() };
  const auditRepo = { create: vi.fn() };
  const userRepo = { findById: vi.fn().mockResolvedValue({ id: 'u1', policyId: 'policy-1' }) };
  const policyRepo = { findById: vi.fn().mockResolvedValue({ id: 'policy-1', maxGroupsOwned: 5 }) };

  return { groupRepo, inviteRepo, notifications, auditRepo, userRepo, policyRepo };
}

function makeService(r: ReturnType<typeof makeRepos>) {
  return new GroupAccessService(
    r.groupRepo as unknown as GroupRepository,
    r.inviteRepo as unknown as GroupInviteRepository,
    r.notifications as unknown as NotificationFanoutService,
    r.auditRepo as unknown as AuditLogRepository,
    r.userRepo as unknown as UserRepository,
    r.policyRepo as unknown as PolicyRepository,
  );
}

describe('GroupAccessService', () => {
  let r: ReturnType<typeof makeRepos>;
  let svc: GroupAccessService;

  beforeEach(() => {
    r = makeRepos();
    svc = makeService(r);
  });

  describe('createGroup', () => {
    it('creates group via repo, audits, and returns the row', async () => {
      r.groupRepo.create.mockResolvedValue({ id: 'g1', name: 'Alpha', description: null });

      const result = await svc.createGroup('u1', { name: 'Alpha', description: null });

      expect(r.groupRepo.create).toHaveBeenCalledWith({
        name: 'Alpha',
        description: undefined,
        createdById: 'u1',
      });
      expect(r.auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', action: 'group.create', resourceId: 'g1' }),
      );
      expect(result.id).toBe('g1');
    });

    it('rejects with BadRequestException when the user is at their owned-group limit', async () => {
      r.policyRepo.findById.mockResolvedValue({ id: 'policy-1', maxGroupsOwned: 2 });
      r.groupRepo.countOwnedByUser.mockResolvedValue(2);

      await expect(svc.createGroup('u1', { name: 'Alpha' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(r.groupRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('updateGroup', () => {
    it('rejects non-owner with Forbidden', async () => {
      r.groupRepo.isOwner.mockResolvedValue(false);
      await expect(svc.updateGroup('g1', 'u1', { name: 'New' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('updates and audits when owner', async () => {
      r.groupRepo.isOwner.mockResolvedValue(true);
      r.groupRepo.update.mockResolvedValue({ id: 'g1', name: 'New' });

      await svc.updateGroup('g1', 'u1', { name: 'New' });

      expect(r.groupRepo.update).toHaveBeenCalledWith('g1', { name: 'New' });
      expect(r.auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'group.update', resourceId: 'g1' }),
      );
    });
  });

  describe('deleteGroup', () => {
    it('rejects non-owner with Forbidden', async () => {
      r.groupRepo.isOwner.mockResolvedValue(false);
      await expect(svc.deleteGroup('g1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('deletes and audits when owner', async () => {
      r.groupRepo.isOwner.mockResolvedValue(true);
      r.groupRepo.delete.mockResolvedValue(undefined);

      await svc.deleteGroup('g1', 'u1');

      expect(r.groupRepo.delete).toHaveBeenCalledWith('g1');
      expect(r.auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'group.delete', resourceId: 'g1' }),
      );
    });
  });

  describe('invite', () => {
    beforeEach(() => {
      r.userRepo.findById.mockResolvedValue({ id: 'invitee', email: 'b@x' });
      r.groupRepo.findById.mockResolvedValue({
        id: 'g1',
        name: 'Alpha',
        members: [{ userId: 'inviter' }, { userId: 'someone' }],
      });
      r.inviteRepo.findExistingPending.mockResolvedValue(null);
      r.inviteRepo.create.mockResolvedValue({ id: 'inv-1', groupId: 'g1', inviteeId: 'invitee' });
    });

    it('rejects if caller is not a member', async () => {
      r.groupRepo.findById.mockResolvedValue({ id: 'g1', members: [{ userId: 'someone' }] });
      await expect(svc.invite('g1', 'inviter', { inviteeId: 'invitee' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws NotFound if invitee user does not exist', async () => {
      r.userRepo.findById.mockResolvedValue(null);
      await expect(svc.invite('g1', 'inviter', { inviteeId: 'ghost' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws Conflict if invitee already a member', async () => {
      r.groupRepo.findById.mockResolvedValue({
        id: 'g1',
        members: [{ userId: 'inviter' }, { userId: 'invitee' }],
      });
      await expect(svc.invite('g1', 'inviter', { inviteeId: 'invitee' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('throws Conflict if a pending invite already exists', async () => {
      r.inviteRepo.findExistingPending.mockResolvedValue({ id: 'inv-old', status: 'PENDING' });
      await expect(svc.invite('g1', 'inviter', { inviteeId: 'invitee' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('creates invite + notification + audit on happy path', async () => {
      const result = await svc.invite('g1', 'inviter', { inviteeId: 'invitee' });

      expect(r.inviteRepo.create).toHaveBeenCalledWith({
        groupId: 'g1',
        inviteeId: 'invitee',
        invitedById: 'inviter',
      });
      expect(r.notifications.create).toHaveBeenCalledWith({
        recipientId: 'invitee',
        type: 'GROUP_INVITE',
        payload: expect.objectContaining({ inviteId: 'inv-1', groupId: 'g1' }),
      });
      expect(r.auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'group.invite', userId: 'inviter' }),
      );
      expect(result.id).toBe('inv-1');
    });
  });

  describe('acceptInvite', () => {
    it('throws NotFound when invite missing', async () => {
      r.inviteRepo.findById.mockResolvedValue(null);
      await expect(svc.acceptInvite('inv-1', 'invitee')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Forbidden when caller is not the invitee', async () => {
      r.inviteRepo.findById.mockResolvedValue({
        id: 'inv-1',
        groupId: 'g1',
        inviteeId: 'someoneElse',
        status: 'PENDING',
      });
      await expect(svc.acceptInvite('inv-1', 'invitee')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws Conflict on race-loss (already actioned)', async () => {
      r.inviteRepo.findById.mockResolvedValue({
        id: 'inv-1',
        groupId: 'g1',
        inviteeId: 'invitee',
        status: 'PENDING',
      });
      r.inviteRepo.transitionStatus.mockResolvedValue(false);

      await expect(svc.acceptInvite('inv-1', 'invitee')).rejects.toBeInstanceOf(ConflictException);
    });

    it('transitions to ACCEPTED, adds member, audits on happy path', async () => {
      r.inviteRepo.findById.mockResolvedValue({
        id: 'inv-1',
        groupId: 'g1',
        inviteeId: 'invitee',
        invitedById: 'inviter',
        status: 'PENDING',
      });
      r.inviteRepo.transitionStatus.mockResolvedValue(true);

      await svc.acceptInvite('inv-1', 'invitee');

      expect(r.inviteRepo.transitionStatus).toHaveBeenCalledWith({
        id: 'inv-1',
        fromStatus: 'PENDING',
        toStatus: 'ACCEPTED',
      });
      expect(r.groupRepo.addMember).toHaveBeenCalledWith('g1', 'invitee', 'MEMBER');
      expect(r.auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'group.invite.accept' }),
      );
    });

    it('fans out a GROUP_INVITE_RESPONSE notification to the inviter', async () => {
      r.inviteRepo.findById.mockResolvedValue({
        id: 'inv-1',
        groupId: 'g1',
        inviteeId: 'invitee',
        invitedById: 'inviter',
        status: 'PENDING',
      });
      r.inviteRepo.transitionStatus.mockResolvedValue(true);
      r.userRepo.findById.mockResolvedValue({ id: 'invitee', name: 'Tina', email: 't@x' });
      r.groupRepo.findById.mockResolvedValue({
        id: 'g1',
        name: 'Alpha',
        members: [{ userId: 'inviter' }, { userId: 'invitee' }],
      });

      await svc.acceptInvite('inv-1', 'invitee');

      expect(r.notifications.create).toHaveBeenCalledWith({
        recipientId: 'inviter',
        type: 'GROUP_INVITE_RESPONSE',
        payload: expect.objectContaining({
          inviteId: 'inv-1',
          groupId: 'g1',
          response: 'accepted',
          responderId: 'invitee',
        }),
      });
    });
  });

  describe('rejectInvite', () => {
    it('transitions PENDING→REJECTED when invitee rejects', async () => {
      r.inviteRepo.findById.mockResolvedValue({
        id: 'inv-1',
        groupId: 'g1',
        inviteeId: 'invitee',
        status: 'PENDING',
      });
      r.inviteRepo.transitionStatus.mockResolvedValue(true);

      await svc.rejectInvite('inv-1', 'invitee');

      expect(r.inviteRepo.transitionStatus).toHaveBeenCalledWith({
        id: 'inv-1',
        fromStatus: 'PENDING',
        toStatus: 'REJECTED',
      });
      expect(r.groupRepo.addMember).not.toHaveBeenCalled();
      expect(r.auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'group.invite.reject' }),
      );
    });

    it('rejects non-invitee with Forbidden', async () => {
      r.inviteRepo.findById.mockResolvedValue({
        id: 'inv-1',
        groupId: 'g1',
        inviteeId: 'someoneElse',
        status: 'PENDING',
      });
      await expect(svc.rejectInvite('inv-1', 'invitee')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('revokeInvite', () => {
    it('allows the inviter to revoke', async () => {
      r.inviteRepo.findById.mockResolvedValue({
        id: 'inv-1',
        groupId: 'g1',
        inviteeId: 'invitee',
        invitedById: 'inviter',
        status: 'PENDING',
      });
      r.groupRepo.isOwner.mockResolvedValue(false);
      r.inviteRepo.transitionStatus.mockResolvedValue(true);

      await svc.revokeInvite('inv-1', 'inviter');

      expect(r.inviteRepo.transitionStatus).toHaveBeenCalledWith({
        id: 'inv-1',
        fromStatus: 'PENDING',
        toStatus: 'REVOKED',
      });
    });

    it('allows an owner of the group to revoke even if not the inviter', async () => {
      r.inviteRepo.findById.mockResolvedValue({
        id: 'inv-1',
        groupId: 'g1',
        inviteeId: 'invitee',
        invitedById: 'someone',
        status: 'PENDING',
      });
      r.groupRepo.isOwner.mockResolvedValue(true);
      r.inviteRepo.transitionStatus.mockResolvedValue(true);

      await svc.revokeInvite('inv-1', 'owner');

      expect(r.inviteRepo.transitionStatus).toHaveBeenCalled();
    });

    it('rejects callers who are neither inviter nor owner', async () => {
      r.inviteRepo.findById.mockResolvedValue({
        id: 'inv-1',
        groupId: 'g1',
        inviteeId: 'invitee',
        invitedById: 'someone',
        status: 'PENDING',
      });
      r.groupRepo.isOwner.mockResolvedValue(false);
      await expect(svc.revokeInvite('inv-1', 'rando')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('removeMember', () => {
    it('rejects non-owner', async () => {
      r.groupRepo.isOwner.mockResolvedValue(false);
      await expect(svc.removeMember('g1', 'u1', 'u2')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("won't let an owner remove themselves (use leaveGroup)", async () => {
      r.groupRepo.isOwner.mockResolvedValue(true);
      await expect(svc.removeMember('g1', 'u1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('removes the member when owner removes someone else', async () => {
      r.groupRepo.isOwner.mockResolvedValue(true);

      await svc.removeMember('g1', 'owner', 'member');

      expect(r.groupRepo.removeMember).toHaveBeenCalledWith('g1', 'member');
      expect(r.auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'group.member.remove' }),
      );
    });
  });

  describe('leaveGroup', () => {
    it("won't let an owner leave (delete the group instead)", async () => {
      r.groupRepo.listMembers.mockResolvedValue([
        { userId: 'u1', role: 'OWNER' },
        { userId: 'u2', role: 'MEMBER' },
      ]);

      await expect(svc.leaveGroup('g1', 'u1')).rejects.toBeInstanceOf(ConflictException);
    });

    it("won't let an owner leave even when another owner remains", async () => {
      r.groupRepo.listMembers.mockResolvedValue([
        { userId: 'u1', role: 'OWNER' },
        { userId: 'u2', role: 'OWNER' },
      ]);

      await expect(svc.leaveGroup('g1', 'u1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects non-members with Forbidden', async () => {
      r.groupRepo.listMembers.mockResolvedValue([{ userId: 'u1', role: 'OWNER' }]);

      await expect(svc.leaveGroup('g1', 'rando')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a non-owner member leave', async () => {
      r.groupRepo.listMembers.mockResolvedValue([
        { userId: 'u1', role: 'OWNER' },
        { userId: 'u2', role: 'MEMBER' },
      ]);

      await svc.leaveGroup('g1', 'u2');

      expect(r.groupRepo.removeMember).toHaveBeenCalledWith('g1', 'u2');
      expect(r.auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'group.member.leave' }),
      );
    });
  });

  describe('listDeletedGroups', () => {
    it('admin sees the deleted-groups page', async () => {
      r.groupRepo.findDeleted.mockResolvedValue({ data: [], meta: {} });

      await svc.listDeletedGroups('admin');

      expect(r.groupRepo.findDeleted).toHaveBeenCalled();
    });

    it('non-admin gets Forbidden', async () => {
      await expect(svc.listDeletedGroups('user')).rejects.toBeInstanceOf(ForbiddenException);
      expect(r.groupRepo.findDeleted).not.toHaveBeenCalled();
    });
  });

  describe('restoreGroup', () => {
    it('admin can restore + audits group.restore', async () => {
      r.groupRepo.restore.mockResolvedValue({ id: 'g1', name: 'Alpha' });

      await svc.restoreGroup('g1', 'admin-1', 'admin');

      expect(r.groupRepo.restore).toHaveBeenCalledWith('g1');
      expect(r.auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          action: 'group.restore',
          resourceId: 'g1',
        }),
      );
    });

    it('non-admin gets Forbidden + no repo call', async () => {
      await expect(svc.restoreGroup('g1', 'u1', 'user')).rejects.toBeInstanceOf(ForbiddenException);
      expect(r.groupRepo.restore).not.toHaveBeenCalled();
    });
  });
});
