import { describe, it, expect } from 'vitest';
import {
  importMcpServerSchema,
  updateMcpServerSchema,
  connectMcpSchema,
  updateMcpConnectionSchema,
  mcpBindingsSchema,
  setMcpTiersSchema,
} from '../mcp.schema.js';
import { updateAgentDefinitionSchema } from '../agent.schema.js';

describe('importMcpServerSchema (admin, metadata-only)', () => {
  it('accepts header auth WITHOUT a discovery credential', () => {
    const r = importMcpServerSchema.safeParse({
      name: 'GitHub',
      url: 'https://api.githubcopilot.com/mcp/',
      authType: 'header',
      authHeaderName: 'Authorization',
      credentialFormat: 'Bearer {token}',
    });
    expect(r.success).toBe(true);
  });

  it('rejects oauth authType without required oauth config', () => {
    const r = importMcpServerSchema.safeParse({
      name: 'Drive',
      url: 'https://example.com/mcp',
      authType: 'oauth',
    });
    expect(r.success).toBe(false);
  });

  it('defaults transportType to http and authType to none', () => {
    const r = importMcpServerSchema.parse({ name: 'Open', url: 'https://example.com/mcp' });
    expect(r.transportType).toBe('http');
    expect(r.authType).toBe('none');
  });

  it('does not carry a discoveryCredential field through', () => {
    // `discoveryCredential` was removed from the schema; a stray field on the
    // input is stripped by zod and must not appear on the parsed output.
    const input: Record<string, unknown> = {
      name: 'X',
      url: 'https://x.example/mcp',
      authType: 'header',
      authHeaderName: 'Authorization',
      discoveryCredential: 'Bearer x',
    };
    const r = importMcpServerSchema.parse(input);
    expect((r as Record<string, unknown>)['discoveryCredential']).toBeUndefined();
  });
});

describe('importMcpServerSchema oauth', () => {
  it('accepts authType oauth with oauth config', () => {
    const r = importMcpServerSchema.parse({
      name: 'Google Workspace',
      url: 'http://clawix-gworkspace:8000/mcp/',
      authType: 'oauth',
      oauthAuthorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      oauthTokenUrl: 'https://oauth2.googleapis.com/token',
      oauthScopes: 'openid email https://www.googleapis.com/auth/gmail.send',
      oauthClientId: 'abc.apps.googleusercontent.com',
      oauthClientSecret: 'secret',
    });
    expect(r.authType).toBe('oauth');
    expect(r.oauthTokenUrl).toContain('googleapis');
  });

  it('rejects oauth import missing authorize/token URLs', () => {
    const r = importMcpServerSchema.safeParse({
      name: 'X',
      url: 'https://x.test/mcp',
      authType: 'oauth',
      oauthClientId: 'id',
    });
    expect(r.success).toBe(false);
  });
});

describe('updateMcpServerSchema (admin)', () => {
  it('accepts enabled toggle and instruction edits', () => {
    expect(updateMcpServerSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(updateMcpServerSchema.safeParse({ setupInstructionsMd: 'x' }).success).toBe(true);
  });
});

describe('connectMcpSchema (user)', () => {
  it('accepts an optional credential', () => {
    expect(connectMcpSchema.safeParse({ credential: 'Bearer tok' }).success).toBe(true);
    expect(connectMcpSchema.safeParse({}).success).toBe(true);
  });
});

describe('updateMcpConnectionSchema (user)', () => {
  it('only allows user-settable statuses', () => {
    expect(updateMcpConnectionSchema.safeParse({ status: 'reauth_required' }).success).toBe(false);
    expect(updateMcpConnectionSchema.safeParse({ status: 'disabled' }).success).toBe(true);
    expect(updateMcpConnectionSchema.safeParse({ status: 'active' }).success).toBe(true);
  });
});

describe('setMcpTiersSchema', () => {
  it('accepts a well-formed tiers object', () => {
    const r = setMcpTiersSchema.safeParse({
      tiers: { recommended: ['a'], optional: ['b'], off: ['c'] },
    });
    expect(r.success).toBe(true);
  });
  it('defaults missing arrays to empty', () => {
    const r = setMcpTiersSchema.parse({ tiers: { recommended: ['a'] } });
    expect(r.tiers).toEqual({ recommended: ['a'], optional: [], off: [] });
  });
  it('rejects empty tool names', () => {
    expect(
      setMcpTiersSchema.safeParse({ tiers: { recommended: [''], optional: [], off: [] } }).success,
    ).toBe(false);
  });
});

describe('mcpBindingsSchema', () => {
  it('parses bindings out of a toolConfig-shaped object', () => {
    const r = mcpBindingsSchema.parse({
      servers: [{ serverId: 'srv1', enabledTools: ['search'] }],
    });
    expect(r.servers[0]?.enabledTools).toEqual(['search']);
  });

  it('defaults to empty servers', () => {
    expect(mcpBindingsSchema.parse({}).servers).toEqual([]);
  });

  it('rejects wildcard strings (TOFU: explicit lists only)', () => {
    const r = mcpBindingsSchema.safeParse({ servers: [{ serverId: 's', enabledTools: '*' }] });
    expect(r.success).toBe(false);
  });
});

describe('updateAgentDefinitionSchema — toolConfig', () => {
  it('accepts toolConfig with a valid mcp block', () => {
    const r = updateAgentDefinitionSchema.safeParse({
      toolConfig: {
        mcp: {
          servers: [{ serverId: 's', enabledTools: ['tool_a'] }],
        },
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.toolConfig?.mcp?.servers[0]?.enabledTools).toEqual(['tool_a']);
    }
  });

  it('rejects wildcard enabledTools inside toolConfig.mcp (TOFU)', () => {
    const r = updateAgentDefinitionSchema.safeParse({
      toolConfig: {
        mcp: {
          servers: [{ serverId: 's', enabledTools: '*' }],
        },
      },
    });
    expect(r.success).toBe(false);
  });

  it('accepts toolConfig with unrelated keys (passthrough)', () => {
    const r = updateAgentDefinitionSchema.safeParse({
      toolConfig: {
        browser: { enabled: true },
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data.toolConfig as Record<string, unknown>)?.['browser']).toEqual({
        enabled: true,
      });
    }
  });

  it('accepts toolConfig omitting the mcp key entirely', () => {
    const r = updateAgentDefinitionSchema.safeParse({
      toolConfig: {},
    });
    expect(r.success).toBe(true);
  });

  it('preserves the mcp shape after parse', () => {
    const input = {
      toolConfig: {
        mcp: { servers: [{ serverId: 'srv-x', enabledTools: ['read', 'write'] }] },
      },
    };
    const parsed = updateAgentDefinitionSchema.parse(input);
    expect(parsed.toolConfig?.mcp?.servers).toEqual([
      { serverId: 'srv-x', enabledTools: ['read', 'write'] },
    ]);
  });
});
