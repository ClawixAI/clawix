import { authFetch } from '@/lib/auth';

export type NotificationType =
  | 'MEMORY_SHARED'
  | 'MEMORY_REVOKED'
  | 'GROUP_INVITE'
  | 'GROUP_INVITE_RESPONSE'
  | 'PRIMARY_AGENT_ASSIGNED'
  | 'TOOL_APPROVAL';

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
  // TOOL_APPROVAL (raised by ApprovalDeliveryService.deliverPrompt/deliverNotice —
  // packages/api/src/approvals/approval-delivery.service.ts. `offeredScopes` and
  // `expiresAt` are only present on prompt deliveries, not standing-deny notices.
  // `warnings` is tool-authored (e.g. shell_net flagging a python/pip call as a
  // python_run[_net] policy bypass) and only ever set on prompt deliveries.
  approvalId?: string;
  toolName?: string;
  paramsSummary?: Record<string, string>;
  offeredScopes?: string[];
  reason?: string;
  warnings?: string[];
  expiresAt?: string;
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
