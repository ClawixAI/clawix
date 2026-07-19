import { describe, it, expect } from 'vitest';
import { connectionBadge, mcpApprovalDefault, type McpServerWithConnection } from '../mcp';

describe('mcpApprovalDefault — mirrors server mcpRequiresApproval (ask-by-default)', () => {
  it('only a truthful readOnlyHint=true loosens to allow', () => {
    expect(mcpApprovalDefault({ readOnlyHint: true })).toBe('allow');
  });

  it('missing / false / malformed annotations default to ask (servers can lie or omit)', () => {
    expect(mcpApprovalDefault(null)).toBe('ask');
    expect(mcpApprovalDefault(undefined)).toBe('ask');
    expect(mcpApprovalDefault({})).toBe('ask');
    expect(mcpApprovalDefault({ readOnlyHint: false })).toBe('ask');
    expect(mcpApprovalDefault({ readOnlyHint: 'true' })).toBe('ask');
  });
});

function server(over: Partial<McpServerWithConnection> = {}): McpServerWithConnection {
  return {
    id: 'srv1',
    slug: 'github',
    name: 'GitHub',
    enabled: true,
    transportType: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    authType: 'header',
    authHeaderName: 'Authorization',
    credentialFormat: 'Bearer {token}',
    setupInstructionsMd: '',
    connection: null,
    ...over,
  };
}

describe('connectionBadge', () => {
  it('admin-disabled wins over everything', () => {
    const b = connectionBadge(
      server({
        enabled: false,
        connection: {
          id: 'c',
          mcpServerId: 'srv1',
          status: 'active',
          lastError: null,
          tiers: null,
        },
      }),
    );
    expect(b).toEqual({ kind: 'admin-disabled', label: 'Disabled by admin' });
  });

  it('no connection → not-connected', () => {
    expect(connectionBadge(server()).kind).toBe('not-connected');
  });

  it('active connection → connected', () => {
    const b = connectionBadge(
      server({
        connection: {
          id: 'c',
          mcpServerId: 'srv1',
          status: 'active',
          lastError: null,
          tiers: null,
        },
      }),
    );
    expect(b).toEqual({ kind: 'connected', label: 'Connected' });
  });

  it('user-disabled connection → disabled-by-user', () => {
    const b = connectionBadge(
      server({
        connection: {
          id: 'c',
          mcpServerId: 'srv1',
          status: 'disabled',
          lastError: null,
          tiers: null,
        },
      }),
    );
    expect(b.kind).toBe('disabled-by-user');
  });

  it('error / reauth_required → attention', () => {
    for (const status of ['error', 'reauth_required']) {
      const b = connectionBadge(
        server({
          connection: { id: 'c', mcpServerId: 'srv1', status, lastError: 'boom', tiers: null },
        }),
      );
      expect(b.kind).toBe('attention');
    }
  });
});
