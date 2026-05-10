import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Group, GroupInvite } from '../generated/prisma/client.js';
import { GroupRepository } from '../db/group.repository.js';
import { GroupInviteRepository } from '../db/group-invite.repository.js';
import { AuditLogRepository } from '../db/audit-log.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { NotificationFanoutService } from '../notifications/notifications.fanout.js';

interface CreateGroupInput {
  readonly name: string;
  readonly description?: string | null;
}

interface UpdateGroupInput {
  readonly name?: string;
  readonly description?: string | null;
}

/**
 * Self-service group workflow. Any authenticated user can:
 *   - create a group (becomes its OWNER)
 *   - invite another user to a group they belong to
 *   - accept / reject invites addressed to them
 *   - revoke invites they sent (or any invite if they own the group)
 *   - leave a group (members only — OWNERs delete instead)
 *
 * Group OWNERs additionally can update the group's metadata, delete the
 * group, and forcibly remove other members.
 *
 * State transitions on `GroupInvite` go through the repo's atomic
 * `transitionStatus` so concurrent actors can't double-action a row.
 */
@Injectable()
export class GroupAccessService {
  constructor(
    private readonly groupRepo: GroupRepository,
    private readonly inviteRepo: GroupInviteRepository,
    private readonly notifications: NotificationFanoutService,
    private readonly auditRepo: AuditLogRepository,
    private readonly userRepo: UserRepository,
  ) {}

  async createGroup(userId: string, input: CreateGroupInput): Promise<Group> {
    const group = await this.groupRepo.create({
      name: input.name,
      description: input.description ?? undefined,
      createdById: userId,
    });

    await this.auditRepo.create({
      userId,
      action: 'group.create',
      resource: 'Group',
      resourceId: group.id,
      details: { name: group.name },
    });

    return group;
  }

  async updateGroup(groupId: string, userId: string, input: UpdateGroupInput): Promise<Group> {
    if (!(await this.groupRepo.isOwner(groupId, userId))) {
      throw new ForbiddenException('Only the group owner can update this group');
    }

    const updated = await this.groupRepo.update(groupId, input);

    await this.auditRepo.create({
      userId,
      action: 'group.update',
      resource: 'Group',
      resourceId: groupId,
      details: { ...input },
    });

    return updated;
  }

  async deleteGroup(groupId: string, userId: string): Promise<void> {
    if (!(await this.groupRepo.isOwner(groupId, userId))) {
      throw new ForbiddenException('Only the group owner can delete this group');
    }

    await this.groupRepo.delete(groupId);

    await this.auditRepo.create({
      userId,
      action: 'group.delete',
      resource: 'Group',
      resourceId: groupId,
      details: {},
    });
  }

  async invite(
    groupId: string,
    inviterId: string,
    target: { inviteeId?: string; email?: string },
  ): Promise<GroupInvite> {
    const group = await this.groupRepo.findById(groupId);

    const memberIds = new Set(
      (group.members as readonly { userId: string }[]).map((m) => m.userId),
    );
    if (!memberIds.has(inviterId)) {
      throw new ForbiddenException('Only group members can invite others');
    }

    const invitee = target.inviteeId
      ? await this.userRepo.findById(target.inviteeId)
      : target.email
        ? await this.userRepo.findByEmail(target.email)
        : null;
    if (!invitee) {
      throw new NotFoundException('Invitee user not found');
    }
    const inviteeId = invitee.id;

    if (memberIds.has(inviteeId)) {
      throw new ConflictException('User is already a member of this group');
    }

    const existing = await this.inviteRepo.findExistingPending(groupId, inviteeId);
    if (existing) {
      throw new ConflictException('A pending invite already exists for this user');
    }

    const invite = await this.inviteRepo.create({
      groupId,
      inviteeId,
      invitedById: inviterId,
    });

    await this.notifications.create({
      recipientId: inviteeId,
      type: 'GROUP_INVITE',
      payload: {
        inviteId: invite.id,
        groupId,
        groupName: group.name,
        invitedById: inviterId,
      },
    });

    await this.auditRepo.create({
      userId: inviterId,
      action: 'group.invite',
      resource: 'GroupInvite',
      resourceId: invite.id,
      details: { groupId, inviteeId },
    });

    return invite;
  }

