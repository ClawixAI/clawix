'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type WikiView = 'pages' | 'graph' | 'schema';

const VALID: WikiView[] = ['pages', 'graph', 'schema'];

export function parseView(raw: string | null): WikiView {
  return (VALID as string[]).includes(raw ?? '') ? (raw as WikiView) : 'pages';
}

interface Props {
  view: WikiView;
}

export function WikiTabs({ view }: Props) {
  const router = useRouter();
  const search = useSearchParams();

  const onChange = useCallback(
    (next: string) => {
      const params = new URLSearchParams(search.toString());
      params.set('view', next);
      router.replace(`/wiki?${params.toString()}`, { scroll: false });
    },
    [router, search],
  );

  return (
    <Tabs value={view} onValueChange={onChange} className="border-b">
      <TabsList className="rounded-none border-0 bg-transparent">
        <TabsTrigger value="pages">Pages</TabsTrigger>
        <TabsTrigger value="graph">Graph</TabsTrigger>
        <TabsTrigger value="schema">Schema</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
