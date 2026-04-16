import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChannelAdapterConfig } from '@clawix/shared';
import { createWebAdapter, type WebAdapterExtended } from '../web.adapter.js';

// Mock logger
vi.mock('@clawix/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clawix/shared')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

function makeMockSocket(readyState = 1): {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return { readyState, send: vi.fn(), close: vi.fn() };
}

const config: ChannelAdapterConfig = {
  id: 'web-1',
  type: 'web',
  name: 'Web Channel',
  config: {},
};

describe('createWebAdapter', () => {
  let adapter: WebAdapterExtended;

  beforeEach(() => {
    adapter = createWebAdapter(config);
  });

  it('creates adapter with correct id and type', () => {
    expect(adapter.id).toBe('web-1');
    expect(adapter.type).toBe('web');
  });

  it('has all required ChannelAdapter methods', () => {
    expect(typeof adapter.connect).toBe('function');
    expect(typeof adapter.disconnect).toBe('function');
    expect(typeof adapter.sendMessage).toBe('function');
    expect(typeof adapter.sendTyping).toBe('function');
    expect(typeof adapter.onMessage).toBe('function');
  });

  it('has extended connection management methods', () => {
    expect(typeof adapter.addConnection).toBe('function');
    expect(typeof adapter.removeConnection).toBe('function');
    expect(typeof adapter.getConnectionCount).toBe('function');
    expect(typeof adapter.handleClientMessage).toBe('function');
  });

  describe('connect()', () => {
    it('resolves without error (no-op)', async () => {
      await expect(adapter.connect()).resolves.toBeUndefined();
    });
  });

  describe('connection management', () => {
    it('adds a connection and reports correct count', () => {
      const socket = makeMockSocket();
      adapter.addConnection('user-1', socket as never);
      expect(adapter.getConnectionCount('user-1')).toBe(1);
    });

    it('supports multi-tab (multiple sockets per user)', () => {
      const s1 = makeMockSocket();
      const s2 = makeMockSocket();
      adapter.addConnection('user-1', s1 as never);
      adapter.addConnection('user-1', s2 as never);
      expect(adapter.getConnectionCount('user-1')).toBe(2);
    });

    it('removes a specific connection', () => {
      const s1 = makeMockSocket();
      const s2 = makeMockSocket();
      adapter.addConnection('user-1', s1 as never);
      adapter.addConnection('user-1', s2 as never);
      adapter.removeConnection('user-1', s1 as never);
      expect(adapter.getConnectionCount('user-1')).toBe(1);
    });

    it('cleans up empty sets after last connection removed', () => {
      const socket = makeMockSocket();
      adapter.addConnection('user-1', socket as never);
      adapter.removeConnection('user-1', socket as never);
      expect(adapter.getConnectionCount('user-1')).toBe(0);
    });

    it('returns 0 for unknown user', () => {
      expect(adapter.getConnectionCount('unknown')).toBe(0);
    });
  });

  describe('disconnect()', () => {
    it('closes all WebSocket connections and clears map', async () => {
      const s1 = makeMockSocket();
      const s2 = makeMockSocket();
      adapter.addConnection('user-1', s1 as never);
      adapter.addConnection('user-2', s2 as never);

      await adapter.disconnect();

      expect(s1.close).toHaveBeenCalledOnce();
      expect(s2.close).toHaveBeenCalledOnce();
      expect(adapter.getConnectionCount('user-1')).toBe(0);
      expect(adapter.getConnectionCount('user-2')).toBe(0);
    });

    it('resolves without error when no connections exist', async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('sendMessage()', () => {
    it('sends message.create to all open sockets for recipient', async () => {
      const s1 = makeMockSocket();
      const s2 = makeMockSocket();
      adapter.addConnection('user-1', s1 as never);
      adapter.addConnection('user-1', s2 as never);

      await adapter.sendMessage({
        recipientId: 'user-1',
        text: 'Hello!',
        metadata: { messageId: 'msg-123', sessionId: 'sess-456' },
      });

      expect(s1.send).toHaveBeenCalledOnce();
      expect(s2.send).toHaveBeenCalledOnce();

      const payload = JSON.parse(s1.send.mock.calls[0]![0] as string) as {
        type: string;
        payload: { messageId: string; sessionId: string; content: string; timestamp: string };
      };
      expect(payload.type).toBe('message.create');
      expect(payload.payload.messageId).toBe('msg-123');
      expect(payload.payload.sessionId).toBe('sess-456');
      expect(payload.payload.content).toBe('Hello!');
      expect(typeof payload.payload.timestamp).toBe('string');
    });

    it('skips closed sockets (readyState !== 1)', async () => {
      const openSocket = makeMockSocket(1);
      const closedSocket = makeMockSocket(3); // CLOSED
      adapter.addConnection('user-1', openSocket as never);
      adapter.addConnection('user-1', closedSocket as never);

      await adapter.sendMessage({
        recipientId: 'user-1',
        text: 'Hi',
        metadata: { messageId: 'msg-1', sessionId: 'sess-1' },
      });

      expect(openSocket.send).toHaveBeenCalledOnce();
      expect(closedSocket.send).not.toHaveBeenCalled();
    });

    it('does not throw when recipient has no connections', async () => {
      await expect(
        adapter.sendMessage({
          recipientId: 'nobody',
          text: 'Hi',
          metadata: { messageId: 'm1', sessionId: 's1' },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('sendTyping()', () => {
    it('sends typing.start to all open sockets for recipient', async () => {
      const socket = makeMockSocket();
      adapter.addConnection('user-1', socket as never);

      await adapter.sendTyping!('user-1');

      expect(socket.send).toHaveBeenCalledOnce();
      const payload = JSON.parse(socket.send.mock.calls[0]![0] as string) as { type: string };
      expect(payload.type).toBe('typing.start');
    });

    it('does not throw for unknown recipient', async () => {
      await expect(adapter.sendTyping!('nobody')).resolves.toBeUndefined();
    });
  });

  describe('onMessage() and handleClientMessage()', () => {
    it('stores the message handler', () => {
      const handler = vi.fn();
      adapter.onMessage(handler);
      // No error thrown — handler is stored
    });

    it('handleClientMessage handles ping with pong response', async () => {
      const socket = makeMockSocket();
      adapter.addConnection('user-1', socket as never);

      await adapter.handleClientMessage(
        'user-1',
        'Alice',
        JSON.stringify({ type: 'ping', payload: {} }),
      );

      expect(socket.send).toHaveBeenCalledOnce();
      const payload = JSON.parse(socket.send.mock.calls[0]![0] as string) as { type: string };
      expect(payload.type).toBe('pong');
    });

    it('handleClientMessage handles message.send and calls handler', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.onMessage(handler);

      await adapter.handleClientMessage(
        'user-1',
        'Alice',
        JSON.stringify({ type: 'message.send', payload: { content: 'Hello world' } }),
      );

      expect(handler).toHaveBeenCalledOnce();
      const inbound = handler.mock.calls[0]![0] as {
        channelType: string;
        senderId: string;
        senderName: string;
        text: string;
      };
      expect(inbound.channelType).toBe('web');
      expect(inbound.senderId).toBe('user-1');
      expect(inbound.senderName).toBe('Alice');
      expect(inbound.text).toBe('Hello world');
    });

    it('handleClientMessage sends error for invalid message', async () => {
      const socket = makeMockSocket();
      adapter.addConnection('user-1', socket as never);

      await adapter.handleClientMessage('user-1', 'Alice', 'not-valid-json{{{');

      expect(socket.send).toHaveBeenCalledOnce();
      const payload = JSON.parse(socket.send.mock.calls[0]![0] as string) as {
        type: string;
        payload: { code: string };
      };
      expect(payload.type).toBe('error');
      expect(payload.payload.code).toBe('INVALID_MESSAGE');
    });

    it('handleClientMessage does not throw when no handler registered for message.send', async () => {
      await expect(
        adapter.handleClientMessage(
          'user-1',
          'Alice',
          JSON.stringify({ type: 'message.send', payload: { content: 'Hi' } }),
        ),
      ).resolves.toBeUndefined();
    });
  });
});