  async acceptInvite(inviteId: string, userId: string): Promise<void> {
    const invite = await this.loadOwnedInvite(inviteId, userId);

    const ok = await this.inviteRepo.transitionStatus({
      id: inviteId,
      fromStatus: 'PENDING',
      toStatus: 'ACCEPTED',
    });
    if (!ok) {
      throw new ConflictException('Invite is no longer pending');
    }

    await this.groupRepo.addMember(invite.groupId, userId, 'MEMBER');

    await this.auditRepo.create({
      userId,
      action: 'group.invite.accept',
      resource: 'GroupInvite',
      resourceId: inviteId,
      details: { groupId: invite.groupId },
    });
    await this.notifyInviteResponse(invite, userId, 'accepted');
  }

  async rejectInvite(inviteId: string, userId: string): Promise<void> {
    const invite = await this.loadOwnedInvite(inviteId, userId);

    const ok = await this.inviteRepo.transitionStatus({
      id: inviteId,
      fromStatus: 'PENDING',
      toStatus: 'REJECTED',
    });
    if (!ok) {
      throw new ConflictException('Invite is no longer pending');
    }

    await this.auditRepo.create({
      userId,
      action: 'group.invite.reject',
      resource: 'GroupInvite',
      resourceId: inviteId,
      details: { groupId: invite.groupId },
    });
    await this.notifyInviteResponse(invite, userId, 'rejected');
  }

  /**
   * Push a GROUP_INVITE_RESPONSE notification to the inviter so their
   * Sent Invites tab can update in real time and the bell can toast.
   * Best-effort: payload-shape problems are swallowed so a flaky
   * notification never blocks the underlying state transition.
   */
  private async notifyInviteResponse(
    invite: GroupInvite,
    responderId: string,
    response: 'accepted' | 'rejected',
  ): Promise<void> {
    try {
      const [responder, group] = await Promise.all([
        this.userRepo.findById(responderId),
        this.groupRepo.findById(invite.groupId).catch(() => null),
      ]);
      await this.notifications.create({
        recipientId: invite.invitedById,
        type: 'GROUP_INVITE_RESPONSE',
        payload: {
          inviteId: invite.id,
          groupId: invite.groupId,
          groupName: group?.name ?? null,
          response,
          responderId,
          responderName: responder?.name ?? null,
          responderEmail: responder?.email ?? null,
        },
      });
    } catch {
      // Notifications are supplementary — never fail an accept/reject
      // because the fan-out had a hiccup.
    }
  }

  async revokeInvite(inviteId: string, userId: string): Promise<void> {
    const invite = await this.inviteRepo.findById(inviteId);
    if (!invite) throw new NotFoundException('Invite not found');

    const isInviter = invite.invitedById === userId;
    const isOwner = await this.groupRepo.isOwner(invite.groupId, userId);
    if (!isInviter && !isOwner) {
      throw new ForbiddenException('Only the inviter or a group owner can revoke this invite');
    }

    const ok = await this.inviteRepo.transitionStatus({
      id: inviteId,
      fromStatus: 'PENDING',
      toStatus: 'REVOKED',
    });
    if (!ok) {
      throw new ConflictException('Invite is no longer pending');
    }

    await this.auditRepo.create({
      userId,
      action: 'group.invite.revoke',
      resource: 'GroupInvite',
      resourceId: inviteId,
      details: { groupId: invite.groupId },
    });
  }

