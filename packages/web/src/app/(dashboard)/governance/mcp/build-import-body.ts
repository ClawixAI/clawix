import type { ImportMcpServerBody } from '@/lib/mcp';

type Result = { ok: true; body: ImportMcpServerBody } | { ok: false; error: string };

function opt(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/** Build + client-side-validate the import payload (mirrors the API's zod refine). */
export function buildImportBody(form: FormData): Result {
  const name = String(form.get('name') ?? '').trim();
  const url = String(form.get('url') ?? '').trim();
  const transportType = form.get('transportType') === 'sse' ? 'sse' : 'http';
  const rawAuthType = form.get('authType');
  const authType: 'none' | 'header' | 'oauth' =
    rawAuthType === 'header' ? 'header' : rawAuthType === 'oauth' ? 'oauth' : 'none';
  const authHeaderName = opt(form, 'authHeaderName');

  if (!name || !url) return { ok: false, error: 'Name and URL are required' };
  if (authType === 'header' && !authHeaderName) {
    return { ok: false, error: 'Header auth requires a header name' };
  }
  if (authType === 'oauth') {
    const oauthAutoDiscover = form.get('oauthAutoDiscover') === 'true';
    const oauthAuthorizeUrl = opt(form, 'oauthAuthorizeUrl');
    const oauthTokenUrl = opt(form, 'oauthTokenUrl');
    const oauthScopes = opt(form, 'oauthScopes');
    const oauthClientId = opt(form, 'oauthClientId');
    // Auto-discover only needs the server URL; the authorize/token/scopes are
    // resolved from the server at connect time (client ID is an optional fallback).
    if (
      !oauthAutoDiscover &&
      (!oauthAuthorizeUrl || !oauthTokenUrl || !oauthScopes || !oauthClientId)
    ) {
      return {
        ok: false,
        error: 'OAuth servers require Authorize URL, Token URL, Scopes, and Client ID',
      };
    }
    return {
      ok: true,
      body: {
        name,
        url,
        transportType,
        authType,
        oauthAutoDiscover,
        oauthAuthorizeUrl,
        oauthTokenUrl,
        oauthScopes,
        oauthClientId,
        oauthClientSecret: opt(form, 'oauthClientSecret'),
        credentialFormat: opt(form, 'credentialFormat'),
        setupInstructionsMd: opt(form, 'setupInstructionsMd'),
      },
    };
  }

  return {
    ok: true,
    body: {
      name,
      url,
      transportType,
      authType,
      authHeaderName,
      credentialFormat: opt(form, 'credentialFormat'),
      setupInstructionsMd: opt(form, 'setupInstructionsMd'),
    },
  };
}
