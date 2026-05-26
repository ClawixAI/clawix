'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WikiGraph, WikiGraphNode } from '@clawix/shared';
import { wikiApi } from '@/lib/api/wiki';
import { WikiGraphSidebar, type GraphFilters } from './graph/wiki-graph-sidebar';
import { WikiGraphCanvas } from './graph/wiki-graph-canvas';
import { WikiGraphInfo } from './graph/wiki-graph-info';
import { useIsMobile } from '@/hooks/use-mobile';

interface Props {
  onOpenPage: (id: string) => void;
}

const EMPTY_GRAPH: WikiGraph = { nodes: [], edges: [] };

export function WikiGraphTab({ onOpenPage }: Props) {
  const isMobile = useIsMobile();
  const [graph, setGraph] = useState<WikiGraph>(EMPTY_GRAPH);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [relayoutKey, setRelayoutKey] = useState(0);
  const [filters, setFilters] = useState<GraphFilters>({
    ownership: 'visible',
    search: '',
    domains: new Set(),
    ambientOnly: false,
    bfsDepth: 2,
  });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    wikiApi
      .graph({ ownership: filters.ownership })
      .then((g) => {
        if (alive) {
          setGraph(g);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          setError(e instanceof Error ? e.message : 'Failed to load graph');
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [filters.ownership]);

  const visibleNodeIds = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const set = new Set<string>();
    for (const n of graph.nodes) {
      if (filters.ambientOnly && n.scope !== 'AMBIENT') continue;
      if (filters.domains.size > 0) {
        const d = n.isDaily && !n.domain ? '__daily' : (n.domain ?? '__untagged');
        if (!filters.domains.has(d)) continue;
      }
      if (q && !n.title.toLowerCase().includes(q) && !n.slug.toLowerCase().includes(q)) {
        continue;
      }
      set.add(n.id);
    }
    return set;
  }, [graph.nodes, filters]);

  const { outDeg, inDeg } = useMemo(() => {
    const out = new Map<string, number>();
    const inn = new Map<string, number>();
    for (const e of graph.edges) {
      out.set(e.from, (out.get(e.from) ?? 0) + 1);
      inn.set(e.to, (inn.get(e.to) ?? 0) + 1);
    }
    return { outDeg: out, inDeg: inn };
  }, [graph.edges]);

  const orphanCount = useMemo(() => {
    let n = 0;
    for (const node of graph.nodes) {
      if ((outDeg.get(node.id) ?? 0) === 0 && (inDeg.get(node.id) ?? 0) === 0) n++;
    }
    return n;
  }, [graph.nodes, outDeg, inDeg]);

  const focused: WikiGraphNode | null = useMemo(
    () => (focusedId ? (graph.nodes.find((n) => n.id === focusedId) ?? null) : null),
    [focusedId, graph.nodes],
  );

  const handleRelayout = useCallback(() => setRelayoutKey((k) => k + 1), []);

  if (isMobile) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground">
        Graph view is only available on wider screens.
        <br />
        Switch to the Pages tab to browse and edit pages.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading graph…
      </div>
    );
  }
  if (error) {
    return <div className="flex h-full items-center justify-center text-destructive">{error}</div>;
  }
  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No wiki pages yet. Create one in the Pages tab.
      </div>
    );
  }

  const banner =
    graph.edges.length === 0 ? (
      <div className="border-b bg-muted/30 p-2 text-center text-xs text-muted-foreground">
        No links yet. Add <code>[[other-slug]]</code> to a page to start building connections.
      </div>
    ) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {banner}
      <div className="flex flex-1 overflow-hidden">
        <WikiGraphSidebar
          nodes={graph.nodes}
          edgeCount={graph.edges.length}
          orphanCount={orphanCount}
          filters={filters}
          onChange={setFilters}
          onRelayout={handleRelayout}
        />
        <div className="flex-1">
          <WikiGraphCanvas
            graph={graph}
            focusedId={focusedId}
            bfsDepth={filters.bfsDepth}
            visibleNodeIds={visibleNodeIds}
            onFocus={setFocusedId}
            onOpen={onOpenPage}
            relayoutKey={relayoutKey}
          />
        </div>
        <WikiGraphInfo
          node={focused}
          outDegree={focused ? (outDeg.get(focused.id) ?? 0) : 0}
          inDegree={focused ? (inDeg.get(focused.id) ?? 0) : 0}
          onOpen={() => focused && onOpenPage(focused.id)}
          onClose={() => setFocusedId(null)}
        />
      </div>
    </div>
  );
}
