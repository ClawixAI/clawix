'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import type { WikiGraphNode } from '@clawix/shared';
import { colorForDomain } from './domain-palette';

export interface GraphFilters {
  ownership: 'mine' | 'visible';
  search: string;
  domains: Set<string>; // empty = all
  ambientOnly: boolean;
  bfsDepth: number;
}

interface Props {
  nodes: readonly WikiGraphNode[];
  edgeCount: number;
  orphanCount: number;
  filters: GraphFilters;
  onChange: (next: GraphFilters) => void;
  onRelayout: () => void;
}

export function WikiGraphSidebar({
  nodes,
  edgeCount,
  orphanCount,
  filters,
  onChange,
  onRelayout,
}: Props) {
  const counts = new Map<string, number>();
  let dailyCount = 0;
  let untaggedCount = 0;
  for (const n of nodes) {
    if (n.isDaily && !n.domain) dailyCount++;
    else if (!n.domain) untaggedCount++;
    else counts.set(n.domain, (counts.get(n.domain) ?? 0) + 1);
  }
  const domainList = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const toggleDomain = (d: string) => {
    const next = new Set(filters.domains);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    onChange({ ...filters, domains: next });
  };

  return (
    <aside className="w-[240px] shrink-0 space-y-4 overflow-y-auto border-r p-3 text-sm">
      <div>
        <Label className="mb-1 block font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Search
        </Label>
        <Input
          type="search"
          placeholder="search nodes…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </div>

      <div>
        <Label className="mb-1 block font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Visibility
        </Label>
        <Tabs
          value={filters.ownership}
          onValueChange={(v) => onChange({ ...filters, ownership: v as 'mine' | 'visible' })}
        >
          <TabsList className="w-full">
            <TabsTrigger value="visible" className="flex-1">
              Visible to me
            </TabsTrigger>
            <TabsTrigger value="mine" className="flex-1">
              Mine
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div>
        <Label className="mb-1 block font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Domain
        </Label>
        <ul className="space-y-1">
          {domainList.map(([d, count]) => (
            <li key={d} className="flex items-center justify-between gap-2">
              <label className="flex flex-1 cursor-pointer items-center gap-2">
                <Checkbox
                  checked={filters.domains.size === 0 || filters.domains.has(d)}
                  onCheckedChange={() => toggleDomain(d)}
                />
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: colorForDomain(d, false) }}
                />
                <span>{d}</span>
              </label>
              <span className="text-xs text-muted-foreground">{count}</span>
            </li>
          ))}
          {dailyCount > 0 && (
            <li className="flex items-center justify-between gap-2 text-muted-foreground">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: colorForDomain(null, true) }}
                />
                daily
              </span>
              <span className="text-xs">{dailyCount}</span>
            </li>
          )}
          {untaggedCount > 0 && (
            <li className="flex items-center justify-between gap-2 text-muted-foreground">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: colorForDomain(null, false) }}
                />
                untagged
              </span>
              <span className="text-xs">{untaggedCount}</span>
            </li>
          )}
        </ul>
      </div>

      <div>
        <Label className="flex items-center justify-between font-mono text-xs uppercase tracking-wider text-muted-foreground">
          <span>Ambient only</span>
          <Checkbox
            checked={filters.ambientOnly}
            onCheckedChange={(v) => onChange({ ...filters, ambientOnly: Boolean(v) })}
          />
        </Label>
      </div>

      <div>
        <Label className="mb-1 block font-mono text-xs uppercase tracking-wider text-muted-foreground">
          BFS depth
        </Label>
        <Input
          type="number"
          min={1}
          max={5}
          value={filters.bfsDepth}
          onChange={(e) =>
            onChange({
              ...filters,
              bfsDepth: Math.max(1, Math.min(5, Number(e.target.value) || 2)),
            })
          }
        />
      </div>

      <div>
        <Button variant="outline" size="sm" className="w-full" onClick={onRelayout}>
          Re-layout
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {nodes.length} nodes · {edgeCount} edges · {orphanCount} orphans
      </p>
    </aside>
  );
}
