'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { authFetch, getAccessToken } from '@/lib/auth';
import {
  applyApprovalFrame,
  pendingRowToFrame,
  type ApprovalFrame,
  type IncomingApprovalFrame,
  type PendingApprovalRow,
} from '@/lib/approval-frames';

/**
 * Tracks incoming chat `message.create` frames that arrive while the user
 * is NOT on `/conversations`, so the sidebar can render an unread indicator.
 *
 * Why a separate WebSocket from `useChat`'s connection (in
 * `(dashboard)/conversations/use-chat.ts`):
 *   - The chat hook only mounts when the user is on /conversations. With
 *     scheduled tasks delivering to the web channel (see #134), an assistant
 *     message can arrive anytime — we need a listener that's alive across
 *     the whole dashboard.
 *   - This provider disconnects its socket while on /conversations to avoid
 *     keeping two chat sockets per user open at once; use-chat owns it then.
 *
 * Dedupe by `messageId` so streaming chunks don't inflate the count.
 */

interface UnreadChatContextValue {
  readonly count: number;
  readonly clear: () => void;
  /** Approval prompts awaiting the user's choice (spec §7) — fed by the same
   *  chat WS connection's `approval.request` / `approval.resolved` frames.
   *  Drives `pending-approval-banner.tsx`. `approval.notice` frames (standing-
   *  deny auto-resolutions) are intentionally NOT added here — there's
   *  nothing pending for the user to act on. */
  readonly pendingApprovals: readonly ApprovalFrame[];
}

const UnreadChatContext = createContext<UnreadChatContextValue>({
  count: 0,
  clear: () => undefined,
  pendingApprovals: [],
});

export function useUnreadChat(): UnreadChatContextValue {
  return useContext(UnreadChatContext);
}

const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface IncomingFrame {
  readonly type: string;
  readonly payload?: unknown;
}

export function UnreadChatProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalFrame[]>([]);
  const seenIds = useRef<Set<string>>(new Set());

  const onChatPage = pathname.startsWith('/conversations');

  // Drop unread state whenever the user navigates onto the chat page —
  // they're seeing the transcript live, so no badge needed.
  useEffect(() => {
    if (onChatPage) {
      setCount(0);
      seenIds.current.clear();
    }
  }, [onChatPage]);

  useEffect(() => {
    // Skip opening a socket while on /conversations — use-chat already owns
    // one and we don't want to double-count anything (the listeners share
    // the same backend session messages).
    if (onChatPage) return;
    let stopped = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = RECONNECT_INITIAL_MS;

    // Reconcile pendingApprovals against the server's authoritative pending
    // set. Covers both a fresh page load and resuming this socket after it
    // was closed while the user was on /conversations — during that window
    // we couldn't see any approval.resolved frames, so a stale entry here
    // would show the banner for an approval that's already been decided.
    void authFetch<{ data: PendingApprovalRow[] }>('/api/v1/chat/approvals/pending')
      .then((res) => {
        if (stopped) return;
        const rows = Array.isArray(res.data) ? res.data : [];
        setPendingApprovals((prev) => {
          const serverIds = new Set(rows.map((r) => r.id));
          const kept = prev.filter((f) => serverIds.has(f.approvalId));
          const keptIds = new Set(kept.map((f) => f.approvalId));
          const added = rows.filter((r) => !keptIds.has(r.id)).map(pendingRowToFrame);
          return added.length ? [...kept, ...added] : kept;
        });
      })
      .catch(() => {
        // Not yet authenticated, or a transient network error — live WS
        // frames (and the next reconnect's reconciliation) keep this in sync.
      });

    const connect = async (): Promise<void> => {
      if (stopped) return;
      const token = await getAccessToken();
      if (stopped) return;
      if (!token) {
        reconnectTimer = setTimeout(() => void connect(), RECONNECT_INITIAL_MS);
        return;
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const base =
        process.env['NEXT_PUBLIC_WS_URL'] || `${protocol}//${window.location.hostname}:3001`;
      ws = new WebSocket(`${base}/ws/chat?token=${encodeURIComponent(token)}`);

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as IncomingFrame;

          if (msg.type === 'message.create') {
            const id = (msg.payload as { messageId?: string } | undefined)?.messageId;
            if (!id) return;
            if (seenIds.current.has(id)) return;
            seenIds.current.add(id);
            setCount((c) => c + 1);
            return;
          }

          // Tool-approval prompt/resolved frames (spec §7, Task 9) — same
          // wire shape and reducer `use-chat.ts` uses for the in-chat
          // approval cards. `approval.notice` (standing-deny auto-resolution)
          // is intentionally NOT handled here: nothing is pending on it.
          if (msg.type === 'approval.request' || msg.type === 'approval.resolved') {
            setPendingApprovals((prev) =>
              applyApprovalFrame(prev, msg.payload as IncomingApprovalFrame),
            );
          }
        } catch {
          // Malformed frames are ignored — use-chat handles real parse.
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
        reconnectTimer = setTimeout(() => void connect(), backoff);
      };

      ws.onerror = (event) => {
        // eslint-disable-next-line no-console -- dev breadcrumb; onclose owns reconnect UX
        console.error('[unread-chat] WebSocket error', event);
      };
    };

    void connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        // Detach handlers so the intentional close doesn't schedule a
        // reconnect or surface a fake handshake error in dev double-mount.
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        ws = null;
      }
    };
  }, [onChatPage]);

  return (
    <UnreadChatContext.Provider
      value={{
        count,
        clear: () => {
          setCount(0);
          seenIds.current.clear();
        },
        pendingApprovals,
      }}
    >
      {children}
    </UnreadChatContext.Provider>
  );
}
