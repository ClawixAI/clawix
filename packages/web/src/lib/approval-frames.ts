import { isApprovalChoice, type ApprovalChoice } from '@/lib/approval-labels';

/**
 * Wire shape for the chat WebSocket's `approval.request` | `approval.notice`
 * | `approval.resolved` frames — mirrors `ApprovalFramePayload` from
 * `packages/api/src/approvals/approval-delivery.service.ts`. `kind` (not the
 * outer WS `type` string) drives reducer semantics: `'prompt'` and
 * `'notice'` upsert a card, `'resolved'` mutates one.
 */
export interface IncomingApprovalFrame {
  readonly kind: 'prompt' | 'notice' | 'resolved';
  readonly approvalId: string;
  readonly toolName?: string;
  readonly paramsSummary?: Record<string, string>;
  readonly offeredScopes?: readonly string[];
  readonly reason?: string;
  readonly expiresAt?: string; // ISO
  readonly status?: string; // resolved only: APPROVED | DENIED | EXPIRED | CANCELLED | REVOKED (client-synthesized)
  readonly scope?: string; // resolved only: once | session | always
}

export type ApprovalFrameStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';

/** Client-side approval card state — one entry per `approvalId`. */
export interface ApprovalFrame {
  readonly approvalId: string;
  readonly kind: 'prompt' | 'notice';
  readonly toolName?: string;
  readonly paramsSummary?: Record<string, string>;
  readonly offeredScopes?: readonly ApprovalChoice[];
  readonly reason?: string;
  readonly expiresAt?: string;
  readonly status: ApprovalFrameStatus;
  readonly scope?: string;
}

/** Raw shape returned by `GET /api/v1/chat/approvals/pending` (the Prisma
 *  `ApprovalRequest` row, Task 11) — only the fields this module reads. */
export interface PendingApprovalRow {
  readonly id: string;
  readonly toolName: string;
  readonly paramsSummary: unknown;
}

function toStatus(raw: string | undefined): ApprovalFrameStatus {
  switch (raw) {
    case 'APPROVED':
      return 'approved';
    case 'EXPIRED':
      return 'expired';
    case 'CANCELLED':
      return 'cancelled';
    case 'DENIED':
      return 'denied';
    default:
      // Unexpected/missing status on a resolved frame — treat conservatively
      // as a denial rather than silently re-arming the offer buttons.
      return 'denied';
  }
}

/** A resolved frame's status that means "this card is done, drop it." */
function isRemovalStatus(raw: string | undefined): boolean {
  return raw === 'APPROVED' || raw === 'REVOKED';
}

function toOfferedScopes(
  raw: readonly string[] | undefined,
): readonly ApprovalChoice[] | undefined {
  if (!raw) return undefined;
  return raw.filter(isApprovalChoice);
}

/**
 * Pure reducer merging one incoming WS frame into the current approval-card
 * list (spec §7 / Task 13):
 *  - `prompt` | `notice`: appends a new card, or replaces the existing one in
 *    place if `approvalId` already exists (duplicate delivery, e.g. reconnect
 *    replay).
 *  - `resolved`: mutates the matching card. `APPROVED` (and a client-side
 *    `REVOKED`, used after a successful `/revoke` call) removes the card;
 *    any other status (`DENIED`, `EXPIRED`, `CANCELLED`) keeps it, flipping
 *    `status` so the card can show the outcome (and, for a scoped deny, an
 *    Undo action). An unknown `approvalId` is a no-op — nothing to resolve.
 */
export function applyApprovalFrame(
  list: ApprovalFrame[],
  frame: IncomingApprovalFrame,
): ApprovalFrame[] {
  if (frame.kind === 'resolved') {
    const idx = list.findIndex((f) => f.approvalId === frame.approvalId);
    if (idx === -1) return list;
    if (isRemovalStatus(frame.status)) {
      return list.filter((f) => f.approvalId !== frame.approvalId);
    }
    const status = toStatus(frame.status);
    return list.map((f, i) =>
      i === idx
        ? { ...f, status, ...(frame.scope !== undefined ? { scope: frame.scope } : {}) }
        : f,
    );
  }

  const next: ApprovalFrame = {
    approvalId: frame.approvalId,
    kind: frame.kind,
    toolName: frame.toolName,
    paramsSummary: frame.paramsSummary,
    offeredScopes: toOfferedScopes(frame.offeredScopes),
    reason: frame.reason,
    expiresAt: frame.expiresAt,
    status: 'pending',
  };
  const idx = list.findIndex((f) => f.approvalId === frame.approvalId);
  if (idx === -1) return [...list, next];
  return list.map((f, i) => (i === idx ? next : f));
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === 'string');
}

/**
 * Converts a raw `GET /approvals/pending` row (reload recovery) into an
 * `ApprovalFrame`. That endpoint returns the bare `ApprovalRequest` row,
 * which — unlike the live WS prompt frame — carries no `offeredScopes` or
 * `expiresAt` (those are computed only at prompt-delivery time, Task 9/11).
 * We default to `['allow_once', 'deny_once']`: per `offeredScopes()` in
 * `packages/api/src/approvals/approval.types.ts`, those two choices are
 * always in the offered set regardless of scope kind, so this is never a
 * false affordance — just a conservative one until a fresh frame (if any)
 * supplies the richer set.
 */
export function pendingRowToFrame(row: PendingApprovalRow): ApprovalFrame {
  return {
    approvalId: row.id,
    kind: 'prompt',
    toolName: row.toolName,
    paramsSummary: isRecordOfStrings(row.paramsSummary) ? row.paramsSummary : undefined,
    offeredScopes: ['allow_once', 'deny_once'],
    status: 'pending',
  };
}
