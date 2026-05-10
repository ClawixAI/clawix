'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { groupsApi } from '@/lib/api/groups';

export interface PickedUser {
  id: string;
  name: string | null;
  email: string;
}

interface InvitePickerProps {
  groupId: string;
  picked: PickedUser[];
  onChange: (picked: PickedUser[]) => void;
  disabled?: boolean;
}

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 200;

/**
 * Multi-user picker: chip input + tab/enter autocomplete from a server-side
 * user search. Owners build a list of invitees, then a single Invite button
 * (rendered by the parent) batches the invite calls.
 *
 * - Tab / Enter on a query commits the highlighted suggestion as a chip.
 * - Comma also commits the highlighted suggestion (or the raw email if it
 *   looks like an email and there are no matches).
 * - Backspace on an empty input pops the last chip.
 */
export function InvitePicker({ groupId, picked, onChange, disabled }: InvitePickerProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PickedUser[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced server search.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { items } = await groupsApi.searchUsers(trimmed, groupId);
        if (cancelled) return;
        const pickedIds = new Set(picked.map((p) => p.id));
        const filtered = items.filter((u) => !pickedIds.has(u.id));
        setSuggestions(filtered);
        setHighlight(0);
        setOpen(filtered.length > 0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, groupId, picked]);

  const commit = useCallback(
    (user: PickedUser) => {
      if (picked.some((p) => p.id === user.id)) return;
      onChange([...picked, user]);
      setQuery('');
      setSuggestions([]);
      setOpen(false);
    },
    [picked, onChange],
  );

  const popLast = useCallback(() => {
    if (picked.length === 0) return;
    onChange(picked.slice(0, -1));
  }, [picked, onChange]);

  const remove = (id: string) => onChange(picked.filter((p) => p.id !== id));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && query.length === 0) {
      popLast();
      return;
    }
    if (!open || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Tab' || e.key === 'Enter' || e.key === ',') {
      const target = suggestions[highlight];
      if (target) {
        e.preventDefault();
        commit(target);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <div
        className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm focus-within:ring-1 focus-within:ring-ring"
        onClick={() => inputRef.current?.focus()}
      >
        {picked.map((p) => (
          <Badge
            key={p.id}
            variant="secondary"
            className="flex items-center gap-1 pr-1 pl-2 font-normal"
          >
            <span className="truncate max-w-[160px]">{p.name ?? p.email}</span>
            <button
              type="button"
              className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
              onClick={(e) => {
                e.stopPropagation();
                remove(p.id);
              }}
              aria-label={`Remove ${p.email}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 100)}
          placeholder={picked.length === 0 ? 'Type a name or email…' : ''}
          disabled={disabled}
          className="h-7 flex-1 min-w-[160px] border-0 px-1 py-0 shadow-none focus-visible:ring-0"
        />
      </div>

      {open && suggestions.length > 0 ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching…
            </div>
          ) : null}
          {suggestions.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                commit(s);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                i === highlight ? 'bg-accent text-accent-foreground' : ''
              }`}
            >
              <span className="font-medium">{s.name ?? s.email}</span>
              {s.name ? (
                <span className="ml-2 text-xs text-muted-foreground">{s.email}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <p className="mt-1 text-xs text-muted-foreground">
        Tab or Enter to add, Backspace to remove the last one.
      </p>
    </div>
  );
}
