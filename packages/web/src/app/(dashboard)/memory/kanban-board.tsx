'use client';

import { useMemo } from 'react';
import { Globe, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  extractText,
  freeFormTags,
  getDomain,
  isOrgShared as itemIsOrgShared,
  type MemoryItem,
} from '@/lib/api/memory';

type Scope = 'own' | 'group' | 'org';

function scopeOf(item: MemoryItem, callerUserId: string): Scope {
  if (itemIsOrgShared(item)) return 'org';
  if (item.ownerId === callerUserId) return 'own';
  return 'group';
}

// Each scope owns:
//  • a base border tone + bg fill (no hover)
//  • a hover bg tint (slightly stronger than base)
//  • a soft shadow tinted in the scope color so the lift on hover reads as
//    "energy in this scope's hue" instead of a generic grey drop-shadow
//  • a 3px left accent stripe so the scope is legible at a glance even
//    before the bg tint registers
const SCOPE_CLASSES: Record<Scope, string> = {
  own: 'border-border border-l-[3px] border-l-primary/50 bg-muted/60 hover:border-primary/40 hover:bg-primary/10 hover:shadow-[0_8px_24px_-8px_rgba(217,119,6,0.35)]',
  group:
    'border-sky-500/40 border-l-[3px] border-l-sky-500 bg-sky-500/5 hover:border-sky-500/70 hover:bg-sky-500/15 hover:shadow-[0_8px_24px_-8px_rgba(56,189,248,0.45)]',
  org: 'border-amber-500/40 border-l-[3px] border-l-amber-500 bg-amber-500/5 hover:border-amber-500/70 hover:bg-amber-500/15 hover:shadow-[0_8px_24px_-8px_rgba(245,158,11,0.45)]',
};

interface Props {
  items: readonly MemoryItem[];
  callerUserId: string;
  canMutate: boolean;
  onOpenCard: (item: MemoryItem) => void;
  onCreateInDomain: (domain: string | undefined) => void;
}

export function KanbanBoard({
  items,
  callerUserId,
  canMutate,
  onOpenCard,
  onCreateInDomain,
}: Props) {
  const grouped = useMemo(() => groupByDomain(items), [items]);

  if (grouped.size === 0) {
    return (
      <div className="flex min-h-[calc(100vh-14rem)] flex-col items-center justify-center gap-3 rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">No memory yet.</p>
        {canMutate && (
          <Button size="sm" onClick={() => onCreateInDomain(undefined)}>
            <Plus className="mr-1 size-4" />
            New memory
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-14rem)] gap-4 overflow-x-auto pb-3">
      {[...grouped.entries()].map(([domain, columnItems]) => (
        <Column
          key={domain}
          domain={domain}
          items={columnItems}
          callerUserId={callerUserId}
          canMutate={canMutate}
          onOpenCard={onOpenCard}
          onCreateInDomain={onCreateInDomain}
        />
      ))}

      {canMutate && (
        <div className="flex w-72 shrink-0 flex-col items-center justify-start gap-2 rounded-md border border-dashed p-3">
          <p className="text-xs text-muted-foreground">Add a new memory in a new domain</p>
          <Button size="sm" variant="outline" onClick={() => onCreateInDomain(undefined)}>
            <Plus className="mr-1 size-4" />
            New domain
          </Button>
        </div>
      )}
    </div>
  );
}

function Column({
  domain,
  items,
  callerUserId,
  canMutate,
  onOpenCard,
  onCreateInDomain,
}: {
  domain: string;
  items: readonly MemoryItem[];
  callerUserId: string;
  canMutate: boolean;
  onOpenCard: (item: MemoryItem) => void;
  onCreateInDomain: (domain: string | undefined) => void;
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col gap-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {domain}
          </span>
          <span className="font-mono text-xs text-muted-foreground/70">{items.length}</span>
        </div>
        {canMutate && (
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={() => onCreateInDomain(domain === 'untagged' ? undefined : domain)}
            aria-label={`Add memory to ${domain}`}
          >
            <Plus className="size-4" />
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <Card
            key={item.id}
            item={item}
            scope={scopeOf(item, callerUserId)}
            onClick={() => onOpenCard(item)}
          />
        ))}
      </div>
    </div>
  );
}

function Card({ item, scope, onClick }: { item: MemoryItem; scope: Scope; onClick: () => void }) {
  const text = extractText(item.content);
  const firstLine = text.split('\n')[0]?.slice(0, 80) ?? '(empty)';
  const tags = freeFormTags(item);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex cursor-pointer flex-col gap-1.5 rounded-md border p-2.5 text-left text-sm transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02]',
        SCOPE_CLASSES[scope],
      )}
      aria-label={`${scope}-scoped memory`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 flex-1 font-medium">{firstLine}</span>
        {scope === 'org' ? (
          <Globe
            className="size-3.5 shrink-0 text-amber-500"
            aria-label="shared with organization"
          />
        ) : scope === 'group' ? (
          <Users className="size-3.5 shrink-0 text-sky-500" aria-label="shared via group" />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {tags.slice(0, 3).map((t) => (
          <span
            key={t}
            className="rounded-sm bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] tracking-tight text-muted-foreground"
          >
            {t}
          </span>
        ))}
        {tags.length > 3 && (
          <span className="font-mono text-[10px] text-muted-foreground/70">+{tags.length - 3}</span>
        )}
      </div>
    </button>
  );
}

function groupByDomain(items: readonly MemoryItem[]): Map<string, MemoryItem[]> {
  const map = new Map<string, MemoryItem[]>();
  for (const item of items) {
    const d = getDomain(item);
    const existing = map.get(d) ?? [];
    existing.push(item);
    map.set(d, existing);
  }
  // Stable order: untagged last, others alphabetical
  return new Map(
    [...map.entries()].sort((a, b) => {
      if (a[0] === 'untagged') return 1;
      if (b[0] === 'untagged') return -1;
      return a[0].localeCompare(b[0]);
    }),
  );
}
