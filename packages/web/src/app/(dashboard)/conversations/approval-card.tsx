'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { authFetch } from '@/lib/auth';
import { CHOICE_LABELS, type ApprovalChoice } from '@/lib/approval-labels';
import { cn } from '@/lib/utils';
import type { ApprovalFrame, IncomingApprovalFrame } from '@/lib/approval-frames';
import { prefersReducedMotion } from '@/lib/prefers-reduced-motion';

/** Seconds remaining until `expiresAt`, ticking every second; `null` when absent. */
function useCountdown(expiresAt: string | undefined): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) {
      setSecondsLeft(null);
      return;
    }
    const target = new Date(expiresAt).getTime();
    const tick = () => {
      setSecondsLeft(Math.max(0, Math.round((target - Date.now()) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [expiresAt]);

  return secondsLeft;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const REASON_TEXT: Record<string, string> = {
  standing_deny: 'Blocked automatically by a standing "always deny" rule for this tool.',
  session_deny: 'Blocked automatically by a "deny this session" rule for this tool.',
};

const STATUS_BADGE: Record<string, { label: string; variant: 'destructive' | 'outline' }> = {
  denied: { label: 'Denied', variant: 'destructive' },
  expired: { label: 'Expired', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
};

interface ApprovalCardProps {
  frame: ApprovalFrame;
  /** Called with a synthetic `resolved` frame after a successful resolve/revoke
   *  call — the caller applies it through `applyApprovalFrame` so this
   *  component never mutates approval state directly. */
  onResolved: (frame: IncomingApprovalFrame) => void;
}

/**
 * One tool-approval card. Renders exactly one button per entry in
 * `frame.offeredScopes` — never a hardcoded six (honest-buttons rule) — plus
 * a countdown for pending prompts and an Undo/Revoke action for resolved
 * denials and standing-deny notices.
 */
export function ApprovalCard({ frame, onResolved }: ApprovalCardProps) {
  const [busy, setBusy] = useState(false);
  const secondsLeft = useCountdown(
    frame.kind === 'prompt' && frame.status === 'pending' ? frame.expiresAt : undefined,
  );

  async function handleChoice(choice: ApprovalChoice) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await authFetch<{ success: true; data: { downgraded: boolean } }>(
        `/api/v1/chat/approvals/${frame.approvalId}/resolve`,
        { method: 'POST', body: JSON.stringify({ choice }) },
      );
      onResolved({
        kind: 'resolved',
        approvalId: frame.approvalId,
        status: choice.startsWith('allow') ? 'APPROVED' : 'DENIED',
        scope: choice.endsWith('once') ? 'once' : choice.endsWith('session') ? 'session' : 'always',
      });
      if (res.data.downgraded) {
        toast.info('Your choice exceeded what was offered — downgraded to a narrower scope.');
      }
    } catch (err) {
      toast.error('Failed to resolve approval', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    if (busy) return;
    setBusy(true);
    try {
      await authFetch<{ success: true }>(`/api/v1/chat/approvals/${frame.approvalId}/revoke`, {
        method: 'POST',
      });
      onResolved({ kind: 'resolved', approvalId: frame.approvalId, status: 'REVOKED' });
    } catch (err) {
      toast.error('Failed to revoke', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  const paramsEntries = frame.paramsSummary ? Object.entries(frame.paramsSummary) : [];
  const urgent = secondsLeft !== null && secondsLeft <= 10;
  const pulse = urgent && !prefersReducedMotion();
  const resolvedBadge = frame.status !== 'pending' ? STATUS_BADGE[frame.status] : undefined;
  // Only a scoped (session/always) denial stamps a memoryStore/memoryKey the
  // server can revoke — a one-off `deny_once` leaves nothing to undo.
  const canUndo = frame.status === 'denied' && frame.scope !== undefined && frame.scope !== 'once';

  return (
    <Card className={cn('border-amber-500/50 bg-amber-500/5 py-4', pulse && 'animate-pulse')}>
      <CardHeader className="px-4">
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium">
          <span>
            Tool approval: <code className="font-mono text-xs">{frame.toolName ?? 'unknown'}</code>
          </span>
          {resolvedBadge && <Badge variant={resolvedBadge.variant}>{resolvedBadge.label}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 text-sm">
        {frame.kind === 'notice' && frame.reason && (
          <p className="text-muted-foreground">{REASON_TEXT[frame.reason] ?? frame.reason}</p>
        )}

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

        {frame.kind === 'prompt' && frame.status === 'pending' && secondsLeft !== null && (
          <p className={cn('text-xs text-muted-foreground', urgent && 'text-destructive')}>
            Expires in {formatCountdown(secondsLeft)}
          </p>
        )}

        {frame.kind === 'prompt' && frame.status === 'pending' && (
          <div className="flex flex-wrap gap-2">
            {(frame.offeredScopes ?? []).map((choice) => (
              <Button
                key={choice}
                size="sm"
                variant={choice.startsWith('allow') ? 'default' : 'destructive'}
                disabled={busy}
                onClick={() => void handleChoice(choice)}
              >
                {CHOICE_LABELS[choice]}
              </Button>
            ))}
          </div>
        )}

        {frame.kind === 'notice' && (
          <div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleRevoke()}>
              Revoke standing deny
            </Button>
          </div>
        )}

        {canUndo && (
          <div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleRevoke()}>
              Undo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
