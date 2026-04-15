'use client';

import { Archive, Loader2, MessageSquarePlus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { ChatSession } from './use-chat';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface SessionSidebarProps {
  sessions: ChatSession[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'Previous 7 Days';
  return 'Older';
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
  onSelect,
  onNewChat,
}: SessionSidebarProps) {
  // Sort sessions by createdAt descending (newest first)
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Group sessions by date label
  const groups = sorted.reduce<Record<string, ChatSession[]>>((acc, session) => {
    const group = getDateGroup(session.createdAt);
    const list = acc[group] ?? [];
    list.push(session);
    acc[group] = list;
    return acc;
  }, {});

  // Maintain consistent group ordering
  const groupOrder = ['Today', 'Yesterday', 'Previous 7 Days', 'Older'];
  const orderedGroups = groupOrder.filter((g) => groups[g] !== undefined);

  return (
    <div className="flex w-[260px] shrink-0 flex-col border-r">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <Button variant="ghost" size="icon" className="size-8">
          <Search className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onNewChat}
        >
          <MessageSquarePlus className="size-4" />
        </Button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No conversations yet
          </p>
        ) : (
          orderedGroups.map((group) => (
            <div key={group}>
              <p className="px-3 py-2 text-xs font-medium text-muted-foreground">
                {group}
              </p>
              {(groups[group] ?? []).map((session) => (
                <button
                  key={session.id}
                  onClick={() => {
                    onSelect(session.id);
                  }}
                  className={cn(
                    'mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50',
                    selectedId === session.id && 'bg-muted',
                    !session.isActive && 'opacity-60',
                  )}
                >
                  {!session.isActive && (
                    <Archive className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">
                    {session.isActive ? 'Session' : 'Archived'} &mdash; {formatShortDate(session.createdAt)}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
