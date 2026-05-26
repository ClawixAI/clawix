'use client';

import { useMemo } from 'react';
import { Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WikiPageDto } from '@/lib/api/wiki';

interface Props {
  pages: WikiPageDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewDailyNote: () => void | Promise<void>;
  onNewPage: () => void;
}

export function WikiPageList({ pages, selectedId, onSelect, onNewDailyNote, onNewPage }: Props) {
  const groups = useMemo(() => groupByDomain(pages), [pages]);
  return (
    <div className="mt-2 space-y-3">
      <button
        type="button"
        className="mx-2 my-1 w-[calc(100%-1rem)] rounded bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        onClick={onNewPage}
      >
        + New page
      </button>
      {!groups['Daily notes'] && (
        <div>
          <div className="px-2 text-xs uppercase tracking-wide text-muted-foreground">
            Daily notes
          </div>
          <button
            type="button"
            className="mx-2 my-1 rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-900 hover:bg-amber-500/30 dark:text-amber-100"
            onClick={() => void onNewDailyNote()}
          >
            + New daily note
          </button>
        </div>
      )}
      {Object.entries(groups).map(([domain, items]) => (
        <div key={domain}>
          <div className="px-2 text-xs uppercase tracking-wide text-muted-foreground">{domain}</div>
          {domain === 'Daily notes' && (
            <button
              type="button"
              className="mx-2 my-1 rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-900 hover:bg-amber-500/30 dark:text-amber-100"
              onClick={() => void onNewDailyNote()}
            >
              + New daily note
            </button>
          )}
          <ul className="mt-1 space-y-0.5">
            {items.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onSelect(p.id)}
                  className={cn(
                    'w-full rounded px-2 py-1.5 text-left hover:bg-muted',
                    selectedId === p.id && 'bg-muted',
                  )}
                >
                  <div className="flex items-center gap-1">
                    {p.scope === 'AMBIENT' && (
                      <Pin className="h-3 w-3 text-amber-500" aria-label="pinned to context" />
                    )}
                    <span className="text-sm font-medium">{p.title}</span>
                  </div>
                  <div className="line-clamp-1 text-xs text-muted-foreground">{p.summary}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {pages.length === 0 && (
        <div className="px-2 py-4 text-sm text-muted-foreground">No pages yet.</div>
      )}
    </div>
  );
}

function groupByDomain(pages: WikiPageDto[]): Record<string, WikiPageDto[]> {
  const out: Record<string, WikiPageDto[]> = {};
  // Daily-notes group first
  const daily = pages.filter((p) => p.tags.some((t) => t.startsWith('daily:')));
  if (daily.length) out['Daily notes'] = daily;
  for (const p of pages.filter((p) => !p.tags.some((t) => t.startsWith('daily:')))) {
    const domain = p.tags.find((t) => t.startsWith('domain:')) ?? '(untagged)';
    (out[domain] ??= []).push(p);
  }
  return out;
}
