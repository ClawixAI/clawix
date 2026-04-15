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

/**
 * Extended channel adapter interface for the web (WebSocket) channel.
 * Adds connection lifecycle methods used by the WebSocket gateway.
 */
export interface WebAdapterExtended extends ChannelAdapter {
  /** Add a WebSocket connection for a user (multi-tab support). */
  addConnection(userId: string, socket: WebSocket): void;
  /** Remove a specific WebSocket connection for a user. */
  removeConnection(userId: string, socket: WebSocket): void;
  /** Return the number of open connections for a user. */
  getConnectionCount(userId: string): number;
  /**
   * Parse and dispatch a raw client message received on a WebSocket.
   * Handles ping/pong internally; routes message.send to the registered handler.
   */
  handleClientMessage(userId: string, userName: string, raw: string): Promise<void>;
}

/**
 * Create a web channel adapter backed by WebSockets.
 * Maintains a per-user set of connections to support multiple browser tabs.
 */
export function createWebAdapter(config: ChannelAdapterConfig): WebAdapterExtended {
  const connections = new Map<string, Set<WebSocket>>();
  let messageHandler: MessageHandler | null = null;

  function sendToUser(userId: string, payload: string): void {
    const sockets = connections.get(userId);
    if (!sockets) return;
    for (const ws of sockets) {
      if (ws.readyState === 1) {
        ws.send(payload);
      }
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

    addConnection(userId: string, socket: WebSocket): void {
      let sockets = connections.get(userId);
      if (!sockets) {
        sockets = new Set<WebSocket>();
        connections.set(userId, sockets);
      }
      sockets.add(socket);
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

    async handleClientMessage(userId: string, userName: string, raw: string): Promise<void> {
      const parsed = parseClientMessage(raw);

      if (!parsed) {
        logger.warn({ userId }, 'Received invalid client message');
        const errorPayload = serializeServerMessage({
          type: 'error',
          payload: { code: 'INVALID_MESSAGE', message: 'Invalid or unrecognized message format' },
        });
        sendToUser(userId, errorPayload);
        return;
      }

      if (parsed.type === 'ping') {
        const pong = serializeServerMessage({ type: 'pong', payload: {} });
        sendToUser(userId, pong);
        return;
      }

      if (parsed.type === 'message.send') {
        if (!messageHandler) {
          logger.warn({ userId }, 'No message handler registered, ignoring message.send');
          return;
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
        } catch (error: unknown) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error({ userId, error: errorMsg }, 'Error handling web message');
        }
      }
    },
  };

  return adapter;
}
