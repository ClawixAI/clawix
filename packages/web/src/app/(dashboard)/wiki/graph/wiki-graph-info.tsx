'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pin } from 'lucide-react';
import type { WikiGraphNode } from '@clawix/shared';
import { colorForDomain } from './domain-palette';

interface Props {
  node: WikiGraphNode | null;
  outDegree: number;
  inDegree: number;
  onOpen: () => void;
  onClose: () => void;
}

export function WikiGraphInfo({ node, outDegree, inDegree, onOpen, onClose }: Props) {
  if (!node) {
    return (
      <aside className="w-[220px] shrink-0 border-l p-3 text-sm text-muted-foreground">
        Click a node to inspect it.
      </aside>
    );
  }
  const swatch = colorForDomain(node.domain, node.isDaily);
  return (
    <aside className="w-[220px] shrink-0 border-l p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Selected
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
          aria-label="Clear selection"
        >
          ✕
        </button>
      </div>
      <div className="rounded border-l-2 border-l-primary bg-muted/30 p-2">
        <div className="font-semibold">{node.title}</div>
        <div className="font-mono text-xs text-muted-foreground">{node.slug}</div>
        <div className="mt-2 text-xs leading-relaxed">{node.summary}</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {node.scope === 'AMBIENT' && (
            <Badge variant="secondary" className="gap-1">
              <Pin className="h-3 w-3" /> ambient
            </Badge>
          )}
          {node.domain && (
            <Badge variant="outline" className="gap-1">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: swatch }}
              />
              domain:{node.domain}
            </Badge>
          )}
          {node.isDaily && <Badge variant="outline">daily</Badge>}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          {outDegree} outbound · {inDegree} backlinks
        </div>
        <Button onClick={onOpen} className="mt-3 w-full" size="sm">
          Open in editor →
        </Button>
      </div>
    </aside>
  );
}
