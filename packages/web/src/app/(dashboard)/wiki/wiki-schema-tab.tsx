'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { wikiApi } from '@/lib/api/wiki';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface WikiSchemaTabProps {
  canEdit: boolean;
}

export function WikiSchemaTab({ canEdit }: WikiSchemaTabProps) {
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void wikiApi
      .getSchema()
      .then((r) => {
        if (alive) {
          setContent(r.content);
          setLoaded(true);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          // eslint-disable-next-line no-console
          console.error('Failed to load schema', err);
          setLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await wikiApi.updateSchema(content);
      setDirty(false);
      toast.success('Schema saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save schema');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return <div className="p-6 text-muted-foreground">Loading schema…</div>;
  }

  return (
    <div className="grid h-full grid-cols-2 gap-4 p-4">
      <textarea
        className="h-full w-full rounded border bg-background p-2 font-mono text-sm"
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
        }}
      />
      <div className="prose prose-sm h-full overflow-y-auto rounded border bg-background p-3 dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
      <div className="col-span-2 flex justify-end gap-2">
        {canEdit && (
          <Button disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save schema'}
          </Button>
        )}
      </div>
    </div>
  );
}
