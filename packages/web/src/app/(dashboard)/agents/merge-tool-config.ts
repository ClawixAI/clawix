/**
 * Pure helpers for the agent-edit "MCP Tools" section.
 *
 * The backend's PATCH /api/v1/agents/:id REPLACES the whole toolConfig JSON
 * column, so the UI must read-modify-write: merge the mcp key into the
 * previously-loaded toolConfig and preserve every other key.
 */

export type McpSelections = Record<string, string[]>; // serverId → enabledTools

interface McpBindingShape {
  servers?: { serverId?: unknown; enabledTools?: unknown }[];
}

/** Extract serverId→tools from an agent's toolConfig blob (defensive). */
export function bindingsFromToolConfig(toolConfig: unknown): McpSelections {
  const mcp = (toolConfig as { mcp?: McpBindingShape } | undefined)?.mcp;
  if (!mcp || typeof mcp !== 'object' || !Array.isArray(mcp.servers)) return {};
  const out: McpSelections = {};
  for (const entry of mcp.servers) {
    if (typeof entry?.serverId !== 'string' || !Array.isArray(entry.enabledTools)) continue;
    out[entry.serverId] = entry.enabledTools.filter((t): t is string => typeof t === 'string');
  }
  return out;
}

/** Merge selections into an existing toolConfig, preserving foreign keys. */
export function mergeMcpIntoToolConfig(
  existing: Record<string, unknown> | undefined,
  selections: McpSelections,
): Record<string, unknown> {
  const servers = Object.entries(selections)
    .filter(([, tools]) => tools.length > 0)
    .map(([serverId, enabledTools]) => ({ serverId, enabledTools }));

  const base: Record<string, unknown> = { ...(existing ?? {}) };
  if (servers.length === 0) {
    delete base['mcp'];
    return base;
  }
  return { ...base, mcp: { servers } };
}

/**
 * TOFU "new" badge: an unticked tool on a server that already has a saved
 * binding appeared after the user last approved that server. First-time
 * servers show no badges.
 */
export function isNewTool(saved: McpSelections, serverId: string, toolName: string): boolean {
  const tools = saved[serverId];
  if (!tools) return false;
  return !tools.includes(toolName);
}
