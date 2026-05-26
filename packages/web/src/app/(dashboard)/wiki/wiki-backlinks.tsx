'use client';

import { useEffect, useState } from 'react';
import { wikiApi, type WikiBacklink } from '@/lib/api/wiki';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  pageId: string;
  onSelect: (id: string) => void;
}

export function WikiBacklinks({ pageId, onSelect }: Props) {
  const [backs, setBacks] = useState<WikiBacklink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void wikiApi
      .backlinks(pageId)
      .then((rows) => {
        if (alive) {
          setBacks(rows);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          // eslint-disable-next-line no-console
          console.error('Failed to load backlinks', e);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [pageId]);

  if (loading) {
    return <div className="p-2 text-xs text-muted-foreground">Loading backlinks…</div>;
  }
  if (backs.length === 0) {
    return <div className="p-2 text-xs text-muted-foreground">No backlinks.</div>;
  }

  return (
    <Card>
      <CardHeader className="py-2">
        <CardTitle className="text-sm">Backlinks ({backs.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 py-2">
        {backs.map((b) => (
          <button
            key={b.id}
            onClick={() => onSelect(b.id)}
            className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
            type="button"
          >
            <span className="font-medium">{b.title}</span>
            <span className="ml-2 text-xs text-muted-foreground">{b.summary}</span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
