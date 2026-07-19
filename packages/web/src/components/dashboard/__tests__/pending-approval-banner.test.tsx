import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { PendingApprovalBanner } from '../pending-approval-banner';
import type { ApprovalFrame } from '@/lib/approval-frames';

const pathnameMock = vi.fn<() => string>();
const useUnreadChatMock = vi.fn<() => { pendingApprovals: ApprovalFrame[] }>();

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
}));

vi.mock('../unread-chat-provider', () => ({
  useUnreadChat: () => useUnreadChatMock(),
}));

// jsdom has no matchMedia; prefersReducedMotion() calls it on the render path.
window.matchMedia ??= ((query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList) as typeof window.matchMedia;

function setup(pendingApprovals: ApprovalFrame[], pathname = '/agents') {
  pathnameMock.mockReturnValue(pathname);
  useUnreadChatMock.mockReturnValue({ pendingApprovals });
  render(createElement(PendingApprovalBanner));
}

const pendingFrame: ApprovalFrame = {
  approvalId: 'apr1',
  kind: 'prompt',
  toolName: 'shell',
  status: 'pending',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PendingApprovalBanner', () => {
  it('renders when at least one approval is still pending and off /conversations', () => {
    setup([pendingFrame]);
    expect(screen.getByText(/awaiting your approval/i)).toBeInTheDocument();
  });

  it('does NOT render on /conversations even with a pending approval', () => {
    setup([pendingFrame], '/conversations');
    expect(screen.queryByText(/awaiting your approval/i)).not.toBeInTheDocument();
  });

  it('does NOT render when the only entries are resolved (denied/expired/cancelled)', () => {
    // The shared reducer keeps denied/expired/cancelled entries in the list for
    // the /conversations ApprovalCard's Undo affordance — the banner must NOT
    // treat them as pending, or it sticks after the user resolves from the bell.
    const denied: ApprovalFrame = { ...pendingFrame, approvalId: 'apr2', status: 'denied' };
    const expired: ApprovalFrame = { ...pendingFrame, approvalId: 'apr3', status: 'expired' };
    setup([denied, expired]);
    expect(screen.queryByText(/awaiting your approval/i)).not.toBeInTheDocument();
  });

  it('renders when a pending entry coexists with resolved ones', () => {
    const denied: ApprovalFrame = { ...pendingFrame, approvalId: 'apr2', status: 'denied' };
    setup([denied, pendingFrame]);
    expect(screen.getByText(/awaiting your approval/i)).toBeInTheDocument();
  });
});
