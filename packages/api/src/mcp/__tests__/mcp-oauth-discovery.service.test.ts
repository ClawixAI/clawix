import { describe, it, expect, vi, beforeEach } from 'vitest';

// Discovery SSRF-guards + https-checks every URL it fetches; stub the guard so
// unit tests do no real DNS. `isHostAllowlisted` defaults to false (no env).
vi.mock('../../engine/tools/web/ssrf-protection.js', () => ({
  validateUrl: vi.fn(async (url: string) => ({
    hostname: new URL(url).hostname,
    resolvedIp: '203.0.113.1',
    port: new URL(url).port ? Number(new URL(url).port) : 443,
    pathname: new URL(url).pathname,
    protocol: new URL(url).protocol,
  })),
  isHostAllowlisted: vi.fn(() => false),
}));

import { McpOAuthDiscoveryService } from '../mcp-oauth-discovery.service.js';

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get: (k: string) => string | null };
  json: () => Promise<unknown>;
}

function resp(opts: {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}): FakeResponse {
  const status = opts.status ?? 200;
  const headers = opts.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => opts.body ?? {},
  };
}

const SERVER_URL = 'https://mcp.example.com/mcp/';
const PRM_URL = 'https://mcp.example.com/.well-known/oauth-protected-resource';
const AS_URL = 'https://auth.example.com/.well-known/oauth-authorization-server';
const REG_URL = 'https://auth.example.com/register';

const PRM_BODY = {
  resource: 'https://mcp.example.com/mcp',
  authorization_servers: ['https://auth.example.com'],
  scopes_supported: ['read', 'write'],
};
const AS_BODY = {
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  registration_endpoint: REG_URL,
  code_challenge_methods_supported: ['S256'],
  scopes_supported: ['read', 'write', 'admin'],
};

/** Build a fetch mock from a per-URL routing table; POSTs key on `POST <url>`. */
function routedFetch(routes: Record<string, FakeResponse | (() => FakeResponse)>) {
  return vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    const key = method === 'POST' ? `POST ${url}` : url;
    const route = routes[key];
    if (!route) throw new Error(`unexpected fetch: ${method} ${url}`);
    return typeof route === 'function' ? route() : route;
  });
}

describe('McpOAuthDiscoveryService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('full pipeline: PRM (via WWW-Authenticate) → AS metadata → DCR', async () => {
    const fetchFn = routedFetch({
      [SERVER_URL]: resp({
        status: 401,
        headers: { 'www-authenticate': `Bearer resource_metadata="${PRM_URL}"` },
      }),
      [PRM_URL]: resp({ body: PRM_BODY }),
      [AS_URL]: resp({ body: AS_BODY }),
      [`POST ${REG_URL}`]: resp({
        status: 201,
        body: { client_id: 'dcr-client', client_secret: 'dcr-secret' },
      }),
    });
    const svc = new McpOAuthDiscoveryService({ fetchFn: fetchFn as never });
    const r = await svc.discover({
      serverUrl: SERVER_URL,
      redirectUri: 'https://clawix.test/mcp/oauth/callback',
    });
    expect(r).toEqual({
      authorizeUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: 'read write',
      clientId: 'dcr-client',
      clientSecret: 'dcr-secret',
      resource: 'https://mcp.example.com/mcp',
    });
  });

  it('falls back to the well-known PRM path when no WWW-Authenticate header', async () => {
    const fetchFn = routedFetch({
      [SERVER_URL]: resp({ status: 200, headers: {} }),
      [PRM_URL]: resp({ body: PRM_BODY }),
      [AS_URL]: resp({ body: { ...AS_BODY, registration_endpoint: undefined } }),
      [`POST ${REG_URL}`]: resp({ body: {} }),
    });
    const svc = new McpOAuthDiscoveryService({ fetchFn: fetchFn as never });
    const r = await svc.discover({
      serverUrl: SERVER_URL,
      redirectUri: 'https://clawix.test/cb',
      fallbackClientId: 'admin-client',
    });
    expect(r.clientId).toBe('admin-client');
    // No DCR call when a fallback client is configured.
    expect(fetchFn).not.toHaveBeenCalledWith(REG_URL, expect.anything());
  });

  it('uses the configured fallback client when the AS has no registration endpoint', async () => {
    const fetchFn = routedFetch({
      [SERVER_URL]: resp({ status: 200 }),
      [PRM_URL]: resp({ body: PRM_BODY }),
      [AS_URL]: resp({ body: { ...AS_BODY, registration_endpoint: undefined } }),
    });
    const svc = new McpOAuthDiscoveryService({ fetchFn: fetchFn as never });
    const r = await svc.discover({
      serverUrl: SERVER_URL,
      redirectUri: 'https://clawix.test/cb',
      fallbackClientId: 'admin-client',
      fallbackClientSecret: 'admin-secret',
    });
    expect(r.clientId).toBe('admin-client');
    expect(r.clientSecret).toBe('admin-secret');
  });

  it('throws when there is no client and no DCR support', async () => {
    const fetchFn = routedFetch({
      [SERVER_URL]: resp({ status: 200 }),
      [PRM_URL]: resp({ body: PRM_BODY }),
      [AS_URL]: resp({ body: { ...AS_BODY, registration_endpoint: undefined } }),
    });
    const svc = new McpOAuthDiscoveryService({ fetchFn: fetchFn as never });
    await expect(
      svc.discover({ serverUrl: SERVER_URL, redirectUri: 'https://clawix.test/cb' }),
    ).rejects.toThrow(/dynamic client registration/i);
  });

  it('rejects an AS that advertises PKCE methods without S256', async () => {
    const fetchFn = routedFetch({
      [SERVER_URL]: resp({ status: 200 }),
      [PRM_URL]: resp({ body: PRM_BODY }),
      [AS_URL]: resp({ body: { ...AS_BODY, code_challenge_methods_supported: ['plain'] } }),
    });
    const svc = new McpOAuthDiscoveryService({ fetchFn: fetchFn as never });
    await expect(
      svc.discover({ serverUrl: SERVER_URL, redirectUri: 'https://clawix.test/cb' }),
    ).rejects.toThrow(/S256/);
  });

  it('rejects an http (non-allowlisted) discovered endpoint — no downgrade', async () => {
    const fetchFn = routedFetch({
      [SERVER_URL]: resp({ status: 200 }),
      [PRM_URL]: resp({ body: PRM_BODY }),
      [AS_URL]: resp({
        body: { ...AS_BODY, token_endpoint: 'http://auth.example.com/token' },
      }),
    });
    const svc = new McpOAuthDiscoveryService({ fetchFn: fetchFn as never });
    await expect(
      svc.discover({ serverUrl: SERVER_URL, redirectUri: 'https://clawix.test/cb' }),
    ).rejects.toThrow(/https required/i);
  });

  it('throws when PRM lists no authorization servers', async () => {
    const fetchFn = routedFetch({
      [SERVER_URL]: resp({ status: 200 }),
      [PRM_URL]: resp({ body: { resource: 'x', authorization_servers: [] } }),
    });
    const svc = new McpOAuthDiscoveryService({ fetchFn: fetchFn as never });
    await expect(
      svc.discover({ serverUrl: SERVER_URL, redirectUri: 'https://clawix.test/cb' }),
    ).rejects.toThrow(/authorization_servers/);
  });
});
