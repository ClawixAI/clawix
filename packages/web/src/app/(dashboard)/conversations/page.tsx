'use client';

import { useEffect } from 'react';
import { Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/auth';
import { useChat } from './use-chat';
import { ChatThread } from './chat-thread';
import { ChatInput, EmptyState } from './chat-input';
import { SessionSidebar } from './session-sidebar';

export default function ConversationsPage() {
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
    selectSession,
    sendMessage,
    startNewChat,
    loadMore,
  } = useChat();

  // Auto-select the latest active session when sessions load
  useEffect(() => {
    if (!loadingSessions && sessions.length > 0 && !currentSessionId) {
      const activeSession = sessions.find((s) => s.isActive);
      if (activeSession) {
        void selectSession(activeSession.id);
      }
    }
  }, [loadingSessions, sessions, currentSessionId, selectSession]);

  const hasConversation = currentSessionId !== null || messages.length > 0;

  // Extract user message history (most recent first) for input history navigation
  const userMessageHistory = messages
    .filter((m) => m.role === 'user' && !m.content.startsWith('[Sub-Agent Result]') && !m.content.startsWith('[Runtime Context]'))
    .map((m) => m.content)
    .reverse();

  function handleSend(content: string) {
    if (!content.trim()) return;
    sendMessage(content);
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Session sidebar */}
      <SessionSidebar
        sessions={sessions}
        selectedId={currentSessionId}
        loading={loadingSessions}
        onSelect={(id) => void selectSession(id)}
        onNewChat={startNewChat}
      />

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">

        {error && (
          <div className="mx-6 mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
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
            <ChatInput onSend={handleSend} disabled={isTyping} isConnected={isConnected} userMessages={userMessageHistory} />
          </>
        ) : (
          <>
            <EmptyState onSelectSuggestion={handleSend} />
            <ChatInput onSend={handleSend} disabled={isTyping} isConnected={isConnected} userMessages={userMessageHistory} />
          </>
        )}
      </div>
    </div>
  );
}
