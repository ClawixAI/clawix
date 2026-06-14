'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import {
  listMcpServers,
  listMcpTools,
  type McpServerWithConnection,
  type McpToolDto,
} from '@/lib/mcp';
import { groupToolsByTier, type TierTool } from './group-by-tier';
import { type McpSelections } from './merge-tool-config';

/**
 * TOFU tool-allowlist section for the agent edit dialog. `saved` is the
 * binding loaded from the agent's current toolConfig; `selections` is the
 * working copy the parent persists on save. Tools are grouped by the
 * connection's tiers (curated on the server detail page's Tiers tab); the
 * human still ticks the final set (TOFU unchanged).
 */
export function AgentMcpTools({
  selections,
  onChange,
}: {
  saved: McpSelections;
  selections: McpSelections;
  onChange: (next: McpSelections) => void;
}) {
  const [servers, setServers] = useState<McpServerWithConnection[]>([]);
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpToolDto[]>>({});
  const [openServers, setOpenServers] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const seededRef = useRef(false);

  useEffect(() => {
    listMcpServers()
      .then(setServers)
      .catch(() => setUnavailable(true)) // 403 (plan) or transient — hide section content
      .finally(() => setLoading(false));
  }, []);

  // One-time pre-tick: union each connected server's recommended tier into the
  // working selection without clobbering the saved binding. Guarded so a user
  // who unticks a recommended tool this session doesn't get it re-added.
  useEffect(() => {
    if (seededRef.current || servers.length === 0) return;
    seededRef.current = true;
    let next = selections;
    let changed = false;
    for (const s of servers) {
      if (s.enabled && s.connection?.status === 'active' && s.connection.tiers) {
        const rec = s.connection.tiers.recommended ?? [];
        const cur = next[s.id] ?? [];
        const merged = Array.from(new Set([...cur, ...rec]));
        if (merged.length !== cur.length) {
          next = { ...next, [s.id]: merged };
          changed = true;
        }
      }
    }
    if (changed) onChange(next);
    // Intentionally one-time after servers load; selections/onChange omitted from deps
    // (exhaustive-deps is disabled project-wide) — the ref guard owns the seed-once behavior.
  }, [servers]);

  async function loadTools(serverId: string) {
    if (!toolsByServer[serverId]) {
      try {
        const tools = await listMcpTools(serverId);
        setToolsByServer((prev) => ({ ...prev, [serverId]: tools }));
      } catch {
        setToolsByServer((prev) => ({ ...prev, [serverId]: [] }));
      }
    }
  }

  function toggleTool(serverId: string, toolName: string, checked: boolean) {
    const current = selections[serverId] ?? [];
    const next = checked ? [...current, toolName] : current.filter((t) => t !== toolName);
    onChange({ ...selections, [serverId]: next });
  }

  function handleOpenChange(serverId: string, open: boolean) {
    setOpenServers((prev) => ({ ...prev, [serverId]: open }));
    if (open) void loadTools(serverId);
  }

  if (loading)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading MCP servers…
      </div>
    );
  if (unavailable || servers.length === 0) return null;

  const connected = servers.filter((s) => s.enabled && s.connection?.status === 'active');
  const notConnected = servers.filter((s) => s.enabled && s.connection?.status !== 'active');

  function ToolRow({ serverId, tool }: { serverId: string; tool: TierTool }) {
    const checked = (selections[serverId] ?? []).includes(tool.name);
    return (
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => toggleTool(serverId, tool.name, v === true)}
        />
        <span className="font-mono text-xs">{tool.name}</span>
        {tool.isNew && (
          <Badge variant="outline" className="text-amber-500">
            new
          </Badge>
        )}
        {tool.scanFlagged && <Badge variant="destructive">flagged</Badge>}
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>MCP Tools</Label>
      <p className="text-xs text-muted-foreground">
        Only ticked tools are available to this agent. Newly discovered tools stay unticked until
        you approve them.
      </p>

      {connected.map((server) => {
        const isOpen = openServers[server.id] ?? false;
        const tiers = server.connection?.tiers ?? null;
        const groups = groupToolsByTier(toolsByServer[server.id] ?? [], tiers);
        return (
          <Collapsible
            key={server.id}
            open={isOpen}
            onOpenChange={(open) => handleOpenChange(server.id, open)}
          >
            <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm">
              {isOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
              <span className="font-medium">{server.name}</span>
              <span className="text-xs text-muted-foreground">
                {(selections[server.id] ?? []).length} selected
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="rounded-b-md border border-t-0 px-3 py-2">
              {!toolsByServer[server.id] ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <div className="flex flex-col gap-3">
                  {groups.recommended.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Recommended</span>
                      {groups.recommended.map((tool) => (
                        <ToolRow key={tool.id} serverId={server.id} tool={tool} />
                      ))}
                    </div>
                  )}

                  {groups.optional.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Optional</span>
                      {groups.optional.map((tool) => (
                        <ToolRow key={tool.id} serverId={server.id} tool={tool} />
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {tiers ? 'Other tools' : 'All tools'}
                    </span>
                    {groups.other.map((tool) => (
                      <ToolRow key={tool.id} serverId={server.id} tool={tool} />
                    ))}
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        );
      })}

      {notConnected.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Not connected: {notConnected.map((s) => s.name).join(', ')} —{' '}
          <Link href="/mcp-servers" className="underline">
            connect first
          </Link>
          .
        </p>
      )}
    </div>
  );
}
