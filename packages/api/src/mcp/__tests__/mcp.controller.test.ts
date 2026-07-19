import { describe, it, expect, vi, beforeEach } from 'vitest';

import { McpController } from '../mcp.controller.js';

function makeSvc() {
  return {
    startOAuth: vi.fn(),
    handleOAuthCallback: vi.fn(),
    setApprovalOverrides: vi.fn(),
  };
}

describe('McpController OAuth routes', () => {
  let svc: ReturnType<typeof makeSvc>;
  let controller: McpController;
  beforeEach(() => {
    svc = makeSvc();
    controller = new McpController(svc as never);
  });

  it('POST servers/:id/oauth/start returns the authorize url', async () => {
    svc.startOAuth.mockResolvedValue('https://accounts.google.com/...');
    const r = await controller.oauthStart({ user: { sub: 'user-1' } } as never, 'srv1');
    expect(svc.startOAuth).toHaveBeenCalledWith('user-1', 'srv1');
    expect(r).toEqual({ authorizeUrl: 'https://accounts.google.com/...' });
  });

  it('GET oauth/callback redirects (302) to the server detail page', async () => {
    svc.handleOAuthCallback.mockResolvedValue({ serverId: 'srv1' });
    const r = await controller.oauthCallback('state', 'code');
    expect(svc.handleOAuthCallback).toHaveBeenCalledWith('state', 'code');
    expect(r.statusCode).toBe(302);
    expect(r.url).toContain('/mcp-servers/srv1');
    expect(r.url).toContain('oauth=success');
  });

  it('GET oauth/callback redirects (302) to an error page when the exchange fails', async () => {
    svc.handleOAuthCallback.mockRejectedValue(new Error('boom'));
    const r = await controller.oauthCallback('state', 'code');
    expect(r.statusCode).toBe(302);
    expect(r.url).toContain('oauth=error');
  });

  it('PUT connections/:id/approval-overrides threads through to the service', async () => {
    svc.setApprovalOverrides.mockResolvedValue({ search: 'allow' });
    const r = await controller.setApprovalOverrides({ user: { sub: 'user-1' } } as never, 'conn1', {
      search: 'allow',
    });
    expect(svc.setApprovalOverrides).toHaveBeenCalledWith('user-1', 'conn1', { search: 'allow' });
    expect(r).toEqual({ search: 'allow' });
  });
});
