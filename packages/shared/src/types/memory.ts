export type ShareTarget = 'GROUP' | 'ORG';
export type GroupMemberRole = 'OWNER' | 'MEMBER';
export type NotificationType = 'MEMORY_SHARED' | 'MEMORY_REVOKED' | 'GROUP_INVITE';

export interface Group {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdById: string;
  readonly createdAt: Date;
}

export interface GroupMember {
  readonly groupId: string;
  readonly userId: string;
  readonly role: GroupMemberRole;
  readonly joinedAt: Date;
}

export interface Notification {
  readonly id: string;
  readonly recipientId: string;
  readonly type: NotificationType;
  readonly payload: Record<string, unknown>;
  readonly isRead: boolean;
  readonly createdAt: Date;
}
