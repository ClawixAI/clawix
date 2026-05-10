import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { createLogger } from '@clawix/shared';

import type { WebAdapterExtended } from './web.adapter.js';
import { serializeServerMessage } from './web.protocol.js';

const logger = createLogger('channels:web:gateway');

const HEARTBEAT_INTERVAL = 30_000;

interface SocketWithAlive extends WebSocket {
  isAlive?: boolean;
  heartbeatInterval?: ReturnType<typeof setInterval>;
}

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  policyName: string;
}

/**
 * WebSocket gateway for the web channel.
 * Uses raw `ws` library for Fastify compatibility instead of @WebSocketGateway decorator.
 */
@Injectable()
export class WebChatGateway implements OnModuleInit, OnModuleDestroy {
  private adapter: WebAdapterExtended | null = null;
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  onModuleInit(): void {
    const server = this.httpAdapterHost.httpAdapter.getHttpServer();
    // noServer mode: we manually route only matching paths so that other
    // WebSocketServers (e.g. /ws/notifications) can coexist on the same
    // HTTP server without one tearing down the other's upgrade.
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      this.handleConnection(socket, req);
    });

    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws/chat') return;
      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        this.wss?.emit('connection', ws, req);
      });
    });

    logger.info('WebSocket server listening on /ws/chat');
  }

  onModuleDestroy(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
      logger.info('WebSocket server closed');
    }
  }

  setAdapter(adapter: WebAdapterExtended): void {
    this.adapter = adapter;
  }

  async handleConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
    const token = this.extractToken(req);

    if (!token) {
      logger.warn('WebSocket connection rejected — no token');
      socket.close(4001, 'unauthorized');
      return;
    }

    let payload: JwtPayload;
    try {
      const secret = this.configService.getOrThrow<string>('JWT_SECRET');
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, { secret });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ error: msg }, 'WebSocket connection rejected — invalid JWT');
      socket.close(4001, 'unauthorized');
      return;
    }

    const userId = payload.sub;
    const userName = payload.email;

    if (!this.adapter) {
      logger.warn('WebSocket connection rejected — adapter not initialized');
      socket.close(4003, 'service_unavailable');
      return;
    }

    const adapter = this.adapter;
    const extSocket = socket as SocketWithAlive;

    const added = adapter.addConnection(userId, socket);
    if (!added) {
      socket.close(4002, 'connection_limit_exceeded');
      return;
    }

    socket.send(
      serializeServerMessage({
        type: 'connection.ack',
        payload: { userId },
      }),
    );

    // Server-side heartbeat to detect dead connections
    extSocket.isAlive = true;
    socket.on('pong', () => {
      extSocket.isAlive = true;
    });
    extSocket.heartbeatInterval = setInterval(() => {
      if (!extSocket.isAlive) {
        logger.info({ userId }, 'WebSocket terminated — no pong received');
        socket.terminate();
        return;
      }
      extSocket.isAlive = false;
      socket.ping();
    }, HEARTBEAT_INTERVAL);

    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      void (async () => {
        try {
          const raw = typeof data === 'string' ? data : data.toString();
          await adapter.handleClientMessage(userId, userName, raw);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error({ userId, error: msg }, 'Error handling WebSocket message');
          if (socket.readyState === 1) {
            socket.send(
              serializeServerMessage({
                type: 'error',
                payload: { code: 'INTERNAL_ERROR', message: 'Failed to process message' },
              }),
            );
          }
        }
      })();
    });

    socket.on('error', (err: Error) => {
      logger.error({ userId, error: err.message }, 'WebSocket error');
    });

    socket.on('close', () => {
      logger.info({ userId }, 'WebSocket connection closed');
      if (extSocket.heartbeatInterval) clearInterval(extSocket.heartbeatInterval);
      adapter.removeConnection(userId, socket);
    });
  }

  private extractToken(req: IncomingMessage): string | null {
    const url = new URL(req.url ?? '', 'http://localhost');
    return url.searchParams.get('token');
  }
}
