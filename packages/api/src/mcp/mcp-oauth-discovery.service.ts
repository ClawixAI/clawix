/**
 * Spec-native MCP OAuth discovery (the 2025-06-18 MCP authorization spec).
 *
 * Given only a remote MCP server URL, resolve everything needed to run an
 * Authorization Code + PKCE flow against it:
 *
 *   1. RFC 9728 — Protected Resource Metadata. Probe the server unauthenticated,
 *      read the `WWW-Authenticate: Bearer resource_metadata="…"` hint (falling
 *      back to the `/.well-known/oauth-protected-resource` default), and fetch
 *      the PRM document for the canonical `resource` URI + `authorization_servers`.
 *   2. RFC 8414 — Authorization Server Metadata. Fetch the AS well-known doc for
 *      the authorize/token/registration endpoints + supported scopes/PKCE methods.
 *   3. RFC 7591 — Dynamic Client Registration. If the AS advertises a
 *      `registration_endpoint` and no client was preconfigured, register Clawix
 *      as a client. Otherwise fall back to the admin-supplied client.
 *   4. RFC 8707 — the canonical `resource` is returned so callers can attach it
 *      to authorize/token/refresh requests.
 *
 * SECURITY: every URL fetched here is influenced by remote responses (the
 * `WWW-Authenticate` header, the PRM's `authorization_servers`, the AS's
 * `registration_endpoint`), so each fetch runs the SSRF guard against
 * `MCP_INTERNAL_ALLOWLIST` AND is required to be https unless its host is
 * explicitly allowlisted (dev sidecars). DCR client secrets are returned to the
 * caller to encrypt at rest — nothing is persisted here.
 */
import { Injectable, Optional } from '@nestjs/common';
import { ValidationError, createLogger } from '@clawix/shared';

import { isHostAllowlisted, validateUrl } from '../engine/tools/web/ssrf-protection.js';

const logger = createLogger('mcp:oauth-discovery');
const ALLOWLIST_ENV = 'MCP_INTERNAL_ALLOWLIST';

/** Everything needed to drive the authorize/token flow against a discovered server. */
export interface DiscoveryResult {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: string;
  readonly clientId: string;
  readonly clientSecret: string | null;
  /** RFC 8707 canonical resource indicator (the protected resource's URI). */
  readonly resource: string;
}

export interface DiscoveryInput {
  readonly serverUrl: string;
  readonly redirectUri: string;
  /** Preconfigured client used when the AS doesn't support DCR (admin fallback). */
  readonly fallbackClientId?: string | null;
  readonly fallbackClientSecret?: string | null;
  /** Scopes used when neither PRM nor AS advertise any (admin fallback). */
  readonly fallbackScopes?: string | null;
  readonly clientName?: string;
}

interface Deps {
  fetchFn?: typeof fetch;
}

interface PrmDoc {
  readonly resource: string;
  readonly authorizationServers: readonly string[];
  readonly scopesSupported: readonly string[];
}

interface AsMetadata {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string | null;
  readonly scopesSupported: readonly string[];
  readonly codeChallengeMethodsSupported: readonly string[] | null;
}

@Injectable()
export class McpOAuthDiscoveryService {
  private readonly fetchFn: typeof fetch;

  constructor(@Optional() deps: Deps = {}) {
    this.fetchFn = deps.fetchFn ?? fetch;
  }

  /** Run the full PRM → AS-metadata → DCR pipeline for `input.serverUrl`. */
  async discover(input: DiscoveryInput): Promise<DiscoveryResult> {
    const prm = await this.discoverProtectedResource(input.serverUrl);
    const issuer = prm.authorizationServers[0];
    if (!issuer) {
      throw new ValidationError('Protected resource metadata lists no authorization_servers');
    }
    const as = await this.discoverAuthServer(issuer);

    // PKCE S256 is mandatory for the MCP spec; reject an AS that advertises its
    // methods without it (absent list = assume supported, the common case).
    if (as.codeChallengeMethodsSupported && !as.codeChallengeMethodsSupported.includes('S256')) {
      throw new ValidationError('Authorization server does not support PKCE S256');
    }

    let clientId = input.fallbackClientId ?? null;
    let clientSecret = input.fallbackClientSecret ?? null;
    if (!clientId) {
      if (!as.registrationEndpoint) {
        throw new ValidationError(
          'Authorization server has no dynamic client registration; supply a fallback client ID',
        );
      }
      const reg = await this.registerClient(as.registrationEndpoint, input);
      clientId = reg.clientId;
      clientSecret = reg.clientSecret;
    }

    const scopes =
      joinScopes(prm.scopesSupported) ||
      joinScopes(as.scopesSupported) ||
      (input.fallbackScopes ?? '');
    if (!scopes) {
      throw new ValidationError('No scopes advertised by the server; supply fallback scopes');
    }

    logger.info(
      { issuer, dcr: !input.fallbackClientId && !!as.registrationEndpoint },
      'MCP OAuth discovery complete',
    );
    return {
      authorizeUrl: as.authorizationEndpoint,
      tokenUrl: as.tokenEndpoint,
      scopes,
      clientId,
      clientSecret,
      resource: prm.resource || input.serverUrl,
    };
  }

  // ---- RFC 9728: Protected Resource Metadata ----

