'use client';

import { useCallback, useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/auth';
import { useChat } from './use-chat';
import { ChatThread } from './chat-thread';
import { ChatInput, EmptyState } from './chat-input';
import { SessionSidebar } from './session-sidebar';

const SIDEBAR_STORAGE_KEY = 'conversations-sidebar-open';

export default function ConversationsPage() {
  // Initialize to false for SSR, then sync from localStorage after hydration
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Error banner dismissal — flipped back to false whenever the error string
  // changes (i.e. a fresh error always re-displays).
  const [errorDismissed, setErrorDismissed] = useState(false);

  // Sync sidebar state from localStorage after mount (avoids hydration mismatch)
  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored === 'true') {
      setSidebarOpen(true);
    }
  }, []);

  // Persist sidebar state to localStorage
  const handleSidebarToggle = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }, []);
  const {
    sessions,
    currentSessionId,
    messages,
    isTyping,
    isConnected,
    error,
    loadingSessions,
    loadingMessages,
    loadingMore,
    hasMore,
    loadingMoreSessions,
    hasMoreSessions,
    selectSession,
    sendMessage,
    retryMessage,
    deleteSession,
    failedTmpIds,
    startNewChat,
    loadMore,
    loadMoreSessions,
    refreshSessions,
    toolProgressMode,
  } = useChat();

  // Reset banner dismissal whenever a fresh error string arrives so it re-displays.
  useEffect(() => {
    setErrorDismissed(false);
  }, [error]);

  // Auto-select the latest active session when sessions load.
  // Only run when currentSessionId is EXPLICITLY null (not yet set) and there are
  // no messages on screen — this prevents debouncedFetchSessions from race-triggering
  // selectSession() while streaming is in progress, which would wipe the bubble list.
  useEffect(() => {
    if (
      !loadingSessions &&
      sessions.length > 0 &&
      currentSessionId === null &&
      messages.length === 0
    ) {
      const activeSession = sessions.find((s) => s.isActive);
      if (activeSession) {
        void selectSession(activeSession.id);
      }
    }
  }, [loadingSessions, sessions, currentSessionId, selectSession, messages.length]);

  // Refresh sessions when page becomes visible (handles Safari bfcache and tab switching)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshSessions();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refreshSessions]);

  const hasConversation = currentSessionId !== null || messages.length > 0;
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const isArchived = currentSession?.isActive === false;

  // Extract user message history (most recent first) for input history navigation
  const userMessageHistory = messages
    .filter(
      (m) =>
        m.role === 'user' &&
        !m.content.startsWith('[Sub-Agent Result]') &&
        !m.content.startsWith('[Runtime Context]'),
    )
    .map((m) => m.content)
    .reverse();

  function handleSend(content: string) {
    if (!content.trim()) return;
    sendMessage(content);
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Session sidebar with slide animation */}
      <div
        className={`shrink-0 overflow-hidden transition-all duration-300 ease-out ${
          sidebarOpen ? 'w-[260px] border-r opacity-100' : 'pointer-events-none w-0 opacity-0'
        }`}
      >
        <SessionSidebar
          sessions={sessions}
          selectedId={currentSessionId}
          loading={loadingSessions}
          loadingMore={loadingMoreSessions}
          hasMore={hasMoreSessions}
          onSelect={(id) => void selectSession(id)}
          onNewChat={(archiveCurrent) => void startNewChat(archiveCurrent)}
          onLoadMore={() => void loadMoreSessions()}
          onSessionUpdated={() => void refreshSessions()}
          onDelete={(id) => deleteSession(id)}
        />
      </div>

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {/* Toggle sidebar button */}
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={handleSidebarToggle}
            title={sidebarOpen ? 'Hide sessions' : 'Show sessions'}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeftOpen className="size-4" />
            )}
          </Button>
          <span className="text-sm text-muted-foreground">
            {currentSession?.topic ?? 'Conversations'}
            {isArchived && <span className="ml-2 text-xs opacity-60">(Archived)</span>}
          </span>
        </div>
        {error && !errorDismissed && (
          <div
            role="alert"
            className="mx-6 mt-4 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <span className="flex-1">{error}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              className="-mr-1 -mt-0.5 rounded-sm p-1 text-destructive/80 hover:bg-destructive/10 hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
              onClick={() => {
                setErrorDismissed(true);
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {hasConversation ? (
          <>
            <ChatThread
              messages={messages}
              isTyping={isTyping}
              loading={loadingMessages}
              loadingMore={loadingMore}
              hasMore={hasMore}
              onLoadMore={loadMore}
              toolProgressMode={toolProgressMode}
              failedIds={failedTmpIds}
              onRetry={(id) => {
                retryMessage(id);
              }}
            />
            {isTyping && (
              <div className="flex justify-center py-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => {
                    void authFetch('/api/v1/chat/agent-runs/stop', { method: 'POST' });
                  }}
                >
                  <Square className="size-3" />
                  Stop
                </Button>
              </div>
            )}
            {isArchived ? (
              <div className="border-t px-6 py-4 text-center text-sm text-muted-foreground">
                This conversation is archived and read-only.
              </div>
            ) : (
              <ChatInput
                onSend={handleSend}
                disabled={isTyping}
                isConnected={isConnected}
                userMessages={userMessageHistory}
              />
            )}
          </>
        ) : (
          <>
            <EmptyState onSelectSuggestion={handleSend} />
            <ChatInput
              onSend={handleSend}
              disabled={isTyping}
              isConnected={isConnected}
              userMessages={userMessageHistory}
            />
          </>
        )}
      </div>
    </div>
  );
}
