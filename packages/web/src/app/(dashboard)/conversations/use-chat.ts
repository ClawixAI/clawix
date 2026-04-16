'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { authFetch, getAccessToken } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  agentDefinitionId: string;
  channelId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Internal types                                                     */
/* ------------------------------------------------------------------ */

interface PaginatedSessions {
  success: boolean;
  data: ChatSession[];
  meta: { total: number; page: number; limit: number };
}

interface PaginatedMessages {
  success: boolean;
  data: {
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }[];
  meta: { total: number; page: number; limit: number };
}

/** Server→Client WebSocket protocol (mirrors web.protocol.ts) */
type ServerEvent =
  | { type: 'connection.ack'; payload: { userId: string } }
  | {
      type: 'message.create';
      payload: {
        messageId: string;
        sessionId: string;
        content: string;
        timestamp: string;
      };
    }
  | { type: 'typing.start'; payload: Record<string, never> }
  | { type: 'typing.stop'; payload: Record<string, never> }
  | { type: 'pong'; payload: Record<string, never> }
  | { type: 'error'; payload: { code: string; message: string } };

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useChat() {
  /* ---- state ---- */
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const pendingCountRef = useRef(0);
  const [hasPending, setHasPending] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [messagePage, setMessagePage] = useState(1);
  const MESSAGE_LIMIT = 20;

  const [webChannelId, setWebChannelId] = useState<string | null>(null);
  const [channelResolved, setChannelResolved] = useState(false);

  /* ---- refs ---- */
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const pongReceivedRef = useRef(true);
  const reconnectAttemptsRef = useRef(0);
  const currentSessionIdRef = useRef<string | null>(null);

  const fetchSessionsRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // Keep refs in sync with state so WebSocket callbacks read the latest value.
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  /* ---- fetch sessions ---- */
  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const channelParam = webChannelId ? `&channelId=${webChannelId}` : '';
      const url = `/api/v1/chat/sessions?limit=50&includeArchived=true${channelParam}`;
      const res = await authFetch<PaginatedSessions>(url);
      setSessions(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError('Failed to load sessions');
    } finally {
      setLoadingSessions(false);
    }
  }, [webChannelId]);

  // Keep ref in sync so WebSocket handler can call latest fetchSessions without dependency.
  useEffect(() => {
    fetchSessionsRef.current = fetchSessions;
  }, [fetchSessions]);

  /* ---- WebSocket ---- */
  const connectWebSocket = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setError('Not authenticated');
      return;
    }

    // Derive WebSocket URL from environment or current location.
    // TODO: Token in query string is visible in logs — migrate to first-message auth when backend supports it.
    // Close any existing connection before creating a new one.
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent reconnect loop from the old socket.
      wsRef.current.close();
      wsRef.current = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsBase =
      process.env['NEXT_PUBLIC_WS_URL'] ?? `${protocol}//${window.location.hostname}:3001`;
    const wsUrl = `${wsBase}/ws/chat?token=${token}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      const wasReconnect = reconnectAttemptsRef.current > 0;
      setError('');
      reconnectAttemptsRef.current = 0;

      // Keepalive ping every 30s with pong timeout detection.
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pongReceivedRef.current = true;
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          if (!pongReceivedRef.current) {
            // No pong received since last ping — connection is dead
            ws.close(4000, 'pong_timeout');
            return;
          }
          pongReceivedRef.current = false;
          ws.send(JSON.stringify({ type: 'ping', payload: {} }));
        }
      }, 30_000);

      // After reconnect, re-fetch messages to catch anything missed during disconnect.
      if (wasReconnect) {
        const sid = currentSessionIdRef.current;
        if (sid) {
          void authFetch<PaginatedMessages>(
            `/api/v1/chat/sessions/${sid}/messages?limit=${MESSAGE_LIMIT}`,
          )
            .then((res) => {
              const fetched: ChatMessage[] = (Array.isArray(res.data) ? res.data : []).map((m) => ({
                id: m.id,
                role: m.role as ChatMessage['role'],
                content: m.content,
                createdAt: m.createdAt,
              }));
              setMessages((prev) => {
                if (fetched.length > prev.length) {
                  const prevIds = new Set(prev.map((m) => m.id));
                  const newAssistant = fetched.filter(
                    (m) => m.role === 'assistant' && !prevIds.has(m.id),
                  );
                  pendingCountRef.current = Math.max(
                    0,
                    pendingCountRef.current - newAssistant.length,
                  );
                  if (pendingCountRef.current === 0) {
                    setIsTyping(false);
                    setHasPending(false);
                  }
                  return fetched;
                }
                return prev;
              });
            })
            .catch(() => {
              /* silent — REST fallback will retry */
            });
        }
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      let parsed: ServerEvent;
      try {
        parsed = JSON.parse(event.data) as ServerEvent;
      } catch {
        return;
      }

      switch (parsed.type) {
        case 'connection.ack':
          setIsConnected(true);
          break;

        case 'message.create': {
          const { messageId, sessionId, content, timestamp } = parsed.payload;

          setMessages((prev) => {
            // Deduplicate — ignore if this messageId already exists.
            if (prev.some((m) => m.id === messageId)) return prev;
            return [
              ...prev,
              {
                id: messageId,
                role: 'assistant',
                content,
                createdAt: timestamp,
              },
            ];
          });
          pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
          if (pendingCountRef.current === 0) {
            setIsTyping(false);
            setHasPending(false);
          }

          // For new chats the session ID isn't known until the server responds.
          if (!currentSessionIdRef.current) {
            setCurrentSessionId(sessionId);
            setIsInitializing(false);
          }

          // Auto-clear after /reset command response
          if (content.includes('Session reset')) {
            setTimeout(() => {
              setCurrentSessionId(null);
              setMessages([]);
              setIsTyping(false);
              setHasPending(false);
              pendingCountRef.current = 0;
              void fetchSessionsRef.current?.();
            }, 1500);
          } else {
            void fetchSessionsRef.current?.();
          }
          break;
        }

        case 'typing.start':
          setIsTyping(true);
          break;

        case 'typing.stop':
          setIsTyping(false);
          break;

        case 'error':
          setError(parsed.payload.message);
          setIsInitializing(false);
          break;

        case 'pong':
          pongReceivedRef.current = true;
          break;
      }
    };

    ws.onclose = (event: CloseEvent) => {
      setIsConnected(false);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);

      // Auth failure — don't reconnect, redirect to login
      if (event.code === 4001) {
        setError('Session expired. Please log in again.');
        return;
      }

      // Exponential backoff: 3s, 6s, 12s, ... capped at 30s. Stop after 10 attempts.
      const attempt = reconnectAttemptsRef.current;
      if (attempt < 10) {
        const delay = Math.min(3000 * 2 ** attempt, 30_000);
        reconnectAttemptsRef.current = attempt + 1;
        reconnectTimerRef.current = setTimeout(() => {
          void connectWebSocket();
        }, delay);
      } else {
        setError('Connection lost. Please refresh the page.');
      }
    };

    ws.onerror = () => {
      // Don't show error during reconnect — onclose handles it
    };

    wsRef.current = ws;
  }, []);
  /* ---- select session ---- */
  const selectSession = useCallback(async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setLoadingMessages(true);
    setMessages([]);
    setMessagePage(1);
    setHasMore(false);
    setError('');

    try {
      const res = await authFetch<PaginatedMessages>(
        `/api/v1/chat/sessions/${sessionId}/messages?limit=${MESSAGE_LIMIT}`,
      );
      const mapped: ChatMessage[] = (Array.isArray(res.data) ? res.data : []).map((m) => ({
        id: m.id,
        role: m.role as ChatMessage['role'],
        content: m.content,
        createdAt: m.createdAt,
      }));
      setMessages(mapped);
      setHasMore(res.meta.total > MESSAGE_LIMIT);
    } catch {
      setError('Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  /* ---- load more (older messages) ---- */
  const loadMore = useCallback(async () => {
    const sid = currentSessionIdRef.current;
    if (!sid || loadingMore || !hasMore) return;

    setLoadingMore(true);
    const nextPage = messagePage + 1;

    try {
      const res = await authFetch<PaginatedMessages>(
        `/api/v1/chat/sessions/${sid}/messages?limit=${MESSAGE_LIMIT}&page=${nextPage}`,
      );
      const older: ChatMessage[] = (Array.isArray(res.data) ? res.data : []).map((m) => ({
        id: m.id,
        role: m.role as ChatMessage['role'],
        content: m.content,
        createdAt: m.createdAt,
      }));
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const deduped = older.filter((m) => !existingIds.has(m.id));
        return [...deduped, ...prev];
      });
      setMessagePage(nextPage);
      setHasMore(nextPage < Math.ceil(res.meta.total / MESSAGE_LIMIT));
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  }, [messagePage, loadingMore, hasMore]);

  /* ---- send message ---- */
  const sendMessage = useCallback((content: string): boolean => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setError('Not connected — message not sent. Try again.');
      return false;
    }

    const optimistic: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    // First message in a new session — show initializing overlay
    if (!currentSessionIdRef.current) {
      setIsInitializing(true);
    }

    setMessages((prev) => [...prev, optimistic]);
    wsRef.current.send(JSON.stringify({ type: 'message.send', payload: { content } }));
    pendingCountRef.current += 1;
    setHasPending(true);
    setIsTyping(true);
    return true;
  }, []);

  /* ---- start new chat ---- */
  const startNewChat = useCallback(async () => {
    // Archive current session if one is active
    const sid = currentSessionIdRef.current;
    if (sid) {
      try {
        await authFetch(`/api/v1/chat/sessions/${sid}/deactivate`, { method: 'POST' });
      } catch {
        // Proceed even if deactivation fails
      }
    }
    setCurrentSessionId(null);
    setMessages([]);
    setIsTyping(false);
    setHasPending(false);
    pendingCountRef.current = 0;
    setError('');
    // Refresh sessions to show the archived one in sidebar
    void fetchSessionsRef.current?.();
  }, []);

  /* ---- resolve web channel ID ---- */
  useEffect(() => {
    void authFetch<{ data: { id: string } | null }>('/api/v1/chat/channel')
      .then((res) => {
        if (res.data) setWebChannelId(res.data.id);
      })
      .catch(() => {
        /* proceed without filter */
      })
      .finally(() => {
        setChannelResolved(true);
      });
  }, []);

  /* ---- lifecycle: connect WebSocket once ---- */
  useEffect(() => {
    void connectWebSocket();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);
  /* ---- fallback: poll REST while waiting for response ---- */
  useEffect(() => {
    if (!isTyping && !hasPending) return;
    const interval = setInterval(() => {
      const sid = currentSessionIdRef.current;
      if (!sid) return;
      void authFetch<PaginatedMessages>(
        `/api/v1/chat/sessions/${sid}/messages?limit=${MESSAGE_LIMIT}`,
      )
        .then((res) => {
          const fetched: ChatMessage[] = (Array.isArray(res.data) ? res.data : []).map((m) => ({
            id: m.id,
            role: m.role as ChatMessage['role'],
            content: m.content,
            createdAt: m.createdAt,
          }));
          setMessages((prev) => {
            if (fetched.length > prev.length) {
              const prevIds = new Set(prev.map((m) => m.id));
              const newAssistant = fetched.filter(
                (m) => m.role === 'assistant' && !prevIds.has(m.id),
              );
              pendingCountRef.current = Math.max(0, pendingCountRef.current - newAssistant.length);
              if (pendingCountRef.current === 0) {
                setIsTyping(false);
                setHasPending(false);
              }
              return fetched;
            }
            return prev;
          });
        })
        .catch(() => {
          /* silent */
        });
    }, 2000);
    return () => {
      clearInterval(interval);
    };
  }, [isTyping, hasPending]);

  /* ---- background sync: catch missed messages every 10s ---- */
  useEffect(() => {
    const interval = setInterval(() => {
      const sid = currentSessionIdRef.current;
      if (!sid) return;
      void authFetch<PaginatedMessages>(
        `/api/v1/chat/sessions/${sid}/messages?limit=${MESSAGE_LIMIT}`,
      )
        .then((res) => {
          const fetched: ChatMessage[] = (Array.isArray(res.data) ? res.data : []).map((m) => ({
            id: m.id,
            role: m.role as ChatMessage['role'],
            content: m.content,
            createdAt: m.createdAt,
          }));
          setMessages((prev) => {
            // Only update if server has messages we don't (skip temp/optimistic)
            const realPrev = prev.filter((m) => !m.id.startsWith('tmp-'));
            if (fetched.length > realPrev.length) {
              const prevIds = new Set(realPrev.map((m) => m.id));
              const newAssistant = fetched.filter(
                (m) => m.role === 'assistant' && !prevIds.has(m.id),
              );
              if (newAssistant.length > 0) {
                pendingCountRef.current = Math.max(
                  0,
                  pendingCountRef.current - newAssistant.length,
                );
                if (pendingCountRef.current === 0) {
                  setIsTyping(false);
                  setHasPending(false);
                }
                return fetched;
              }
            }
            return prev;
          });
        })
        .catch(() => {
          /* silent */
        });
    }, 10_000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  /* ---- lifecycle: fetch sessions when channel ID resolves ---- */
  useEffect(() => {
    if (!channelResolved) return;
    void fetchSessions();
  }, [channelResolved, fetchSessions]);

  return {
    sessions,
    currentSessionId,
    messages,
    isTyping,
    isInitializing,
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
  };
}
