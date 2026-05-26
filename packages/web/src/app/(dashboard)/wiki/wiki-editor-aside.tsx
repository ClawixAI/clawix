'use client';

import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import type { WikiPageDto } from '@/lib/api/wiki';
import type { GroupMembership } from '@/lib/api/groups';

interface Props {
  page: WikiPageDto;
  ambientUsed: number;
  ambientCap: number;
  isAdmin: boolean;
  groups: readonly GroupMembership[];
  onScopeChange: (next: 'AMBIENT' | 'ARCHIVED') => Promise<void> | void;
  onShareToggle: (next: boolean) => Promise<void> | void;
  onGroupShareToggle: (groupId: string, next: boolean) => Promise<void> | void;
  onTagsChange: (next: string[]) => Promise<void> | void;
}

export function WikiEditorAside({
  page,
  ambientUsed,
  ambientCap,
  isAdmin,
  groups,
  onScopeChange,
  onShareToggle,
  onGroupShareToggle,
  onTagsChange,
}: Props) {
  const [tagInput, setTagInput] = useState('');
  const atCap = ambientUsed >= ambientCap && page.scope !== 'AMBIENT';

  return (
    <aside className="space-y-4 border-l p-3 text-sm">
      <div>
        <Label className="flex items-center justify-between">
          <span>Pin to context (ambient)</span>
          <Switch
            disabled={atCap}
            checked={page.scope === 'AMBIENT'}
            onCheckedChange={(v) => onScopeChange(v ? 'AMBIENT' : 'ARCHIVED')}
          />
        </Label>
        <div className="mt-1 text-xs text-muted-foreground">
          {ambientUsed} of {ambientCap} used{atCap && ' — unpin a page to enable'}
        </div>
      </div>

      <div>
        <Label className="flex items-center justify-between">
          <span>Share with organization</span>
          <Switch disabled={!isAdmin} checked={page.isOrgShared} onCheckedChange={onShareToggle} />
        </Label>
        {!isAdmin && <div className="mt-1 text-xs text-muted-foreground">Admins only</div>}
      </div>

      {page.isOwned && (
        <div>
          <div className="mb-1 font-medium">Share with groups</div>
          {groups.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              Join or create a group to share pages.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {groups.map((g) => (
                <li key={g.groupId}>
                  <Label className="flex items-center justify-between text-xs">
                    <span className="truncate">{g.group.name}</span>
                    <Switch
                      checked={page.sharedGroupIds.includes(g.groupId)}
                      onCheckedChange={(v) => onGroupShareToggle(g.groupId, v)}
                    />
                  </Label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <div className="mb-1 font-medium">Tags</div>
        <div className="mb-2 flex flex-wrap gap-1">
          {page.tags.map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => onTagsChange(page.tags.filter((x) => x !== t))}
            >
              {t} ✕
            </Badge>
          ))}
          {page.tags.length === 0 && (
            <span className="text-xs text-muted-foreground">No tags yet.</span>
          )}
        </div>
        <input
          className="w-full rounded border bg-background px-2 py-1"
          placeholder="add tag, Enter to commit"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const v = tagInput.trim().toLowerCase();
              if (v && !page.tags.includes(v)) {
                void onTagsChange([...page.tags, v]);
              }
              setTagInput('');
            }
          }}
        />
        <div className="mt-1 text-xs text-muted-foreground">
          Domain tag required when adding non-daily tags (e.g. <code>domain:hr</code>)
        </div>
      </div>
    </aside>
  );
}
