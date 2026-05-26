'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ChevronRight,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { authFetch } from '@/lib/auth';
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
} from '@/components/ui/alert-dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ChatSession } from './use-chat';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface SessionSidebarProps {
  sessions: ChatSession[];
  selectedId: string | null;
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onSelect: (id: string) => void;
  onNewChat: (archiveCurrent?: boolean) => void;
  onLoadMore?: () => void;
  onSessionUpdated?: () => void;
  onDelete?: (id: string) => Promise<boolean>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

// Stable per-day key (local time, YYYY-MM-DD) used for grouping and expansion state.
function getDayKey(dateStr: string): string {
  const date = new Date(dateStr);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Human-friendly label for a day group: "Today", "Yesterday", or a localized date.
function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const todayKey = getDayKey(today.toISOString());
  const dayKey = getDayKey(dateStr);
  if (dayKey === todayKey) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey === getDayKey(yesterday.toISOString())) return 'Yesterday';
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SessionSidebar({
  sessions,
  selectedId,
  loading,
  loadingMore = false,
  hasMore = false,
  onSelect,
  onNewChat,
  onLoadMore,
  onSessionUpdated,
  onDelete,
}: SessionSidebarProps) {
  const [renameSession, setRenameSession] = useState<ChatSession | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmNewChat, setConfirmNewChat] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<ChatSession | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteConfirm = async () => {
    if (!deleteCandidate || !onDelete) return;
    setDeleting(true);
    const ok = await onDelete(deleteCandidate.id);
    setDeleting(false);
    if (ok) {
      setDeleteCandidate(null);
      onSessionUpdated?.();
    }
  };

  const handleNewChatClick = () => {
    // If there's an active session selected, ask for confirmation
    const currentSession = sessions.find((s) => s.id === selectedId);
    if (currentSession?.isActive) {
      setConfirmNewChat(true);
    } else {
      onNewChat(false);
    }
  };

  // Filter sessions by search query (case-insensitive match on topic or date)
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const query = searchQuery.toLowerCase();
    return sessions.filter((session) => {
      const topic = session.topic?.toLowerCase() ?? '';
      const date = formatShortDate(session.createdAt).toLowerCase();
      return topic.includes(query) || date.includes(query);
    });
  }, [sessions, searchQuery]);

  // Sort sessions by createdAt descending (newest first)
  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [filtered],
  );

  // Group sessions by day (stable key) and preserve insertion order (already sorted desc).
  const { dayKeys, groups } = useMemo(() => {
    const map = new Map<string, ChatSession[]>();
    for (const session of sorted) {
      const key = getDayKey(session.createdAt);
      const list = map.get(key) ?? [];
      list.push(session);
      map.set(key, list);
    }
    return { dayKeys: Array.from(map.keys()), groups: map };
  }, [sorted]);

  // Track which day groups are expanded. Default: all collapsed.
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const toggleDay = (key: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // When searching, auto-expand all matching day groups so results are visible.
  // When the user is viewing a session, ensure its day group is expanded.
  useEffect(() => {
    if (searchQuery.trim()) {
      setExpandedDays(new Set(dayKeys));
      return;
    }
    if (selectedId) {
      const selected = sorted.find((s) => s.id === selectedId);
      if (selected) {
        const key = getDayKey(selected.createdAt);
        setExpandedDays((prev) => {
          if (prev.has(key)) return prev;
          const next = new Set(prev);
          next.add(key);
          return next;
        });
      }
    }
  }, [searchQuery, dayKeys, selectedId, sorted]);

  const listRef = useRef<HTMLDivElement>(null);

  // Trigger onLoadMore when the user scrolls within ~80px of the bottom.
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || !onLoadMore || !hasMore || loadingMore) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) {
      onLoadMore();
    }
  }, [onLoadMore, hasMore, loadingMore]);

  const handleRename = (session: ChatSession) => {
    setRenameSession(session);
    setRenameValue(session.topic ?? '');
  };

  const handleRenameSubmit = async () => {
    if (!renameSession) return;
    setSaving(true);
    try {
      await authFetch(`/api/v1/chat/sessions/${renameSession.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ topic: renameValue.trim() || null }),
      });
      setRenameSession(null);
      onSessionUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rename conversation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-[260px] shrink-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => {
            setSearchOpen(!searchOpen);
            if (searchOpen) setSearchQuery('');
          }}
        >
          {searchOpen ? <X className="size-4" /> : <Search className="size-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={handleNewChatClick}>
          <MessageSquarePlus className="size-4" />
        </Button>
      </div>

      {/* Search input */}
      {searchOpen && (
        <div className="px-3 pb-2">
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
        </div>
      )}

      {/* Session list */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {searchQuery ? 'No matching conversations' : 'No conversations yet'}
          </p>
        ) : (
          dayKeys.map((dayKey) => {
            const daySessions = groups.get(dayKey) ?? [];
            const isExpanded = expandedDays.has(dayKey);
            const label = formatDayLabel(daySessions[0]!.createdAt);
            return (
              <div key={dayKey}>
                <button
                  type="button"
                  onClick={() => toggleDay(dayKey)}
                  className="flex w-full items-center gap-1 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  aria-expanded={isExpanded}
                >
                  <ChevronRight
                    className={cn(
                      'size-3 shrink-0 transition-transform duration-200',
                      isExpanded && 'rotate-90',
                    )}
                  />
                  <span className="flex-1 truncate">{label}</span>
                  <span className="text-[10px] tabular-nums opacity-60">{daySessions.length}</span>
                </button>
                {isExpanded &&
                  daySessions.map((session) => (
                    <ContextMenu key={session.id}>
                      <ContextMenuTrigger asChild>
                        <button
                          onClick={() => {
                            onSelect(session.id);
                          }}
                          className={cn(
                            'mx-2 flex w-[calc(100%-16px)] cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-all duration-150 hover:translate-x-0.5 hover:bg-primary/5',
                            selectedId === session.id && 'bg-primary/10 text-foreground',
                            !session.isActive && 'opacity-60',
                          )}
                        >
                          {!session.isActive && (
                            <Archive className="size-3 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate">
                            {session.topic ?? `Session — ${formatShortDate(session.createdAt)}`}
                          </span>
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => handleRename(session)}>
                          <Pencil className="mr-2 size-4" />
                          Rename
                        </ContextMenuItem>
                        {onDelete && (
                          <>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              variant="destructive"
                              onClick={() => setDeleteCandidate(session)}
                            >
                              <Trash2 className="mr-2 size-4" />
                              Delete
                            </ContextMenuItem>
                          </>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
              </div>
            );
          })
        )}
        {loadingMore && (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Rename Dialog */}
      <Dialog
        open={renameSession !== null}
        onOpenChange={(open) => !open && setRenameSession(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Conversation</DialogTitle>
            <DialogDescription>Enter a new name for this conversation.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Conversation topic..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !saving) {
                void handleRenameSubmit();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameSession(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleRenameSubmit()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteCandidate !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteCandidate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes “
              {deleteCandidate?.topic ??
                (deleteCandidate ? `Session — ${formatShortDate(deleteCandidate.createdAt)}` : '')}
              ” and every message in it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteConfirm();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New Chat Confirmation Dialog */}
      <Dialog open={confirmNewChat} onOpenChange={setConfirmNewChat}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start New Conversation</DialogTitle>
            <DialogDescription>
              Starting a new conversation will archive your current one. You can still view it later
              in the sidebar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmNewChat(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmNewChat(false);
                onNewChat(true);
              }}
            >
              Archive & Start New
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
