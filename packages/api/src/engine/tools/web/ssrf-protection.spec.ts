// packages/api/src/engine/tools/web/ssrf-protection.spec.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { validateUrl } from './ssrf-protection.js';

// ---------------------------------------------------------------------------
// DNS mock — prevents real network calls in tests.
// All hostnames resolve to a public IP by default so the private-IP check
// doesn't fire (unless overridden per test).
// ---------------------------------------------------------------------------
vi.mock('dns', () => ({
  promises: {
    lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
  },
}));

describe('validateUrl — scheme denylist', () => {
  for (const scheme of ['file', 'chrome', 'chrome-extension', 'javascript', 'data']) {
    it(`rejects ${scheme}: URLs`, async () => {
      await expect(validateUrl(`${scheme}:something`)).rejects.toThrow(/scheme/i);
    });
  }

  it('rejects about: URLs except about:blank', async () => {
    await expect(validateUrl('about:config')).rejects.toThrow(/scheme/i);
  });

  it('allows about:blank', async () => {
    const result = await validateUrl('about:blank');
    expect(result).toBeDefined();
  });
});

describe('validateUrl — internal allowlist', () => {
  const ORIGINAL = process.env['BROWSER_INTERNAL_ALLOWLIST'];

  beforeEach(() => {
    process.env['BROWSER_INTERNAL_ALLOWLIST'] = 'admin.internal,grafana.internal:3000';
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env['BROWSER_INTERNAL_ALLOWLIST'];
    else process.env['BROWSER_INTERNAL_ALLOWLIST'] = ORIGINAL;
  });

  it('allows hosts on the allowlist even if they resolve to private IPs', async () => {
    // Override DNS to return a private IP for admin.internal.
    const dns = await import('dns');
    vi.mocked(dns.promises.lookup).mockResolvedValueOnce({ address: '10.0.0.5', family: 4 });

    const result = await validateUrl('http://admin.internal/');
    expect(result).toBeDefined();
  });

  it('respects port-specific allowlist entries', async () => {
    // Override DNS to return a private IP for grafana.internal.
    const dns = await import('dns');
    vi.mocked(dns.promises.lookup).mockResolvedValueOnce({ address: '192.168.1.100', family: 4 });

    const result = await validateUrl('http://grafana.internal:3000/dashboards');
    expect(result).toBeDefined();
  });

  it('rejects allowlist host on a non-allowed port', async () => {
    // Override DNS to return a private IP — should still be blocked because port 8080 is not in the allowlist.
    const dns = await import('dns');
    vi.mocked(dns.promises.lookup).mockResolvedValueOnce({ address: '192.168.1.100', family: 4 });

    await expect(validateUrl('http://grafana.internal:8080/')).rejects.toThrow(
      /private|allowlist|blocked/i,
    );
  });
});

describe('validateUrl allowlistEnv option', () => {
  afterEach(() => {
    delete process.env['MCP_INTERNAL_ALLOWLIST'];
    delete process.env['BROWSER_INTERNAL_ALLOWLIST'];
  });

  it('allows a private host listed in MCP_INTERNAL_ALLOWLIST', async () => {
    process.env['MCP_INTERNAL_ALLOWLIST'] = 'localhost:3141';
    // Override DNS to return loopback for localhost.
    const dns = await import('dns');
    vi.mocked(dns.promises.lookup).mockResolvedValueOnce({ address: '127.0.0.1', family: 4 });

    const result = await validateUrl('http://localhost:3141/mcp', {
      allowlistEnv: 'MCP_INTERNAL_ALLOWLIST',
    });
    expect(result.hostname).toBe('localhost');
  });

  it('still blocks private hosts not in the MCP allowlist', async () => {
    process.env['MCP_INTERNAL_ALLOWLIST'] = 'other.internal';
    // Override DNS to return loopback for localhost.
    const dns = await import('dns');
    vi.mocked(dns.promises.lookup).mockResolvedValueOnce({ address: '127.0.0.1', family: 4 });

    await expect(
      validateUrl('http://localhost:3141/mcp', { allowlistEnv: 'MCP_INTERNAL_ALLOWLIST' }),
    ).rejects.toThrow();
  });

  it('does not consult BROWSER_INTERNAL_ALLOWLIST when allowlistEnv is MCP', async () => {
    process.env['BROWSER_INTERNAL_ALLOWLIST'] = 'localhost:3141';
    // Override DNS to return loopback for localhost.
    const dns = await import('dns');
    vi.mocked(dns.promises.lookup).mockResolvedValueOnce({ address: '127.0.0.1', family: 4 });

    await expect(
      validateUrl('http://localhost:3141/mcp', { allowlistEnv: 'MCP_INTERNAL_ALLOWLIST' }),
    ).rejects.toThrow();
    // BROWSER_INTERNAL_ALLOWLIST cleanup is handled by afterEach
  });
});
