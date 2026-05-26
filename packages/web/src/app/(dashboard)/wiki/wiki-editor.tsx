'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { WikiPageDto } from '@/lib/api/wiki';
import type { GroupMembership } from '@/lib/api/groups';
import { WikiEditorAside } from './wiki-editor-aside';

interface Props {
  page: WikiPageDto;
  allSlugs: readonly { slug: string; title: string }[];
  ambientUsed: number;
  ambientCap: number;
  isAdmin: boolean;
  groups: readonly GroupMembership[];
  onSave: (input: { title: string; summary: string; content: string }) => Promise<void>;
  onDelete: () => Promise<void> | void;
  onScopeChange: (next: 'AMBIENT' | 'ARCHIVED') => Promise<void> | void;
  onShareToggle: (next: boolean) => Promise<void> | void;
  onGroupShareToggle: (groupId: string, next: boolean) => Promise<void> | void;
  onTagsChange: (next: string[]) => Promise<void> | void;
}

export function WikiEditor({
  page,
  allSlugs,
  ambientUsed,
  ambientCap,
  isAdmin,
  groups,
  onSave,
  onDelete,
  onScopeChange,
  onShareToggle,
  onGroupShareToggle,
  onTagsChange,
}: Props) {
  const [title, setTitle] = useState(page.title);
  const [summary, setSummary] = useState(page.summary);
  const [content, setContent] = useState(page.content);
  const [saving, setSaving] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [suggest, setSuggest] = useState<readonly { slug: string; title: string }[]>([]);

  useEffect(() => {
    setTitle(page.title);
    setSummary(page.summary);
    setContent(page.content);
    setSuggest([]);
  }, [page.id]);

  const onContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setContent(v);
    const cursor = e.target.selectionStart ?? v.length;
    const prefix = v.slice(Math.max(0, cursor - 50), cursor);
    const m = /\[\[([a-z0-9_-]*)$/i.exec(prefix);
    if (m?.[1] !== undefined) {
      const q = m[1].toLowerCase();
      setSuggest(allSlugs.filter((s) => s.slug.startsWith(q) && s.slug !== page.slug).slice(0, 8));
    } else {
      setSuggest([]);
    }
  };

  const insertSlug = (slug: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const before = ta.value.slice(0, cursor).replace(/\[\[[a-z0-9_-]*$/i, `[[${slug}]]`);
    const after = ta.value.slice(cursor);
    const newVal = before + after;
    setContent(newVal);
    setSuggest([]);
    queueMicrotask(() => {
      ta.focus();
      ta.setSelectionRange(before.length, before.length);
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ title, summary, content });
      toast.success('Page saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save page');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_1fr_220px] gap-4">
      <div className="space-y-2">
        <input
          className="w-full rounded border bg-background px-2 py-1 text-lg font-semibold"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
        />
        <input
          className="w-full rounded border bg-background px-2 py-1 text-sm"
          value={summary}
          maxLength={200}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="One-line summary (≤200 chars)"
        />
        <textarea
          ref={taRef}
          className="h-[60vh] w-full rounded border bg-background p-2 font-mono text-sm"
          value={content}
          onChange={onContentChange}
          placeholder="Markdown content. Link to other pages with [[slug]]."
        />
        {suggest.length > 0 && (
          <ul className="rounded border bg-popover p-1 text-sm shadow-md">
            {suggest.map((s) => (
              <li key={s.slug}>
                <button
                  className="w-full rounded px-2 py-1 text-left hover:bg-muted"
                  onClick={() => insertSlug(s.slug)}
                  type="button"
                >
                  <span className="font-mono">{s.slug}</span>
                  <span className="ml-2 text-muted-foreground">— {s.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2">
          {page.isOwned ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" className="text-destructive hover:text-destructive">
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this page?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Permanently delete <span className="font-mono">{page.slug}</span>. Backlinks
                    from other pages will become broken markers. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void onDelete()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete page
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <span />
          )}
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      <div className="prose prose-sm max-h-[80vh] overflow-y-auto rounded border bg-background p-3 dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
      <WikiEditorAside
        page={page}
        ambientUsed={ambientUsed}
        ambientCap={ambientCap}
        isAdmin={isAdmin}
        groups={groups}
        onScopeChange={onScopeChange}
        onShareToggle={onShareToggle}
        onGroupShareToggle={onGroupShareToggle}
        onTagsChange={onTagsChange}
      />
    </div>
  );
}
