import { describe, expect, it } from 'vitest';
import {
  applyApprovalFrame,
  pendingRowToFrame,
  type ApprovalFrame,
  type IncomingApprovalFrame,
} from '../approval-frames';

const prompt: IncomingApprovalFrame = {
  kind: 'prompt',
  approvalId: 'apr1',
  toolName: 'shell',
  paramsSummary: { command: 'ls -la' },
  offeredScopes: [
    'allow_once',
    'allow_session',
    'allow_always',
    'deny_once',
    'deny_session',
    'deny_always',
  ],
  expiresAt: '2026-01-01T00:05:00.000Z',
};

describe('applyApprovalFrame', () => {
  it('appends a new prompt card', () => {
    const result = applyApprovalFrame([], prompt);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      approvalId: 'apr1',
      kind: 'prompt',
      toolName: 'shell',
      status: 'pending',
      offeredScopes: prompt.offeredScopes,
    });
  });

  it('appends a new notice card', () => {
    const notice: IncomingApprovalFrame = {
      kind: 'notice',
      approvalId: 'apr2',
      toolName: 'wiki_delete',
      paramsSummary: { id: 'w1' },
      reason: 'standing_deny',
    };
    const result = applyApprovalFrame([], notice);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      approvalId: 'apr2',
      kind: 'notice',
      reason: 'standing_deny',
      status: 'pending',
    });
  });

  it('replaces the existing card in place on a duplicate approvalId (prompt/notice)', () => {
    const first = applyApprovalFrame([], prompt);
    const redelivered: IncomingApprovalFrame = {
      ...prompt,
      paramsSummary: { command: 'ls -la /tmp' },
    };
    const result = applyApprovalFrame(first, redelivered);
    expect(result).toHaveLength(1);
    expect(result[0]?.paramsSummary).toEqual({ command: 'ls -la /tmp' });
  });

  it('filters unknown offeredScopes values (defensive against a malformed frame)', () => {
    const malformed: IncomingApprovalFrame = {
      ...prompt,
      approvalId: 'apr9',
      offeredScopes: ['allow_once', 'bogus_scope'],
    };
    const result = applyApprovalFrame([], malformed);
    expect(result[0]?.offeredScopes).toEqual(['allow_once']);
  });

  it('resolved APPROVED removes the card', () => {
    const withPrompt = applyApprovalFrame([], prompt);
    const resolved: IncomingApprovalFrame = {
      kind: 'resolved',
      approvalId: 'apr1',
      status: 'APPROVED',
      scope: 'once',
    };
    const result = applyApprovalFrame(withPrompt, resolved);
    expect(result).toEqual([]);
  });

  it('resolved DENIED keeps the card and flips status + scope', () => {
    const withPrompt = applyApprovalFrame([], prompt);
    const resolved: IncomingApprovalFrame = {
      kind: 'resolved',
      approvalId: 'apr1',
      status: 'DENIED',
      scope: 'session',
    };
    const result = applyApprovalFrame(withPrompt, resolved);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ approvalId: 'apr1', status: 'denied', scope: 'session' });
  });

  it('resolved EXPIRED and CANCELLED also keep the card', () => {
    const withPrompt = applyApprovalFrame([], prompt);
    const expired = applyApprovalFrame(withPrompt, {
      kind: 'resolved',
      approvalId: 'apr1',
      status: 'EXPIRED',
    });
    expect(expired[0]?.status).toBe('expired');

    const cancelled = applyApprovalFrame(withPrompt, {
      kind: 'resolved',
      approvalId: 'apr1',
      status: 'CANCELLED',
    });
    expect(cancelled[0]?.status).toBe('cancelled');
  });

  it('resolved REVOKED (client-synthesized, after a successful /revoke call) removes the card', () => {
    const denied: ApprovalFrame[] = [
      { approvalId: 'apr1', kind: 'prompt', status: 'denied', scope: 'session' },
    ];
    const result = applyApprovalFrame(denied, {
      kind: 'resolved',
      approvalId: 'apr1',
      status: 'REVOKED',
    });
    expect(result).toEqual([]);
  });

  it('resolved for an unknown approvalId is a no-op', () => {
    const withPrompt = applyApprovalFrame([], prompt);
    const result = applyApprovalFrame(withPrompt, {
      kind: 'resolved',
      approvalId: 'does-not-exist',
      status: 'APPROVED',
    });
    expect(result).toBe(withPrompt);
  });

  it('resolved for an unknown approvalId on an empty list is a no-op', () => {
    const result = applyApprovalFrame([], {
      kind: 'resolved',
      approvalId: 'does-not-exist',
      status: 'DENIED',
    });
    expect(result).toEqual([]);
  });
});

describe('pendingRowToFrame', () => {
  it('maps a raw ApprovalRequest row to a pending prompt frame with the safe-minimum offered scopes', () => {
    const frame = pendingRowToFrame({
      id: 'apr5',
      toolName: 'shell',
      paramsSummary: { command: 'echo hi' },
    });
    expect(frame).toEqual({
      approvalId: 'apr5',
      kind: 'prompt',
      toolName: 'shell',
      paramsSummary: { command: 'echo hi' },
      offeredScopes: ['allow_once', 'deny_once'],
      status: 'pending',
    });
  });

  it('drops a non-string-record paramsSummary rather than rendering garbage', () => {
    const frame = pendingRowToFrame({ id: 'apr6', toolName: 'shell', paramsSummary: { n: 42 } });
    expect(frame.paramsSummary).toBeUndefined();
  });
});
