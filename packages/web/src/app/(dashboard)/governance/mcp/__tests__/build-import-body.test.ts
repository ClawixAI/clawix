import { describe, it, expect } from 'vitest';
import { buildImportBody } from '../build-import-body';

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.append(key, value);
  return form;
}

describe('buildImportBody', () => {
  it('builds a header-auth import body with no discovery credential', () => {
    const r = buildImportBody(
      fd({
        name: 'GitHub',
        url: 'https://api.githubcopilot.com/mcp/',
        transportType: 'http',
        authType: 'header',
        authHeaderName: 'Authorization',
        credentialFormat: 'Bearer {token}',
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).toEqual({
        name: 'GitHub',
        url: 'https://api.githubcopilot.com/mcp/',
        transportType: 'http',
        authType: 'header',
        authHeaderName: 'Authorization',
        credentialFormat: 'Bearer {token}',
        setupInstructionsMd: undefined,
      });
    }
  });

  it('omits blank optional fields for authType none', () => {
    const r = buildImportBody(
      fd({ name: 'Open', url: 'https://x.example/mcp', transportType: 'http', authType: 'none' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.authHeaderName).toBeUndefined();
    }
  });

  it('requires header name for header auth', () => {
    const r = buildImportBody(
      fd({ name: 'X', url: 'https://x.example/mcp', transportType: 'http', authType: 'header' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/header name/i);
  });

  it('requires authorize/token/scopes/client for non-auto-discover oauth', () => {
    const r = buildImportBody(
      fd({ name: 'GW', url: 'https://gw.example/mcp', transportType: 'http', authType: 'oauth' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Authorize URL/i);
  });

  it('auto-discover oauth needs only the server URL', () => {
    const r = buildImportBody(
      fd({
        name: 'Spec MCP',
        url: 'https://spec.example/mcp',
        transportType: 'http',
        authType: 'oauth',
        oauthAutoDiscover: 'true',
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.authType).toBe('oauth');
      expect(r.body.oauthAutoDiscover).toBe(true);
      expect(r.body.oauthAuthorizeUrl).toBeUndefined();
      expect(r.body.oauthClientId).toBeUndefined();
    }
  });
});
