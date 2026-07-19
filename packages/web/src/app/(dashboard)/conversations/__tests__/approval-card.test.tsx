import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApprovalCard } from '../approval-card';
import type { ApprovalFrame } from '@/lib/approval-frames';

const authFetchMock = vi.fn();

vi.mock('@/lib/auth', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const basePrompt: ApprovalFrame = {
  approvalId: 'apr1',
  kind: 'prompt',
  toolName: 'shell',
  paramsSummary: { command: 'rm -rf /tmp/x' },
  offeredScopes: ['allow_once', 'deny_once'],
  status: 'pending',
};

describe('ApprovalCard — honest-buttons rule', () => {
  it('renders exactly one button per offeredScopes entry, never a hardcoded six', () => {
    render(createElement(ApprovalCard, { frame: basePrompt, onResolved: vi.fn() }));
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Always allow' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Always deny' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow this session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deny this session' })).not.toBeInTheDocument();
  });

  it('renders all six buttons when all six scopes are offered', () => {
    const frame: ApprovalFrame = {
      ...basePrompt,
      offeredScopes: [
        'allow_once',
        'allow_session',
        'allow_always',
        'deny_once',
        'deny_session',
        'deny_always',
      ],
    };
    render(createElement(ApprovalCard, { frame, onResolved: vi.fn() }));
    for (const label of [
      'Allow once',
      'Allow this session',
      'Always allow',
      'Deny',
      'Deny this session',
      'Always deny',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('renders the params summary as key/value pairs', () => {
    render(createElement(ApprovalCard, { frame: basePrompt, onResolved: vi.fn() }));
    expect(screen.getByText('command')).toBeInTheDocument();
    expect(screen.getByText('rm -rf /tmp/x')).toBeInTheDocument();
  });
});

describe('ApprovalCard — resolve action', () => {
  it('POSTs the chosen scope and reports a synthesized resolved frame', async () => {
    authFetchMock.mockResolvedValue({ success: true, data: { downgraded: false } });
    const onResolved = vi.fn();
    render(createElement(ApprovalCard, { frame: basePrompt, onResolved }));

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith({
        kind: 'resolved',
        approvalId: 'apr1',
        status: 'APPROVED',
        scope: 'once',
      });
    });
    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/v1/chat/approvals/apr1/resolve',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ choice: 'allow_once' }) }),
    );
  });
});

describe('ApprovalCard — notice kind', () => {
  it('shows the reason line and a single revoke button, no offer buttons', () => {
    const notice: ApprovalFrame = {
      approvalId: 'apr2',
      kind: 'notice',
      toolName: 'wiki_delete',
      reason: 'standing_deny',
      status: 'pending',
    };
    render(createElement(ApprovalCard, { frame: notice, onResolved: vi.fn() }));
    expect(screen.getByText(/standing "always deny" rule/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke standing deny' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow once' })).not.toBeInTheDocument();
  });
});

describe('ApprovalCard — resolved denial', () => {
  it('keeps a scoped denial visible with an Undo action', () => {
    const denied: ApprovalFrame = {
      approvalId: 'apr3',
      kind: 'prompt',
      toolName: 'shell',
      status: 'denied',
      scope: 'session',
    };
    render(createElement(ApprovalCard, { frame: denied, onResolved: vi.fn() }));
    expect(screen.getByText('Denied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('does not offer Undo for a one-off (once-scoped) denial — nothing to revoke', () => {
    const denied: ApprovalFrame = {
      approvalId: 'apr4',
      kind: 'prompt',
      toolName: 'shell',
      status: 'denied',
      scope: 'once',
    };
    render(createElement(ApprovalCard, { frame: denied, onResolved: vi.fn() }));
    expect(screen.getByText('Denied')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });
});
