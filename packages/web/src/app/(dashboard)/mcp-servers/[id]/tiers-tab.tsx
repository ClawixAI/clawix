'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  autoSortConnectionTiers,
  getConnectionTiers,
  listMcpTools,
  setConnectionTiers,
  type McpToolDto,
  type McpToolTiers,
} from '@/lib/mcp';

type Tier = 'recommended' | 'optional' | 'off';

/** Build the serverId-keyed tier assignment from a tiers object. */
function assignmentFromTiers(
  tools: readonly McpToolDto[],
  tiers: McpToolTiers | null,
): Record<string, Tier> {
  const rec = new Set(tiers?.recommended ?? []);
  const opt = new Set(tiers?.optional ?? []);
  const out: Record<string, Tier> = {};
  for (const t of tools)
    out[t.name] = rec.has(t.name) ? 'recommended' : opt.has(t.name) ? 'optional' : 'off';
  return out;
}

function tiersFromAssignment(a: Record<string, Tier>): McpToolTiers {
  const tiers: McpToolTiers = { recommended: [], optional: [], off: [] };
  for (const [name, tier] of Object.entries(a)) tiers[tier].push(name);
  return tiers;
}

export function TiersTab({
  serverId,
  connectionId,
}: {
  serverId: string;
  connectionId: string | null;
}) {
  const [tools, setTools] = useState<McpToolDto[]>([]);
  const [assignment, setAssignment] = useState<Record<string, Tier>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sorting, setSorting] = useState(false);

  useEffect(() => {
    if (!connectionId) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const [t, tiers] = await Promise.all([
          listMcpTools(serverId),
          getConnectionTiers(connectionId),
        ]);
        setTools(t);
        setAssignment(assignmentFromTiers(t, tiers));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load tiers');
      } finally {
        setLoading(false);
      }
    })();
  }, [serverId, connectionId]);

  if (!connectionId)
    return (
      <p className="text-sm text-muted-foreground">Connect to this server to tier its tools.</p>
    );
  if (loading)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );

  async function autoSort() {
    if (!connectionId) return;
    setSorting(true);
    try {
      const tiers = await autoSortConnectionTiers(connectionId);
      setAssignment(assignmentFromTiers(tools, tiers));
      toast.success(`Auto-sorted: ${tiers.recommended.length} recommended`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Auto-sort failed');
    } finally {
      setSorting(false);
    }
  }

  async function save() {
    if (!connectionId) return;
    setSaving(true);
    try {
      await setConnectionTiers(connectionId, tiersFromAssignment(assignment));
      toast.success('Tiers saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Tier this server&apos;s tools. Agents you bind pre-tick the recommended set.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={sorting} onClick={() => void autoSort()}>
            {sorting ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-3 w-3" />
            )}
            Auto-sort
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}Save
          </Button>
        </div>
      </div>
      <ul className="flex flex-col divide-y rounded-md border">
        {tools.map((tool) => (
          <li key={tool.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs">{tool.name}</span>
              {tool.scanFlagged && <Badge variant="destructive">flagged</Badge>}
            </span>
            <Select
              value={assignment[tool.name] ?? 'off'}
              onValueChange={(v) => setAssignment((a) => ({ ...a, [tool.name]: v as Tier }))}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recommended">Recommended</SelectItem>
                <SelectItem value="optional">Optional</SelectItem>
                <SelectItem value="off">Off</SelectItem>
              </SelectContent>
            </Select>
          </li>
        ))}
        {tools.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">No tools.</li>
        )}
      </ul>
    </div>
  );
}