  async removeMember(groupId: string, ownerId: string, memberId: string): Promise<void> {
    if (!(await this.groupRepo.isOwner(groupId, ownerId))) {
      throw new ForbiddenException('Only the group owner can remove members');
    }
    if (ownerId === memberId) {
      throw new ForbiddenException('Owners cannot remove themselves — delete the group instead');
    }

    await this.groupRepo.removeMember(groupId, memberId);

    await this.auditRepo.create({
      userId: ownerId,
      action: 'group.member.remove',
      resource: 'Group',
      resourceId: groupId,
      details: { memberId },
    });
  }

  async leaveGroup(groupId: string, userId: string): Promise<void> {
    const members = await this.groupRepo.listMembers(groupId);
    const me = members.find((m) => m.userId === userId);
    if (!me) {
      throw new ForbiddenException('You are not a member of this group');
    }
    if (me.role === 'OWNER') {
      // Owners can't leave their own group — they delete it (which removes
      // every member at once) or transfer ownership (deferred). Allowing a
      // leave here would either orphan the group or, with multiple owners,
      // create a quiet path to demote oneself that bypasses the explicit
      // "delete vs transfer" decision.
      throw new ConflictException('Owners cannot leave their own group — delete the group instead');
    }

    await this.groupRepo.removeMember(groupId, userId);

    await this.auditRepo.create({
      userId,
      action: 'group.member.leave',
      resource: 'Group',
      resourceId: groupId,
      details: {},
    });
  }

  async listMyGroups(userId: string) {
    return this.groupRepo.listMembershipsForUser(userId);
  }

  /** Admin-only: list every soft-deleted group so an admin can restore one. */
  async listDeletedGroups(callerRole: string) {
    if (callerRole !== 'admin') {
      throw new ForbiddenException('Only admins can list deleted groups');
    }
    return this.groupRepo.findDeleted({ page: 1, limit: 100 });
  }

  /**
   * Admin-only: clear the group's deletedAt and un-revoke the share rows
   * the matching delete revoked. Audit-logged as `group.restore`.
   */
  async restoreGroup(groupId: string, callerId: string, callerRole: string): Promise<Group> {
    if (callerRole !== 'admin') {
      throw new ForbiddenException('Only admins can restore deleted groups');
    }
    const group = await this.groupRepo.restore(groupId);
    await this.auditRepo.create({
      userId: callerId,
      action: 'group.restore',
      resource: 'Group',
      resourceId: groupId,
      details: { name: group.name },
    });
    return group;
  }

  /**
   * Autocomplete users by name or email for the invite picker. Excludes
   * the caller and any users who are already members of the given group
   * (when `excludeGroupId` is provided) so the dropdown only shows
   * actually-invitable people.
   */
  async searchUsersForInvite(
    callerId: string,
    query: string,
    excludeGroupId?: string,
  ): Promise<readonly { id: string; name: string | null; email: string }[]> {
    const matches = await this.userRepo.searchByNameOrEmail(query, 10);
    const filtered = matches.filter((u) => u.id !== callerId);
    if (!excludeGroupId) return filtered;

    const group = await this.groupRepo.findById(excludeGroupId);
    const memberIds = new Set(
      (group.members as readonly { userId: string }[]).map((m) => m.userId),
    );
    return filtered.filter((u) => !memberIds.has(u.id));
  }

  async readGroup(groupId: string, userId: string) {
    const group = await this.groupRepo.findById(groupId);
    const memberIds = new Set(
      (group.members as readonly { userId: string }[]).map((m) => m.userId),
    );
    if (!memberIds.has(userId)) {
      throw new ForbiddenException('You are not a member of this group');
    }
    return group;
  }

  async listMyPendingInvites(userId: string) {
    return this.inviteRepo.listPendingByInvitee(userId);
  }

  async listInvitesSentByUser(userId: string) {
    return this.inviteRepo.listSentByUser(userId);
  }

  private async loadOwnedInvite(inviteId: string, userId: string): Promise<GroupInvite> {
    const invite = await this.inviteRepo.findById(inviteId);
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.inviteeId !== userId) {
      throw new ForbiddenException('This invite is not addressed to you');
    }
    return invite;
  }
}
