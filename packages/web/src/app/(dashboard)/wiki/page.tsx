'use client';

import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { parseView, WikiTabs } from './wiki-tabs';
import { WikiPagesTab } from './wiki-pages-tab';
import { WikiSchemaTab } from './wiki-schema-tab';
import { useAuth } from '@/components/auth-provider';

const WikiGraphTab = dynamic(() => import('./wiki-graph-tab').then((m) => m.WikiGraphTab), {
  ssr: false,
  loading: () => <div className="p-6 text-muted-foreground">Loading graph…</div>,
});

export default function WikiPage() {
  const search = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const view = parseView(search.get('view'));
  const selectedId = search.get('id');

  const setSelectedId = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(search.toString());
      if (id) params.set('id', id);
      else params.delete('id');
      router.replace(`/wiki?${params.toString()}`, { scroll: false });
    },
    [router, search],
  );

  const canEditSchema = user?.role === 'admin' || user?.role === 'developer';

  const openPageInPagesTab = useCallback(
    (id: string) => {
      const params = new URLSearchParams(search.toString());
      params.set('view', 'pages');
      params.set('id', id);
      router.replace(`/wiki?${params.toString()}`, { scroll: false });
    },
    [router, search],
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <WikiTabs view={view} />
      <div className="flex-1 overflow-hidden">
        {view === 'pages' && (
          <WikiPagesTab selectedId={selectedId} onSelectedIdChange={setSelectedId} />
        )}
        {view === 'graph' && <WikiGraphTab onOpenPage={openPageInPagesTab} />}
        {view === 'schema' && <WikiSchemaTab canEdit={canEditSchema} />}
      </div>
    </div>
  );
}
