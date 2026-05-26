import type {
  CreateGroupInput,
  GroupInviteStatus,
  InviteToGroupInput,
  UpdateGroupInput,
} from '@clawix/shared';
import { authFetch } from '@/lib/auth';

export interface Group {
  id: string;
  name: string;
  description: string | null;
  createdById: string;
  createdAt: string;
}

export interface GroupMembership {
  groupId: string;
  userId: string;
  role: 'OWNER' | 'MEMBER';
  joinedAt: string;
  group: Group & { _count: { members: number } };
}

export interface GroupMember {
  groupId: string;
  userId: string;
  role: 'OWNER' | 'MEMBER';
  joinedAt: string;
  user: { id: string; name: string | null; email: string };
}

export interface GroupDetail extends Group {
  members: GroupMember[];
  _count: { members: number };
}

export interface GroupInvite {
  id: string;
  groupId: string;
  inviteeId: string;
  invitedById: string;
  status: GroupInviteStatus;
  reviewedAt: string | null;
  createdAt: string;
  group: { id: string; name: string };
  invitee: { id: string; name: string | null; email: string };
  invitedBy: { id: string; name: string | null; email: string };
}

export const groupsApi = {
  listMine(): Promise<{ items: GroupMembership[] }> {
    return authFetch('/groups/mine');
  },

  read(id: string): Promise<GroupDetail> {
    return authFetch(`/groups/${encodeURIComponent(id)}`);
  },

  searchUsers(
    q: string,
    groupId?: string,
  ): Promise<{ items: { id: string; name: string | null; email: string }[] }> {
    const params = new URLSearchParams({ q });
    if (groupId) params.set('groupId', groupId);
    return authFetch(`/groups/user-search?${params.toString()}`);
  },

  listInvites(scope: 'received' | 'sent'): Promise<{ items: GroupInvite[] }> {
    return authFetch(`/groups/invites?scope=${encodeURIComponent(scope)}`);
  },

  create(input: CreateGroupInput): Promise<Group> {
    return authFetch('/groups', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(id: string, input: UpdateGroupInput): Promise<Group> {
    return authFetch(`/groups/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  delete(id: string): Promise<void> {
    return authFetch(`/groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /** Admin only — paginated list of soft-deleted groups, newest first. */
  listDeleted(): Promise<{ data: (Group & { deletedAt: string })[] }> {
    return authFetch('/groups/deleted');
  },

  /** Admin only — clear deletedAt to restore the group. */
  restore(id: string): Promise<Group> {
    return authFetch(`/groups/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  },

  invite(groupId: string, input: InviteToGroupInput): Promise<GroupInvite> {
    return authFetch(`/groups/${encodeURIComponent(groupId)}/invites`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  acceptInvite(inviteId: string): Promise<void> {
    return authFetch(`/groups/invites/${encodeURIComponent(inviteId)}/accept`, {
      method: 'POST',
    });
  },

  rejectInvite(inviteId: string): Promise<void> {
    return authFetch(`/groups/invites/${encodeURIComponent(inviteId)}/reject`, {
      method: 'POST',
    });
  },

  revokeInvite(inviteId: string): Promise<void> {
    return authFetch(`/groups/invites/${encodeURIComponent(inviteId)}`, {
      method: 'DELETE',
    });
  },

  removeMember(groupId: string, userId: string): Promise<void> {
    return authFetch(
      `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
  },

  leave(groupId: string): Promise<void> {
    return authFetch(`/groups/${encodeURIComponent(groupId)}/leave`, { method: 'POST' });
  },
};