  private async discoverProtectedResource(serverUrl: string): Promise<PrmDoc> {
    const metadataUrl =
      (await this.probeResourceMetadataUrl(serverUrl)) ?? wellKnownPrmUrl(serverUrl);
    const json = await this.fetchJson(metadataUrl, 'protected resource metadata');
    return {
      resource: typeof json['resource'] === 'string' ? (json['resource'] as string) : '',
      authorizationServers: stringArray(json['authorization_servers']),
      scopesSupported: stringArray(json['scopes_supported']),
    };
  }

  /** Unauthenticated probe → parse `resource_metadata` out of `WWW-Authenticate`. */
  private async probeResourceMetadataUrl(serverUrl: string): Promise<string | null> {
    await this.guard(serverUrl);
    let res: Response;
    try {
      res = await this.fetchFn(serverUrl, { method: 'GET' });
    } catch {
      return null; // network error → fall back to the well-known default
    }
    const header = res.headers.get('www-authenticate');
    if (!header) return null;
    const match = /resource_metadata="?([^",\s]+)"?/i.exec(header);
    return match?.[1] ?? null;
  }

  // ---- RFC 8414: Authorization Server Metadata ----

  private async discoverAuthServer(issuer: string): Promise<AsMetadata> {
    let json: Record<string, unknown> | null = null;
    for (const candidate of wellKnownAsUrls(issuer)) {
      try {
        json = await this.fetchJson(candidate, 'authorization server metadata');
        break;
      } catch {
        // try the next well-known location
      }
    }
    if (!json) {
      throw new ValidationError('Could not fetch authorization server metadata');
    }
    const authorizationEndpoint = json['authorization_endpoint'];
    const tokenEndpoint = json['token_endpoint'];
    if (typeof authorizationEndpoint !== 'string' || typeof tokenEndpoint !== 'string') {
      throw new ValidationError('Authorization server metadata is missing required endpoints');
    }
    // SSRF-guard the endpoints we'll cache + later fetch (token) or redirect to
    // (authorize) — both come straight from a remote metadata document.
    await this.guard(authorizationEndpoint);
    await this.guard(tokenEndpoint);
    return {
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint:
        typeof json['registration_endpoint'] === 'string'
          ? (json['registration_endpoint'] as string)
          : null,
      scopesSupported: stringArray(json['scopes_supported']),
      codeChallengeMethodsSupported: Array.isArray(json['code_challenge_methods_supported'])
        ? stringArray(json['code_challenge_methods_supported'])
        : null,
    };
  }

  // ---- RFC 7591: Dynamic Client Registration ----

  private async registerClient(
    registrationEndpoint: string,
    input: DiscoveryInput,
  ): Promise<{ clientId: string; clientSecret: string | null }> {
    await this.guard(registrationEndpoint);
    const res = await this.fetchFn(registrationEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_name: input.clientName ?? 'Clawix',
        redirect_uris: [input.redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      client_id?: string;
      client_secret?: string;
      error?: string;
    };
    if (!res.ok || !json.client_id) {
      throw new ValidationError(
        `Dynamic client registration failed: ${json.error ?? `HTTP ${res.status}`}`,
      );
    }
    return { clientId: json.client_id, clientSecret: json.client_secret ?? null };
  }

  // ---- shared fetch helper (SSRF + https-guarded) ----

  private async fetchJson(url: string, what: string): Promise<Record<string, unknown>> {
    await this.guard(url);
    const res = await this.fetchFn(url, { method: 'GET', headers: { accept: 'application/json' } });
    if (!res.ok) {
      throw new ValidationError(`Failed to fetch ${what}: HTTP ${res.status}`);
    }
    return (await res.json().catch(() => {
      throw new ValidationError(`${what} is not valid JSON`);
    })) as Record<string, unknown>;
  }

  /**
   * SSRF + downgrade guard for every remotely-influenced URL we touch: resolve
   * + range-check via the shared guard, then require https unless the host is
   * internal-allowlisted (dev sidecars over http).
   */
  private async guard(url: string): Promise<void> {
    const validated = await validateUrl(url, { allowlistEnv: ALLOWLIST_ENV });
    requireHttps(validated, url);
  }
}

// ------------------------------------------------------------------ //
//  helpers (pure)                                                      //
// ------------------------------------------------------------------ //

/** RFC 9728 default PRM location at the resource's origin. */
function wellKnownPrmUrl(serverUrl: string): string {
  return `${new URL(serverUrl).origin}/.well-known/oauth-protected-resource`;
}

/**
 * RFC 8414 / OIDC well-known candidates for an issuer. RFC 8414 inserts the
 * suffix between host and path; OIDC appends it. We try the path-aware oauth
 * form, then both openid-configuration forms.
 */
function wellKnownAsUrls(issuer: string): string[] {
  const u = new URL(issuer);
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
  const origin = u.origin;
  return [
    `${origin}/.well-known/oauth-authorization-server${path}`,
    `${origin}/.well-known/openid-configuration${path}`,
    `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
  ];
}

/** Enforce https for discovered endpoints unless the host is internal-allowlisted. */
function requireHttps(
  validated: { protocol: string; hostname: string; port: number },
  url: string,
): void {
  if (
    validated.protocol !== 'https:' &&
    !isHostAllowlisted(validated.hostname, validated.port, ALLOWLIST_ENV)
  ) {
    throw new ValidationError(`Insecure OAuth discovery endpoint (https required): ${url}`);
  }
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function joinScopes(scopes: readonly string[]): string {
  return scopes.join(' ');
}
