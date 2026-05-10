'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Search } from 'lucide-react';

import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { extractText, getDomain, memoryApi, type MemoryItem } from '@/lib/api/memory';
import { KanbanBoard } from './kanban-board';
import { CardEditor } from './card-editor';

type EditorState =
  | { mode: 'create'; defaultDomain?: string }
  | { mode: 'edit'; item: MemoryItem }
  | null;

export default function MemoryPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'viewer';
  const canMutate = role === 'admin' || role === 'developer';

  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorState>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const { items: fetched } = await memoryApi.list('visible');
      setItems(fetched);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load memory');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const knownDomains = useMemo(() => {
    if (!items) return [];
    const set = new Set<string>();
    for (const it of items) set.add(getDomain(it));
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const text = extractText(it.content).toLowerCase();
      const tags = it.tags.join(' ').toLowerCase();
      return text.includes(q) || tags.includes(q);
    });
  }, [items, search]);

  return (
    <div className="flex min-w-0 flex-col gap-4 p-6">
      <header className="flex flex-col gap-1 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground/70">
            knowledge base
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Tagged knowledge your agent can search. Organize by domain; toggle{' '}
          <code className="rounded bg-foreground/5 px-1 font-mono text-xs">public</code> to share
          with the org.
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ScopeLegend />

        <div className="flex flex-1 items-center justify-end gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter content or tags…"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {canMutate && (
            <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
              <Plus className="mr-1 size-4" />
              New
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {items === null ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="min-w-0">
          <KanbanBoard
            items={filtered}
            callerUserId={user?.sub ?? ''}
            canMutate={canMutate}
            onOpenCard={(item) => setEditor({ mode: 'edit', item })}
            onCreateInDomain={(domain) => setEditor({ mode: 'create', defaultDomain: domain })}
          />
        </div>
      )}

      {editor && (
        <CardEditor
          target={editor}
          knownDomains={knownDomains}
          canMutate={
            canMutate && (editor.mode === 'create' || editor.item.ownerId === (user?.sub ?? ''))
          }
          isAdmin={role === 'admin'}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function ScopeLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <LegendPill stripe="bg-primary" label="Mine" />
      <LegendPill stripe="bg-sky-500" label="Group" />
      <LegendPill stripe="bg-amber-500" label="Org" />
    </div>
  );
}

function LegendPill({ stripe, label }: { stripe: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 py-1 pl-1 pr-2 text-xs text-muted-foreground">
      <span className={`inline-block h-3 w-1 rounded-sm ${stripe}`} />
      <span className="font-mono uppercase tracking-wider">{label}</span>
    </span>
  );
}
