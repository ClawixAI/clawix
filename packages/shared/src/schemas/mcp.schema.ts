import { z } from 'zod';

/** Transports supported in v1. */
export const mcpTransportSchema = z.enum(['http', 'sse']);

/** Auth types accepted by the API. */
export const mcpAuthTypeSchema = z.enum(['none', 'header', 'oauth']);

/** POST /admin/mcp/servers body — metadata only, no discovery. */
export const importMcpServerSchema = z
  .object({
    name: z.string().min(1).max(100),
    url: z.string().url().max(2000),
    transportType: mcpTransportSchema.default('http'),
    authType: mcpAuthTypeSchema.default('none'),
    authHeaderName: z.string().min(1).max(100).optional(),
    credentialFormat: z.string().max(200).optional(),
    setupInstructionsMd: z.string().max(10_000).optional(),
    // OAuth config (only when authType === 'oauth')
    oauthAuthorizeUrl: z.string().url().max(2000).optional(),
    oauthTokenUrl: z.string().url().max(2000).optional(),
    oauthScopes: z.string().max(2000).optional(),
    oauthClientId: z.string().max(500).optional(),
    oauthClientSecret: z.string().max(2000).optional(),
    // Spec-native discovery (RFC 9728/8414/7591): when true, the authorize/token
    // URLs + scopes are discovered from the server at connect time, so the admin
    // need only supply the server URL (client ID/secret act as a fallback for
    // authorization servers that don't support dynamic client registration).
    oauthAutoDiscover: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.authType !== 'oauth' ||
      v.oauthAutoDiscover === true ||
      (!!v.oauthAuthorizeUrl && !!v.oauthTokenUrl && !!v.oauthScopes && !!v.oauthClientId),
    {
      message:
        'oauth servers require oauthAuthorizeUrl, oauthTokenUrl, oauthScopes, oauthClientId (or enable auto-discover)',
    },
  );

/** PATCH /admin/mcp/servers/:id body. */
export const updateMcpServerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  url: z.string().url().max(2000).optional(),
  authHeaderName: z.string().min(1).max(100).optional(),
  credentialFormat: z.string().max(200).optional(),
  setupInstructionsMd: z.string().max(10_000).optional(),
  // OAuth config — editable post-import (e.g. the provider rotates its
  // endpoints, or scopes need adjusting). Secret only updated when provided.
  oauthAuthorizeUrl: z.string().url().max(2000).optional(),
  oauthTokenUrl: z.string().url().max(2000).optional(),
  oauthScopes: z.string().max(2000).optional(),
  oauthClientId: z.string().max(500).optional(),
  oauthClientSecret: z.string().max(2000).optional(),
  oauthAutoDiscover: z.boolean().optional(),
});

/** POST /mcp/servers/:id/connect body (user). */
export const connectMcpSchema = z.object({
  credential: z.string().min(1).max(4000).optional(),
});

/** PATCH /mcp/connections/:id body. Only user-reversible statuses. */
export const updateMcpConnectionSchema = z.object({
  credential: z.string().min(1).max(4000).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

/**
 * Shape of `AgentDefinition.toolConfig.mcp`. Stored bindings are ALWAYS
 * explicit tool lists (TOFU) — wildcards are rejected at the schema level.
 */
export const mcpBindingsSchema = z.object({
  servers: z
    .array(
      z.object({
        serverId: z.string().min(1),
        enabledTools: z.array(z.string().min(1)),
      }),
    )
    .default([]),
});

const toolNameArray = z.array(z.string().min(1)).default([]);

/** PUT /mcp/connections/:id/tiers body. */
export const setMcpTiersSchema = z.object({
  tiers: z.object({
    recommended: toolNameArray,
    optional: toolNameArray,
    off: toolNameArray,
  }),
});

/** Tool-tier classification for an MCP connection. */
export interface McpToolTiers {
  readonly recommended: string[];
  readonly optional: string[];
  readonly off: string[];
}

export type ImportMcpServerInput = z.infer<typeof importMcpServerSchema>;
export type UpdateMcpServerInput = z.infer<typeof updateMcpServerSchema>;
export type ConnectMcpInput = z.infer<typeof connectMcpSchema>;
export type UpdateMcpConnectionInput = z.infer<typeof updateMcpConnectionSchema>;
export type McpBindings = z.infer<typeof mcpBindingsSchema>;
export type SetMcpTiersInput = z.infer<typeof setMcpTiersSchema>;
