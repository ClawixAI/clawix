import { authFetch } from '@/lib/auth';

// ------------------------------------------------------------------ //
//  DTO types (mirror packages/api/src/mcp DTOs)                       //
// ------------------------------------------------------------------ //

export interface McpConnectionDto {
  id: string;
  mcpServerId: string;
  status: string; // active | disabled | error | reauth_required
  lastError: string | null;
  tiers: McpToolTiers | null;
}

export interface McpServerDto {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  transportType: string;
  url: string;
  authType: 'none' | 'header' | 'oauth';
  authHeaderName: string | null;
  credentialFormat: string | null;
  setupInstructionsMd: string;
  // OAuth config fields (only present when authType === 'oauth')
  oauthAuthorizeUrl?: string | null;
  oauthTokenUrl?: string | null;
  oauthScopes?: string | null;
  oauthClientId?: string | null;
  oauthAutoDiscover?: boolean;
}

export interface McpServerWithConnection extends McpServerDto {
  connection: McpConnectionDto | null;
}

export interface AdminMcpServerDto extends McpServerDto {
  connectionCount: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpToolDto {
  id: string;
  mcpConnectionId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scanFlagged: boolean;
  scanReason: string | null;
  createdAt: string;
}

export interface McpCallRow {
  id: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string;
  details: {
    serverId?: string;
    toolName?: string;
    agentRunId?: string;
    isError?: boolean;
    durationMs?: number;
  };
  createdAt: string;
}

export interface McpCallsPage {
  items: McpCallRow[];
  nextCursor: string | null;
}

// ------------------------------------------------------------------ //
//  Badge derivation (pure — unit tested)                              //
// ------------------------------------------------------------------ //

export type BadgeKind =
  | 'connected'
  | 'not-connected'
  | 'disabled-by-user'
  | 'attention'
  | 'admin-disabled';

export interface ConnectionBadge {
  kind: BadgeKind;
  label: string;
}

/** Derive the catalog-card status badge. Admin kill switch wins over all. */
export function connectionBadge(server: McpServerWithConnection): ConnectionBadge {
  if (!server.enabled) return { kind: 'admin-disabled', label: 'Disabled by admin' };
  const status = server.connection?.status;
  if (!status) return { kind: 'not-connected', label: 'Not connected' };
  if (status === 'active') return { kind: 'connected', label: 'Connected' };
  if (status === 'disabled') return { kind: 'disabled-by-user', label: 'Disabled (you)' };
  return { kind: 'attention', label: 'Needs attention' };
}

// ------------------------------------------------------------------ //
//  REST wrappers — NOTE: /mcp and /admin/mcp are UNVERSIONED routes   //
// ------------------------------------------------------------------ //

export function listMcpServers(): Promise<McpServerWithConnection[]> {
  return authFetch<McpServerWithConnection[]>('/mcp/servers');
}

export function connectMcpServer(serverId: string, credential?: string): Promise<McpConnectionDto> {
  return authFetch<McpConnectionDto>(`/mcp/servers/${serverId}/connect`, {
    method: 'POST',
    body: JSON.stringify(credential ? { credential } : {}),
  });
}

export function updateMcpConnection(
  connectionId: string,
  input: { credential?: string; status?: 'active' | 'disabled' },
): Promise<McpConnectionDto> {
  return authFetch<McpConnectionDto>(`/mcp/connections/${connectionId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteMcpConnection(connectionId: string): Promise<void> {
  return authFetch<void>(`/mcp/connections/${connectionId}`, { method: 'DELETE' });
}

export function listMcpTools(serverId: string): Promise<McpToolDto[]> {
  return authFetch<McpToolDto[]>(`/mcp/servers/${serverId}/tools`);
}

export function getMcpCalls(serverId: string, cursor?: string): Promise<McpCallsPage> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return authFetch<McpCallsPage>(`/mcp/servers/${serverId}/calls${qs}`);
}

// ---- admin ----

export function adminListMcpServers(): Promise<AdminMcpServerDto[]> {
  return authFetch<AdminMcpServerDto[]>('/admin/mcp/servers');
}

export interface ImportMcpServerBody {
  name: string;
  url: string;
  transportType: 'http' | 'sse';
  authType: 'none' | 'header' | 'oauth';
  authHeaderName?: string;
  credentialFormat?: string;
  setupInstructionsMd?: string;
  // OAuth fields (only when authType === 'oauth')
  oauthAuthorizeUrl?: string;
  oauthTokenUrl?: string;
  oauthScopes?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthAutoDiscover?: boolean;
}

export function adminImportMcpServer(body: ImportMcpServerBody): Promise<McpServerDto> {
  return authFetch<McpServerDto>('/admin/mcp/servers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface UpdateMcpServerBody {
  name?: string;
  enabled?: boolean;
  url?: string;
  authHeaderName?: string;
  credentialFormat?: string;
  setupInstructionsMd?: string;
  oauthAuthorizeUrl?: string;
  oauthTokenUrl?: string;
  oauthScopes?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthAutoDiscover?: boolean;
}

export function adminUpdateMcpServer(id: string, body: UpdateMcpServerBody): Promise<McpServerDto> {
  return authFetch<McpServerDto>(`/admin/mcp/servers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function adminDeleteMcpServer(id: string): Promise<void> {
  return authFetch<void>(`/admin/mcp/servers/${id}`, { method: 'DELETE' });
}

export function refreshMcpConnection(connectionId: string): Promise<McpToolDto[]> {
  return authFetch<McpToolDto[]>(`/mcp/connections/${connectionId}/refresh`, {
    method: 'POST',
    body: JSON.stringify({}),
    timeoutMs: 60_000,
  } as RequestInit & { timeoutMs: number });
}

export function adminGetMcpCalls(serverId: string, cursor?: string): Promise<McpCallsPage> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return authFetch<McpCallsPage>(`/admin/mcp/servers/${serverId}/calls${qs}`);
}

// ---- tool tiering (per connection) ----

export interface McpToolTiers {
  recommended: string[];
  optional: string[];
  off: string[];
}

export function getConnectionTiers(connectionId: string): Promise<McpToolTiers | null> {
  return authFetch<McpToolTiers | null>(`/mcp/connections/${connectionId}/tiers`);
}

export function setConnectionTiers(
  connectionId: string,
  tiers: McpToolTiers,
): Promise<McpToolTiers> {
  return authFetch<McpToolTiers>(`/mcp/connections/${connectionId}/tiers`, {
    method: 'PUT',
    body: JSON.stringify({ tiers }),
  });
}

export function autoSortConnectionTiers(connectionId: string): Promise<McpToolTiers> {
  return authFetch<McpToolTiers>(`/mcp/connections/${connectionId}/auto-sort-tiers`, {
    method: 'POST',
    body: JSON.stringify({}),
    timeoutMs: 60_000,
  } as RequestInit & { timeoutMs: number });
}

// ---- OAuth ----

/** Start an OAuth flow for the given server. Returns the provider authorize URL. */
export function startMcpOAuth(serverId: string): Promise<string> {
  return authFetch<{ authorizeUrl: string }>(`/mcp/servers/${serverId}/oauth/start`, {
    method: 'POST',
  }).then((r) => {
    if (!r.authorizeUrl) throw new Error('OAuth start did not return an authorize URL');
    return r.authorizeUrl;
  });
}
