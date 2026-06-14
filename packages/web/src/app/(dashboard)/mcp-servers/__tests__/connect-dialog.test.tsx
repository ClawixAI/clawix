import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConnectDialog } from '../connect-dialog';
import {
  connectMcpServer,
  updateMcpConnection,
  autoSortConnectionTiers,
  startMcpOAuth,
  type McpServerWithConnection,
} from '@/lib/mcp';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/lib/mcp', () => ({
  connectMcpServer: vi.fn(),
  updateMcpConnection: vi.fn(),
  autoSortConnectionTiers: vi.fn(),
  startMcpOAuth: vi.fn(),
}));

const mockConnect = vi.mocked(connectMcpServer);
const mockUpdate = vi.mocked(updateMcpConnection);
const mockAutoSort = vi.mocked(autoSortConnectionTiers);
const mockStartOAuth = vi.mocked(startMcpOAuth);

function srv(over: Partial<McpServerWithConnection> = {}): McpServerWithConnection {
  return {
    id: 'srv1',
    name: 'GitHub',
    authType: 'none',
    connection: null,
    ...over,
  } as unknown as McpServerWithConnection;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConnectDialog — connect mode', () => {
  it('auto-sorts after a successful connect and shows the tier summary', async () => {
    mockConnect.mockResolvedValue({ id: 'conn1' } as never);
    mockAutoSort.mockResolvedValue({
      recommended: ['a', 'b'],
      optional: ['c'],
      off: ['d', 'e', 'f'],
    } as never);
    const onDone = vi.fn().mockResolvedValue(undefined);

    render(
      <ConnectDialog
        server={srv()}
        mode="connect"
        open={true}
        onOpenChange={vi.fn()}
        onDone={onDone}
      />,
    );

    await userEvent.click(screen.getByText('Verify & Save'));

    await waitFor(() => expect(mockAutoSort).toHaveBeenCalledWith('conn1'));
    expect(mockConnect).toHaveBeenCalledWith('srv1', undefined);
    expect(await screen.findByText('2 recommended')).toBeInTheDocument();
    expect(screen.getByText('1 optional')).toBeInTheDocument();
    expect(screen.getByText('3 off')).toBeInTheDocument();
    expect(screen.getByText('Review tiers')).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });

  it('shows a fallback when auto-sort fails, without rolling back the connection', async () => {
    mockConnect.mockResolvedValue({ id: 'conn1' } as never);
    mockAutoSort.mockRejectedValue(new Error('provider down'));
    const onDone = vi.fn().mockResolvedValue(undefined);

    render(
      <ConnectDialog
        server={srv()}
        mode="connect"
        open={true}
        onOpenChange={vi.fn()}
        onDone={onDone}
      />,
    );

    await userEvent.click(screen.getByText('Verify & Save'));

    expect(await screen.findByText(/Auto-sort didn't finish/)).toBeInTheDocument();
    expect(screen.queryByText(/recommended/)).not.toBeInTheDocument();
    expect(onDone).toHaveBeenCalled(); // connect succeeded
  });

  it('navigates to the Tiers tab when Review tiers is clicked', async () => {
    mockConnect.mockResolvedValue({ id: 'conn1' } as never);
    mockAutoSort.mockResolvedValue({ recommended: ['a'], optional: [], off: [] } as never);
    const onOpenChange = vi.fn();

    render(
      <ConnectDialog
        server={srv()}
        mode="connect"
        open={true}
        onOpenChange={onOpenChange}
        onDone={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await userEvent.click(screen.getByText('Verify & Save'));
    await userEvent.click(await screen.findByText('Review tiers'));

    expect(push).toHaveBeenCalledWith('/mcp-servers/srv1?tab=tiers');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ConnectDialog — oauth mode', () => {
  it('oauth servers redirect to the provider authorize URL instead of asking for a credential', async () => {
    mockStartOAuth.mockResolvedValue('https://accounts.google.com/o/oauth2/v2/auth?x=1');
    const assign = vi.fn();
    // stub window.location.assign
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });
    render(
      <ConnectDialog
        server={srv({ authType: 'oauth' })}
        mode="connect"
        open={true}
        onOpenChange={vi.fn()}
        onDone={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await userEvent.click(screen.getByText(/Connect with/i));
    expect(mockStartOAuth).toHaveBeenCalledWith('srv1');
    expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1');
  });
});

describe('ConnectDialog — update mode', () => {
  it('replaces the token without auto-sorting', async () => {
    mockUpdate.mockResolvedValue({ id: 'conn1' } as never);
    const onDone = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <ConnectDialog
        server={srv({ authType: 'header', connection: { id: 'conn1' } as never })}
        mode="update"
        open={true}
        onOpenChange={onOpenChange}
        onDone={onDone}
      />,
    );

    await userEvent.type(screen.getByLabelText('Credential'), 'ghp_newtoken');
    await userEvent.click(screen.getByText('Verify & Save'));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('conn1', { credential: 'ghp_newtoken' }),
    );
    expect(mockAutoSort).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDone).toHaveBeenCalled();
  });
});
