'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { wikiApi, type WikiPageDto } from '@/lib/api/wiki';
import { groupsApi, type GroupMembership } from '@/lib/api/groups';
import { WikiPageList } from './wiki-page-list';
import { WikiEditor } from './wiki-editor';
import { WikiBacklinks } from './wiki-backlinks';
import { WikiNewPageDialog } from './wiki-new-page-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/components/auth-provider';

// TODO: replace with GET /me/policy when a policy endpoint is available
const AMBIENT_CAP = 5;

interface WikiPagesTabProps {
  selectedId: string | null;
  onSelectedIdChange: (id: string | null) => void;
}

export function WikiPagesTab({ selectedId, onSelectedIdChange }: WikiPagesTabProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [pages, setPages] = useState<WikiPageDto[]>([]);
  const [ownership, setOwnership] = useState<'mine' | 'visible'>('visible');
  const setSelectedId = onSelectedIdChange;
  const [selected, setSelected] = useState<WikiPageDto | null>(null);
  const [search, setSearch] = useState('');
  const [groups, setGroups] = useState<GroupMembership[]>([]);
  const [newPageOpen, setNewPageOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rows = await wikiApi.list({ ownership, q: search || undefined });
      setPages(rows);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to load wiki pages', e);
    }
  }, [ownership, search]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    void groupsApi
      .listMine()
      .then(({ items }) => {
        if (alive) setGroups(items);
      })
      .catch(() => {
        if (alive) setGroups([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    let alive = true;
    void wikiApi.get(selectedId).then((p) => {
      if (alive) setSelected(p);
    });
    return () => {
      alive = false;
    };
  }, [selectedId]);

  const allSlugs = useMemo(() => pages.map((p) => ({ slug: p.slug, title: p.title })), [pages]);

  const ambientUsed = useMemo(
    () => pages.filter((p) => p.scope === 'AMBIENT' && p.isOwned).length,
    [pages],
  );

  const handleSave = async (input: { title: string; summary: string; content: string }) => {
    if (!selected) return;
    const updated = await wikiApi.update(selected.id, input);
    setSelected(updated);
    await refresh();
  };

  const handleScopeChange = async (next: 'AMBIENT' | 'ARCHIVED') => {
    if (!selected) return;
    const updated = await wikiApi.update(selected.id, { scope: next });
    setSelected(updated);
    await refresh();
  };

  const handleShareToggle = async (next: boolean) => {
    if (!selected) return;
    if (next && !selected.isOrgShared) {
      await wikiApi.share(selected.id, { targetType: 'org' });
    } else if (!next && selected.isOrgShared) {
      await wikiApi.unshareOrg(selected.id);
    }
    const refreshed = await wikiApi.get(selected.id);
    setSelected(refreshed);
    await refresh();
  };

  const handleGroupShareToggle = async (groupId: string, next: boolean) => {
    if (!selected) return;
    if (next && !selected.sharedGroupIds.includes(groupId)) {
      await wikiApi.share(selected.id, { targetType: 'group', groupId });
    } else if (!next && selected.sharedGroupIds.includes(groupId)) {
      await wikiApi.unshareGroup(selected.id, groupId);
    }
    const refreshed = await wikiApi.get(selected.id);
    setSelected(refreshed);
    await refresh();
  };

  const handleDelete = async () => {
    if (!selected) return;
    await wikiApi.delete(selected.id);
    setSelectedId(null);
    setSelected(null);
    await refresh();
  };

  const handleCreatePage = async (input: { title: string; summary: string; domain: string }) => {
    const created = await wikiApi.create({
      title: input.title,
      summary: input.summary,
      content: '',
      tags: [`domain:${input.domain}`],
    });
    setSelectedId(created.id);
    await refresh();
  };

  const handleTagsChange = async (next: string[]) => {
    if (!selected) return;
    const updated = await wikiApi.update(selected.id, { tags: next });
    setSelected(updated);
    await refresh();
  };

  const handleNewDailyNote = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const tag = `daily:${today}`;
    const existing = pages.find((p) => p.tags.includes(tag) && p.isOwned);
    if (existing) {
      setSelectedId(existing.id);
      return;
    }
    try {
      const created = await wikiApi.create({
        title: `Daily — ${today}`,
        summary: 'Daily note',
        content: '',
        tags: [tag],
      });
      setSelectedId(created.id);
      await refresh();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to create daily note', e);
    }
  }, [pages, refresh, setSelectedId]);

  return (
    <div className="flex h-full">
      <aside className="w-80 shrink-0 space-y-3 overflow-y-auto border-r p-4">
        <Input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Tabs value={ownership} onValueChange={(v) => setOwnership(v as 'mine' | 'visible')}>
          <TabsList className="w-full">
            <TabsTrigger value="visible" className="flex-1">
              Visible to me
            </TabsTrigger>
            <TabsTrigger value="mine" className="flex-1">
              Mine
            </TabsTrigger>
          </TabsList>
          <TabsContent value={ownership}>
            <WikiPageList
              pages={pages}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onNewDailyNote={handleNewDailyNote}
              onNewPage={() => setNewPageOpen(true)}
            />
          </TabsContent>
        </Tabs>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <div className="space-y-6">
            <WikiEditor
              page={selected}
              allSlugs={allSlugs}
              ambientUsed={ambientUsed}
              ambientCap={AMBIENT_CAP}
              isAdmin={isAdmin}
              groups={groups}
              onSave={handleSave}
              onDelete={handleDelete}
              onScopeChange={handleScopeChange}
              onShareToggle={handleShareToggle}
              onGroupShareToggle={handleGroupShareToggle}
              onTagsChange={handleTagsChange}
            />
            <WikiBacklinks pageId={selected.id} onSelect={setSelectedId} />
          </div>
        ) : (
          <div className="text-muted-foreground">Select a page from the left.</div>
        )}
      </main>
      <WikiNewPageDialog
        open={newPageOpen}
        onOpenChange={setNewPageOpen}
        onSubmit={handleCreatePage}
      />
    </div>
  );
}
