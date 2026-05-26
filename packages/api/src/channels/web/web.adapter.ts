import type { WebSocket } from 'ws';
import { createLogger } from '@clawix/shared';
import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  InboundMessage,
  MessageHandler,
  OutboundMessage,
} from '@clawix/shared';

import { parseClientMessage, serializeServerMessage } from './web.protocol.js';

const logger = createLogger('channels:web');

const MAX_CONNECTIONS_PER_USER = 10;
const MAX_MESSAGES_PER_MINUTE = 30;

/**
 * Extended channel adapter interface for the web (WebSocket) channel.
 * Adds connection lifecycle methods used by the WebSocket gateway.
 */
export interface WebAdapterExtended extends ChannelAdapter {
  /** Add a WebSocket connection for a user (multi-tab support). Returns false if limit exceeded. */
  addConnection(userId: string, socket: WebSocket): boolean;
  /** Remove a specific WebSocket connection for a user. */
  removeConnection(userId: string, socket: WebSocket): void;
  /** Return the number of open connections for a user. */
  getConnectionCount(userId: string): number;
  /**
   * Parse and dispatch a raw client message received on a WebSocket.
   * Handles ping/pong internally; routes message.send to the registered handler.
   * Returns false if rate limited.
   */
  handleClientMessage(userId: string, userName: string, raw: string): Promise<boolean>;
}

/**
 * Create a web channel adapter backed by WebSockets.
 * Maintains a per-user set of connections to support multiple browser tabs.
 */
export function createWebAdapter(config: ChannelAdapterConfig): WebAdapterExtended {
  const connections = new Map<string, Set<WebSocket>>();
  const rateLimits = new Map<string, { count: number; resetAt: number }>();
  let messageHandler: MessageHandler | null = null;

  function sendToUser(userId: string, payload: string): void {
    const sockets = connections.get(userId);
    if (!sockets || sockets.size === 0) {
      logger.debug({ userId }, 'No sockets for user');
      return;
    }

    logger.debug({ userId, socketCount: sockets.size }, 'Sending to user sockets');

    for (const ws of sockets) {
      try {
        if (ws.readyState === 1) {
          ws.send(payload);
        } else {
          logger.warn(
            { userId, readyState: ws.readyState },
            'Socket not open, removing stale connection',
          );
          sockets.delete(ws);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ userId, error: msg }, 'Failed to send to socket, removing');
        sockets.delete(ws);
      }
    }

    // Clean up empty set
    if (sockets.size === 0) {
      connections.delete(userId);
    }
  }

  const adapter: WebAdapterExtended = {
    id: config.id,
    type: 'web',

    async connect(): Promise<void> {
      logger.info('Web adapter ready');
    },

    async disconnect(): Promise<void> {
      logger.info('Disconnecting web adapter — closing all sockets');
      for (const sockets of connections.values()) {
        for (const ws of sockets) {
          ws.close();
        }
      }
      connections.clear();
    },

    async sendMessage(message: OutboundMessage): Promise<void> {
      const messageId = (message.metadata?.['messageId'] as string | undefined) ?? '';
      const sessionId = (message.metadata?.['sessionId'] as string | undefined) ?? '';
      const event = message.metadata?.['event'] as string | undefined;

      logger.info(
        { recipientId: message.recipientId, messageId, sessionId, event },
        'Sending message to user',
      );

      const payload = serializeServerMessage({
        type: 'message.create',
        payload: {
          messageId,
          sessionId,
          content: message.text,
          timestamp: new Date().toISOString(),
        },
      });

      sendToUser(message.recipientId, payload);

      // For session-altering commands (currently only `/reset`), follow the
      // text reply with a structured event frame so the chat client can
      // react deterministically — see web.protocol's `session.reset` type
      // and use-chat's handler. The text frame above is still delivered so
      // the user sees a confirmation in the transcript.
      if (event === 'session.reset') {
        sendToUser(
          message.recipientId,
          serializeServerMessage({
            type: 'session.reset',
            payload: { sessionId },
          }),
        );
      }
    },

    async sendError(recipientId: string, code: string, message: string): Promise<void> {
      logger.info({ recipientId, code }, 'Sending error to user');
      const payload = serializeServerMessage({
        type: 'error',
        payload: { code, message },
      });
      sendToUser(recipientId, payload);
    },

    async sendTyping(recipientId: string): Promise<void> {
      const payload = serializeServerMessage({
        type: 'typing.start',
        payload: {},
      });
      sendToUser(recipientId, payload);
    },

    async sendTypingStop(recipientId: string): Promise<void> {
      const payload = serializeServerMessage({
        type: 'typing.stop',
        payload: {},
      });
      sendToUser(recipientId, payload);
    },

    onMessage(handler: MessageHandler): void {
      messageHandler = handler;
    },

    addConnection(userId: string, socket: WebSocket): boolean {
      let sockets = connections.get(userId);
      if (!sockets) {
        sockets = new Set<WebSocket>();
        connections.set(userId, sockets);
      }
      if (sockets.size >= MAX_CONNECTIONS_PER_USER) {
        logger.warn({ userId, count: sockets.size }, 'Connection limit exceeded');
        return false;
      }
      sockets.add(socket);
      return true;
    },

    removeConnection(userId: string, socket: WebSocket): void {
      const sockets = connections.get(userId);
      if (!sockets) return;
      sockets.delete(socket);
      if (sockets.size === 0) {
        connections.delete(userId);
      }
    },

    getConnectionCount(userId: string): number {
      return connections.get(userId)?.size ?? 0;
    },

    async handleClientMessage(userId: string, userName: string, raw: string): Promise<boolean> {
      const parsed = parseClientMessage(raw);

      if (!parsed) {
        logger.warn({ userId }, 'Received invalid client message');
        const errorPayload = serializeServerMessage({
          type: 'error',
          payload: { code: 'INVALID_MESSAGE', message: 'Invalid or unrecognized message format' },
        });
        sendToUser(userId, errorPayload);
        return false;
      }

      if (parsed.type === 'ping') {
        const pong = serializeServerMessage({ type: 'pong', payload: {} });
        sendToUser(userId, pong);
        return true;
      }

      if (parsed.type === 'message.send') {
        // Rate limiting
        const now = Date.now();
        const limit = rateLimits.get(userId) ?? { count: 0, resetAt: now + 60_000 };
        if (now > limit.resetAt) {
          limit.count = 0;
          limit.resetAt = now + 60_000;
        }
        if (limit.count >= MAX_MESSAGES_PER_MINUTE) {
          logger.warn({ userId }, 'Rate limit exceeded');
          sendToUser(
            userId,
            serializeServerMessage({
              type: 'error',
              payload: { code: 'RATE_LIMITED', message: 'Too many messages, please slow down' },
            }),
          );
          return false;
        }
        limit.count++;
        rateLimits.set(userId, limit);

        if (!messageHandler) {
          logger.warn({ userId }, 'No message handler registered, ignoring message.send');
          return false;
        }

        const inbound: InboundMessage = {
          channelType: 'web',
          channelMessageId: `web-${crypto.randomUUID()}`,
          senderId: userId,
          senderName: userName,
          text: parsed.payload.content,
          timestamp: new Date(),
        };

        try {
          await messageHandler(inbound);
          return true;
        } catch (error: unknown) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error({ userId, error: errorMsg }, 'Error handling web message');
          return false;
        }
      }

      return true;
    },
  };

  return adapter;
}
