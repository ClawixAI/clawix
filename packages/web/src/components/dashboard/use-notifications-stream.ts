'use client';

import { useEffect, useRef } from 'react';

import { getAccessToken } from '@/lib/auth';
import type { Notification } from '@/lib/api/notifications';

interface Options {
  onNotification: (n: Notification) => void;
  enabled?: boolean;
}

const PING_INTERVAL_MS = 30_000;
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Long-lived WebSocket subscription to `/ws/notifications`. Re-connects
 * with exponential backoff (capped at 30s) on close. The callback is
 * fired once per `notification.created` event.
 *
 * The bell still polls REST every 30s — WS is supplementary for low-
 * latency push, but the row in Postgres is the source of truth and the
 * REST refresh fills any gap if the socket was down.
 */
export function useNotificationsStream({ onNotification, enabled = true }: Options): void {
  const handlerRef = useRef(onNotification);
  handlerRef.current = onNotification;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let ws: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = RECONNECT_INITIAL_MS;

    const buildUrl = (token: string) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const base =
        process.env['NEXT_PUBLIC_WS_URL'] || `${protocol}//${window.location.hostname}:3001`;
      return `${base}/ws/notifications?token=${encodeURIComponent(token)}`;
    };

    const connect = async () => {
      if (stopped) return;
      const token = await getAccessToken();
      if (stopped) return;
      if (!token) {
        // Not signed in yet — try again later.
        reconnectTimer = setTimeout(() => void connect(), RECONNECT_INITIAL_MS);
        return;
      }

      ws = new WebSocket(buildUrl(token));

      ws.onopen = () => {
        backoff = RECONNECT_INITIAL_MS;
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as { type: string; payload: unknown };
          if (msg.type === 'notification.created') {
            handlerRef.current(msg.payload as Notification);
          }
        } catch {
          // Ignore malformed frames.
        }
      };

      ws.onclose = () => {
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (stopped) return;
        reconnectTimer = setTimeout(() => void connect(), backoff);
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      };

      ws.onerror = () => {
        // Errors generally precede a close — let onclose handle reconnect.
      };
    };

    void connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
    };
  }, [enabled]);
}
