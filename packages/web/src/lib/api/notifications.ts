import { authFetch } from '@/lib/auth';

export type NotificationType =
  | 'MEMORY_SHARED'
  | 'MEMORY_REVOKED'
  | 'GROUP_INVITE'
  | 'GROUP_INVITE_RESPONSE'
  | 'PRIMARY_AGENT_ASSIGNED';

export interface NotificationPayload {
  inviteId?: string;
  groupId?: string;
  groupName?: string | null;
  invitedById?: string;
  memoryItemId?: string;
  shareId?: string;
  sharedBy?: string;
  agentDefinitionId?: string;
  agentName?: string | null;
  // GROUP_INVITE_RESPONSE
  response?: 'accepted' | 'rejected';
  responderId?: string;
  responderName?: string | null;
  responderEmail?: string | null;
}

export interface Notification {
  id: string;
  recipientId: string;
  type: NotificationType;
  payload: NotificationPayload;
  isRead: boolean;
  createdAt: string;
}

export const notificationsApi = {
  list(unreadOnly = false): Promise<{ items: Notification[]; unreadCount: number }> {
    return authFetch(`/notifications${unreadOnly ? '?unread=true' : ''}`);
  },
  markRead(id: string): Promise<void> {
    return authFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  },
  markAllRead(): Promise<void> {
    return authFetch('/notifications/read-all', { method: 'POST' });
  },
};
