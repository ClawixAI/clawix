'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { prefersReducedMotion } from '@/lib/prefers-reduced-motion';
import { useUnreadChat } from './unread-chat-provider';

/**
 * Dashboard-wide "an agent needs you" strip (spec §7 / Task 14). Renders only
 * when there's at least one approval prompt pending AND the user isn't
 * already on `/conversations` (where the real `ApprovalCard`s are visible) —
 * mirrors the same on-page suppression `unread-chat-provider.tsx` uses for
 * its own unread badge.
 *
 * `pendingApprovals` comes from `useUnreadChat()`, which parses the chat WS's
 * `approval.request` / `approval.resolved` frames — this component owns no
 * WS subscription of its own.
 */
export function PendingApprovalBanner() {
  const pathname = usePathname();
  const { pendingApprovals } = useUnreadChat();
  const [now, setNow] = useState(() => Date.now());

  // Only entries still awaiting a decision drive the banner. The shared
  // reducer deliberately KEEPS denied/expired/cancelled entries in the list
  // (the `/conversations` ApprovalCard shows their outcome + an Undo action),
  // so a raw `length > 0` would keep the banner stuck — e.g. at "(0s left)"
  // with a past `expiresAt` — after the user denies a prompt from the bell.
  const pending = pendingApprovals.filter((f) => f.status === 'pending');
  const hasPending = pending.length > 0;

  useEffect(() => {
    if (!hasPending) return;
    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [hasPending]);

  if (!hasPending) return null;
  if (pathname.startsWith('/conversations')) return null;

  // Surface the soonest-expiring prompt's countdown — that's the one most in
  // danger of auto-denial, so it's the most useful number to show.
  const soonestExpiry = pending.reduce<number | undefined>((min, frame) => {
    if (!frame.expiresAt) return min;
    const t = new Date(frame.expiresAt).getTime();
    return min === undefined || t < min ? t : min;
  }, undefined);
  const remaining =
    soonestExpiry !== undefined ? Math.max(0, Math.round((soonestExpiry - now) / 1000)) : null;

  const pulse = !prefersReducedMotion();

  return (
    <Link
      href="/conversations"
      className={cn(
        'fixed inset-x-0 top-14 z-40 flex items-center justify-center gap-2 border-b border-amber-600/50 bg-amber-500/90 px-4 py-2 text-sm font-medium text-amber-950 transition-colors hover:bg-amber-500 dark:bg-amber-600/90 dark:text-amber-50',
        pulse && 'animate-pulse',
      )}
    >
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>
        An agent is awaiting your approval{remaining !== null ? ` (${remaining}s left)` : ''} &rarr;
      </span>
    </Link>
  );
}
