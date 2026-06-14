import type { McpBindings, McpToolTiers } from '@clawix/shared';

import type { McpServerForRun } from '../../../db/mcp-server.repository.js';

/**
 * Build an MCP allowlist from each server's active connection `recommended`
 * tier. Used by the auto-bind path (the agent has no explicit
 * `toolConfig.mcp`): an agent run as a user gets that user's curated
 * `recommended` tools for every server they have an active connection to.
 *
 * - Servers with no active connection contribute nothing (and no attention
 *   notification — that signal is reserved for the explicit override path).
 * - A connection with null/empty `recommended` yields no tools.
 * - `registerMcpTools` re-intersects with the live catalog, so a tier naming
 *   a since-removed tool is harmless.
 */
export function bindingsFromTiers(servers: readonly McpServerForRun[]): McpBindings {
  const out: McpBindings = { servers: [] };
  for (const server of servers) {
    if (!server.enabled) continue;
    const connection = server.connections[0];
    if (!connection || connection.status !== 'active') continue;
    const tiers = (connection.tiers as McpToolTiers | null) ?? null;
    const recommended = tiers?.recommended ?? [];
    if (recommended.length > 0) {
      out.servers.push({ serverId: server.id, enabledTools: [...recommended] });
    }
  }
  return out;
}
