import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NotificationBell } from '../notification-bell';
import { notificationsApi, type Notification } from '@/lib/api/notifications';
import { authFetch } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ authFetch: vi.fn() }));
vi.mock('@/lib/api/groups', () => ({ groupsApi: {} }));
// The WS stream is exercised elsewhere; stub it so the bell renders from the
// REST list only (no real socket in jsdom).
vi.mock('../use-notifications-stream', () => ({ useNotificationsStream: () => undefined }));
vi.mock('@/lib/api/notifications', () => ({
  notificationsApi: {
    list: vi.fn(),
    markRead: vi.fn(async () => undefined),
    markAllRead: vi.fn(async () => undefined),
  },
}));

const listMock = vi.mocked(notificationsApi.list);
const markReadMock = vi.mocked(notificationsApi.markRead);
const authFetchMock = vi.mocked(authFetch);

// Radix Popover needs these in jsdom.
beforeEach(() => {
  window.matchMedia ??= ((q: string) =>
    ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function promptNotification(over: Partial<Notification['payload']> = {}): Notification {
  return {
    id: 'n1',
    type: 'TOOL_APPROVAL',
    isRead: false,
    createdAt: new Date('2026-07-14T00:00:00Z').toISOString(),
    payload: {
      approvalId: 'apr1',
      toolName: 'wiki_delete',
      offeredScopes: ['allow_once', 'deny_once'],
      ...over,
    },
  } as Notification;
}

async function openBell(notification: Notification) {
  listMock.mockResolvedValue({ items: [notification], unreadCount: 1 });
  render(<NotificationBell />);
  await waitFor(() => expect(listMock).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
}

describe('NotificationBell — TOOL_APPROVAL branch', () => {
  it('renders one button per offered scope, never a hardcoded six', async () => {
    await openBell(promptNotification());

    expect(await screen.findByRole('button', { name: 'Allow once' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    for (const absent of [
      'Always allow',
      'Always deny',
      'Allow this session',
      'Deny this session',
    ]) {
      expect(screen.queryByRole('button', { name: absent })).not.toBeInTheDocument();
    }
  });

  it('resolves via the chat approvals endpoint with the chosen scope, then marks read', async () => {
    authFetchMock.mockResolvedValue({ success: true, data: { downgraded: false } } as never);
    await openBell(promptNotification());

    fireEvent.click(await screen.findByRole('button', { name: 'Allow once' }));

    await waitFor(() =>
      expect(authFetchMock).toHaveBeenCalledWith('/api/v1/chat/approvals/apr1/resolve', {
        method: 'POST',
        body: JSON.stringify({ choice: 'allow_once' }),
      }),
    );
    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith('n1'));
  });

  it('renders a single Revoke button for a notice (no offered scopes) and calls revoke', async () => {
    authFetchMock.mockResolvedValue({ success: true } as never);
    await openBell(promptNotification({ offeredScopes: undefined, reason: 'standing_deny' }));

    const revoke = await screen.findByRole('button', { name: 'Revoke standing deny' });
    expect(screen.queryByRole('button', { name: 'Allow once' })).not.toBeInTheDocument();

    fireEvent.click(revoke);

    await waitFor(() =>
      expect(authFetchMock).toHaveBeenCalledWith('/api/v1/chat/approvals/apr1/revoke', {
        method: 'POST',
      }),
    );
    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith('n1'));
  });
});
