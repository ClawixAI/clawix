'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ApiError } from '@/lib/api';
import {
  extractText,
  freeFormTags,
  getDomain,
  isOrgShared as itemIsOrgShared,
  memoryApi,
  type MemoryItem,
} from '@/lib/api/memory';

type Target = { mode: 'create'; defaultDomain?: string } | { mode: 'edit'; item: MemoryItem };

interface Props {
  target: Target;
  knownDomains: readonly string[];
  canMutate: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const DOMAIN_REGEX = /^[a-z0-9][a-z0-9-]{0,30}$/;

function slugifyDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 31);
}

function parseFreeFormTags(raw: string): string[] {
  const out = new Set<string>();
  for (const piece of raw.split(',')) {
    const slug = piece
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
    if (slug && slug !== 'public' && !slug.startsWith('domain:') && !slug.startsWith('daily:')) {
      out.add(slug);
    }
  }
  return [...out];
}

export function CardEditor({ target, knownDomains, canMutate, isAdmin, onClose, onSaved }: Props) {
  const isEdit = target.mode === 'edit';
  const item = isEdit ? target.item : null;
  const wasOrgShared = item ? itemIsOrgShared(item) : false;
  // Non-admins can keep/remove an already-org-shared row but cannot ADD it.
  // Service enforces the same rule server-side.
  const canToggleOrgShare = canMutate && (isAdmin || wasOrgShared);

  const [body, setBody] = useState(item ? extractText(item.content) : '');
  const [domain, setDomain] = useState(
    item ? getDomain(item) : (target.mode === 'create' && target.defaultDomain) || '',
  );
  const [newDomainInput, setNewDomainInput] = useState('');
  const [tagsInput, setTagsInput] = useState(item ? freeFormTags(item).join(', ') : '');
  const [orgShared, setOrgShared] = useState(wasOrgShared);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
  }, [body, domain, tagsInput, orgShared]);

  const effectiveDomain = domain === '__new__' ? slugifyDomain(newDomainInput) : domain;
  const domainValid = DOMAIN_REGEX.test(effectiveDomain);

  const handleSave = async () => {
    if (!body.trim()) {
      setError('Content is required.');
      return;
    }
    if (!domainValid) {
      setError('Pick a domain (lowercase, alphanumeric, hyphens, max 31 chars).');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const tags = [`domain:${effectiveDomain}`, ...parseFreeFormTags(tagsInput)];
      if (target.mode === 'create') {
        await memoryApi.create({ content: body, tags, orgShared });
      } else {
        await memoryApi.update(target.item.id, {
          content: body,
          tags,
          // Only send orgShared when the user actually flipped it, so a
          // developer editing their own org-shared item doesn't trip the
          // admin gate when they didn't change the toggle.
          ...(orgShared !== wasOrgShared ? { orgShared } : {}),
        });
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError('You can only edit memory you own.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to save');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    try {
      await memoryApi.delete(target.item.id);
      setConfirmDeleteOpen(false);
      onSaved();
    } catch (e) {
      setConfirmDeleteOpen(false);
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col gap-4 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit memory' : 'New memory'}</SheetTitle>
          <SheetDescription>
            Saved memory is searchable by your agent. Toggle <code>public</code> to opt into
            org-wide visibility.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="domain">Domain (kanban column)</Label>
            <select
              id="domain"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={!canMutate}
            >
              <option value="">— pick a domain —</option>
              {knownDomains
                .filter((d) => d !== 'untagged')
                .map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              <option value="__new__">+ new domain…</option>
            </select>
            {domain === '__new__' && (
              <Input
                placeholder="e.g. hr, engineering, personal"
                value={newDomainInput}
                onChange={(e) => setNewDomainInput(e.target.value)}
                disabled={!canMutate}
              />
            )}
            <p className="text-xs text-muted-foreground">
              One domain per memory. Lowercase letters, numbers, and hyphens.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="body">Content</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[200px] font-mono text-sm"
              placeholder="Markdown body…"
              disabled={!canMutate}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="urgent, q3, draft"
              disabled={!canMutate}
            />
            <p className="text-xs text-muted-foreground">
              Free-form tags. Reserved prefixes (<code>domain:</code>, <code>daily:</code>) are
              stripped automatically.
            </p>
          </div>

          {/* Org-share toggle is admin-only; hidden for developers and viewers
              unless the item is already shared (so an owner can un-share). */}
          {(isAdmin || wasOrgShared) && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="org-share-toggle" className="text-sm">
                  Share with organization
                </Label>
                <p className="text-xs text-muted-foreground">
                  Make this memory visible to every user in the org. Their agents will find it via{' '}
                  <code>search_memory</code>. Backed by a <code>MemoryShare(targetType=ORG)</code>{' '}
                  row — same primitive as <code>share_memory</code>.
                </p>
              </div>
              <Switch
                id="org-share-toggle"
                checked={orgShared}
                onCheckedChange={setOrgShared}
                disabled={!canToggleOrgShare}
              />
            </div>
          )}

          {isEdit && (
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
              <Badge variant="outline">Created {new Date(item!.createdAt).toLocaleString()}</Badge>
              <Badge variant="outline">Updated {new Date(item!.updatedAt).toLocaleString()}</Badge>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3">
          {isEdit && canMutate ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={saving}
            >
              <Trash2 className="mr-1 size-4" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Close
            </Button>
            {canMutate && (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Save className="mr-1 size-4" />
                )}
                Save
              </Button>
            )}
          </div>
        </div>
      </SheetContent>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently removes the row. Agents will no longer find it via search. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
