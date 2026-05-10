import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { createLogger } from '@clawix/shared';

import type { Notification } from '../generated/prisma/client.js';

const logger = createLogger('notifications:gateway');

const HEARTBEAT_INTERVAL_MS = 30_000;
const PATH = '/ws/notifications';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

interface AliveSocket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
  heartbeat?: ReturnType<typeof setInterval>;
}

/**
 * WebSocket fan-out for `Notification` rows. One socket per browser tab,
 * keyed by JWT-verified user id; `sendToUser` broadcasts to every open
 * socket for that user (so multi-tab users see new invites simultaneously).
 *
 * Mirrors the WebChatGateway pattern: raw `ws` library bound to the same
 * Fastify server, JWT in the `?token=` query string, 30s heartbeat with
 * dead-socket reaping.
 */
@Injectable()
export class NotificationsGateway implements OnModuleInit, OnModuleDestroy {
  private wss: WebSocketServer | null = null;
  private readonly userSockets = new Map<string, Set<AliveSocket>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  onModuleInit(): void {
    const server = this.httpAdapterHost.httpAdapter.getHttpServer();
    // Use noServer so we don't fight other WebSocketServers (the chat
    // gateway on /ws/chat is already attached to the same HTTP server).
    // We only claim upgrades whose path is ours; everything else falls
    // through to other listeners.
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      void this.handleConnection(socket as AliveSocket, req);
    });
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== PATH) return;
      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        this.wss?.emit('connection', ws, req);
      });
    });
    logger.info(`WebSocket server listening on ${PATH}`);
  }

  onModuleDestroy(): void {
    for (const set of this.userSockets.values()) {
      for (const s of set) s.close(1001, 'server_shutdown');
    }
    this.userSockets.clear();
    this.wss?.close();
    this.wss = null;
  }

  /** Broadcast a JSON event to every open socket owned by `userId`. */
  sendToUser(userId: string, event: { type: string; payload: unknown }): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets || sockets.size === 0) return;
    const data = JSON.stringify(event);
    for (const s of sockets) {
      if (s.readyState === s.OPEN) s.send(data);
    }
  }

  /** Convenience helper for the fanout service. */
  notify(userId: string, notification: Notification): void {
    this.sendToUser(userId, { type: 'notification.created', payload: notification });
  }

  private async handleConnection(socket: AliveSocket, req: IncomingMessage): Promise<void> {
    const token = this.extractToken(req);
    if (!token) {
      socket.close(4001, 'unauthorized');
      return;
    }

    let payload: JwtPayload;
    try {
      const secret = this.configService.getOrThrow<string>('JWT_SECRET');
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, { secret });
    } catch {
      socket.close(4001, 'unauthorized');
      return;
    }

    socket.userId = payload.sub;
    socket.isAlive = true;
    this.attach(payload.sub, socket);

    socket.on('pong', () => {
      socket.isAlive = true;
    });
    socket.on('message', (raw) => this.handleMessage(socket, raw.toString()));
    socket.on('close', () => this.detach(socket));
    socket.on('error', (err) => {
      logger.warn({ err: err.message, userId: payload.sub }, 'notifications socket error');
    });

    socket.heartbeat = setInterval(() => {
      if (!socket.isAlive) {
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }, HEARTBEAT_INTERVAL_MS);

    socket.send(JSON.stringify({ type: 'connected', payload: {} }));
  }

  private handleMessage(socket: AliveSocket, raw: string): void {
    try {
      const msg = JSON.parse(raw) as { type?: string };
      if (msg.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', payload: {} }));
      }
    } catch {
      // Ignore malformed frames — clients shouldn't send anything but ping.
    }
  }

  private attach(userId: string, socket: AliveSocket): void {
    let set = this.userSockets.get(userId);
    if (!set) {
      set = new Set();
      this.userSockets.set(userId, set);
    }
    set.add(socket);
  }

  private detach(socket: AliveSocket): void {
    if (socket.heartbeat) clearInterval(socket.heartbeat);
    if (!socket.userId) return;
    const set = this.userSockets.get(socket.userId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.userSockets.delete(socket.userId);
  }

  private extractToken(req: IncomingMessage): string | null {
    const url = new URL(req.url ?? '/', 'http://localhost');
    return url.searchParams.get('token');
  }
}
