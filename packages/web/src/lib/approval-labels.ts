/**
 * Canonical labels for the six `ApprovalChoice` values used by the tool-call
 * approval flow. Mirrors `ApprovalChoice` in
 * `packages/api/src/approvals/approval.types.ts` (spec §4) — the web package
 * can't import server-side types directly, so this union is a hand-kept
 * mirror. Exported from this shared module so the chat approval card and the
 * settings-page standing-approvals list both consume the same map instead of
 * duplicating labels.
 */
export type ApprovalChoice =
  | 'allow_once'
  | 'allow_session'
  | 'allow_always'
  | 'deny_once'
  | 'deny_session'
  | 'deny_always';

export const CHOICE_LABELS: Record<ApprovalChoice, string> = {
  allow_once: 'Allow once',
  allow_session: 'Allow this session',
  allow_always: 'Always allow',
  deny_once: 'Deny',
  deny_session: 'Deny this session',
  deny_always: 'Always deny',
};

/** Narrows an arbitrary string (e.g. from a WS frame) to a known `ApprovalChoice`. */
export function isApprovalChoice(value: string): value is ApprovalChoice {
  return Object.prototype.hasOwnProperty.call(CHOICE_LABELS, value);
}
