'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, CheckCheck, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { authFetch } from '@/lib/auth';
import { groupsApi } from '@/lib/api/groups';
import { notificationsApi, type Notification } from '@/lib/api/notifications';
import { CHOICE_LABELS, isApprovalChoice, type ApprovalChoice } from '@/lib/approval-labels';
import { useNotificationsStream } from './use-notifications-stream';

// Mirrors the (non-exported) map in `(dashboard)/conversations/approval-card.tsx` —
// only the standing-deny reasons a TOOL_APPROVAL notice can carry.
const REASON_TEXT: Record<string, string> = {
  standing_deny: 'Blocked automatically by a standing "always deny" rule for this tool.',
  session_deny: 'Blocked automatically by a "deny this session" rule for this tool.',
};

const POLL_INTERVAL_MS = 30_000;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { items: list, unreadCount } = await notificationsApi.list();
      setItems(list);
      setUnread(unreadCount);
    } catch {
      // Bell is supplementary — silent fail keeps the header clean.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Real-time push: prepend the row, bump unread, and surface a toast that
  // doubles as a quick-action panel for GROUP_INVITE rows.
  useNotificationsStream({
    onNotification: (n) => {
      setItems((prev) => {
        if (prev.some((x) => x.id === n.id)) return prev;
        return [n, ...prev];
      });
      setUnread((u) => u + 1);

      if (n.type === 'PRIMARY_AGENT_ASSIGNED') {
        const name = n.payload.agentName ?? 'a new primary agent';
        toast.success('Primary agent updated', {
          description: `An admin has switched your primary agent to ${name}.`,
          duration: 8000,
        });
        return;
      }

      if (n.type === 'TOOL_APPROVAL') {
        // No toast here — the amber dashboard banner (pendingApprovals in
        // unread-chat-provider.tsx, fed by the chat WS's approval.* frames)
        // already surfaces live prompts. A second popup on top of the bell
        // badge bump above would just be redundant noise.
        return;
      }

      if (n.type === 'GROUP_INVITE_RESPONSE') {
        const who = n.payload.responderName ?? n.payload.responderEmail ?? 'A member';
        const groupName = n.payload.groupName ?? 'your group';
        const accepted = n.payload.response === 'accepted';
        const message = `${who} ${accepted ? 'accepted' : 'rejected'} your invite to ${groupName}`;
        if (accepted) toast.success(message);
        else toast(message);
        // Surfaces (Sent invites tab) listen for this so they can reload.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('clawix:invite-responded'));
        }
        return;
      }

      if (n.type === 'GROUP_INVITE' && n.payload.inviteId) {
        const groupName = n.payload.groupName ?? 'a group';
        const inviteId = n.payload.inviteId;
        toast.message(`New invite to ${groupName}`, {
          description: 'Choose Accept or Reject from the bell — or right here.',
          duration: 10_000,
          action: {
            label: 'Accept',
            onClick: () => {
              void groupsApi.acceptInvite(inviteId).then(async () => {
                await notificationsApi.markRead(n.id);
                setItems((prev) => prev.filter((x) => x.id !== n.id));
                toast.success(`Joined ${groupName}`);
                await refresh();
              });
            },
          },
          cancel: {
            label: 'Reject',
            onClick: () => {
              void groupsApi.rejectInvite(inviteId).then(async () => {
                await notificationsApi.markRead(n.id);
                setItems((prev) => prev.filter((x) => x.id !== n.id));
                await refresh();
              });
            },
          },
        });
      } else {
        toast.message('New notification', {
          description: n.type,
        });
      }
    },
  });

  const dismiss = (id: string) => setItems((prev) => prev.filter((x) => x.id !== id));

  const handleAccept = async (n: Notification) => {
    if (!n.payload.inviteId) return;
    setBusyId(n.id);
    const groupName = n.payload.groupName ?? 'the group';
    try {
      await groupsApi.acceptInvite(n.payload.inviteId);
      await notificationsApi.markRead(n.id);
      dismiss(n.id);
      toast.success(`Joined ${groupName}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to accept invite');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (n: Notification) => {
    if (!n.payload.inviteId) return;
    setBusyId(n.id);
    const groupName = n.payload.groupName ?? 'the group';
    try {
      await groupsApi.rejectInvite(n.payload.inviteId);
      await notificationsApi.markRead(n.id);
      dismiss(n.id);
      toast(`Declined invite to ${groupName}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reject invite');
    } finally {
      setBusyId(null);
    }
  };

  const handleApprovalChoice = async (n: Notification, choice: ApprovalChoice) => {
    const approvalId = n.payload.approvalId;
    if (!approvalId) return;
    setBusyId(n.id);
    try {
      const res = await authFetch<{ success: true; data: { downgraded: boolean } }>(
        `/api/v1/chat/approvals/${encodeURIComponent(approvalId)}/resolve`,
        { method: 'POST', body: JSON.stringify({ choice }) },
      );
      await notificationsApi.markRead(n.id);
      dismiss(n.id);
      if (res.data.downgraded) {
        toast.info('Your choice exceeded what was offered — downgraded to a narrower scope.');
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to resolve approval');
    } finally {
      setBusyId(null);
    }
  };

  const handleApprovalRevoke = async (n: Notification) => {
    const approvalId = n.payload.approvalId;
    if (!approvalId) return;
    setBusyId(n.id);
    try {
      await authFetch<{ success: true }>(
        `/api/v1/chat/approvals/${encodeURIComponent(approvalId)}/revoke`,
        { method: 'POST' },
      );
      await notificationsApi.markRead(n.id);
      dismiss(n.id);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to revoke');
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkAll = async () => {
    setLoading(true);
    try {
      await notificationsApi.markAllRead();
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 ? (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 min-w-[1rem] rounded-full bg-red-600 px-1 text-[10px] text-white border-red-700 hover:bg-red-600"
            >
              {unread > 99 ? '99+' : unread}
            </Badge>
          ) : null}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        // data-bell-popover hooks a fade-only keyframe defined in
        // globals.css that overrides the default zoom + slide.
        data-bell-popover=""
        className="w-96 p-0"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkAll}
            disabled={loading || unread === 0}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCheck className="h-3 w-3" />
            )}
            <span className="ml-1 text-xs">Mark all read</span>
          </Button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              You're all caught up.
            </div>
          ) : (
            items.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                busy={busyId === n.id}
                onAccept={() => handleAccept(n)}
                onReject={() => handleReject(n)}
                onApprovalChoice={(choice) => handleApprovalChoice(n, choice)}
                onApprovalRevoke={() => handleApprovalRevoke(n)}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  notification,
  busy,
  onAccept,
  onReject,
  onApprovalChoice,
  onApprovalRevoke,
}: {
  notification: Notification;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  onApprovalChoice: (choice: ApprovalChoice) => void;
  onApprovalRevoke: () => void;
}) {
  if (notification.type === 'TOOL_APPROVAL') {
    const { toolName, paramsSummary, offeredScopes, reason } = notification.payload;
    // Honest-buttons rule: only the choices the server actually offered —
    // never a hardcoded six.
    const choices = (offeredScopes ?? []).filter(isApprovalChoice);
    const paramsEntries = paramsSummary ? Object.entries(paramsSummary) : [];
    return (
      <div
        className={`flex flex-col gap-2 border-b px-3 py-3 text-sm last:border-b-0 ${
          notification.isRead ? 'opacity-60' : ''
        }`}
      >
        <div>
          <span className="font-medium">Tool approval</span>:{' '}
          <code className="font-mono text-xs">{toolName ?? 'unknown'}</code>
        </div>
        {paramsEntries.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {paramsEntries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="truncate font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {choices.length === 0 && reason && (
          <div className="text-xs text-muted-foreground">{REASON_TEXT[reason] ?? reason}</div>
        )}
        <div className="text-xs text-muted-foreground">
          {new Date(notification.createdAt).toLocaleString()}
        </div>
        {choices.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {choices.map((choice) => (
              <Button
                key={choice}
                size="sm"
                variant={choice.startsWith('allow') ? 'default' : 'destructive'}
                disabled={busy}
                onClick={() => onApprovalChoice(choice)}
              >
                {CHOICE_LABELS[choice]}
              </Button>
            ))}
          </div>
        ) : (
          <div>
            <Button size="sm" variant="outline" disabled={busy} onClick={onApprovalRevoke}>
              Revoke standing deny
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (notification.type === 'GROUP_INVITE') {
    const groupName = notification.payload.groupName ?? 'a group';
    return (
      <div
        className={`flex flex-col gap-2 border-b px-3 py-3 text-sm last:border-b-0 ${
          notification.isRead ? 'opacity-60' : ''
        }`}
      >
        <div>
          <span className="font-medium">Invite</span> to{' '}
          <span className="font-medium">{groupName}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {new Date(notification.createdAt).toLocaleString()}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={onAccept} disabled={busy}>
            <Check className="mr-1 h-3 w-3" />
            Accept
          </Button>
          <Button size="sm" variant="ghost" onClick={onReject} disabled={busy}>
            Reject
          </Button>
        </div>
      </div>
    );
  }

  if (notification.type === 'GROUP_INVITE_RESPONSE') {
    const who =
      notification.payload.responderName ?? notification.payload.responderEmail ?? 'A member';
    const groupName = notification.payload.groupName ?? 'your group';
    const accepted = notification.payload.response === 'accepted';
    return (
      <div
        className={`border-b px-3 py-3 text-sm last:border-b-0 ${
          notification.isRead ? 'opacity-60' : ''
        }`}
      >
        <div className="font-medium">
          {who}{' '}
          <span className={accepted ? 'text-emerald-400' : 'text-muted-foreground'}>
            {accepted ? 'accepted' : 'rejected'}
          </span>{' '}
          your invite
        </div>
        <div className="text-xs text-muted-foreground">to {groupName}</div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {new Date(notification.createdAt).toLocaleString()}
        </div>
      </div>
    );
  }

  if (notification.type === 'PRIMARY_AGENT_ASSIGNED') {
    const name = notification.payload.agentName ?? 'a new primary agent';
    return (
      <div
        className={`border-b px-3 py-3 text-sm last:border-b-0 ${
          notification.isRead ? 'opacity-60' : ''
        }`}
      >
        <div className="font-medium">Primary agent updated</div>
        <div className="text-xs text-muted-foreground">
          An admin switched your primary agent to <span className="text-foreground">{name}</span>.
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {new Date(notification.createdAt).toLocaleString()}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`border-b px-3 py-3 text-sm last:border-b-0 ${
        notification.isRead ? 'opacity-60' : ''
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {notification.type}
      </div>
      <div className="text-xs text-muted-foreground">
        {new Date(notification.createdAt).toLocaleString()}
      </div>
    </div>
  );
}
