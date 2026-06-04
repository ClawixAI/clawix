import { describe, expect, it, vi } from 'vitest';

import { createWebAdapter } from '../web.adapter.js';
import type { ChannelAdapterConfig, InboundMessage } from '@clawix/shared';

describe('Web channel integration', () => {
  const config: ChannelAdapterConfig = {
    id: 'web-ch-int',
    type: 'web',
    name: 'Web Dashboard',
    config: {},
  };

  it('full message flow: connect → send → receive response', async () => {
    const adapter = createWebAdapter(config);
    const receivedMessages: InboundMessage[] = [];

    adapter.onMessage(async (message: InboundMessage) => {
      receivedMessages.push(message);
    });

    const mockWs = { readyState: 1, send: vi.fn(), close: vi.fn() };
    adapter.addConnection('user-1', mockWs as never);

    const clientMsg = JSON.stringify({
      type: 'message.send',
      payload: { content: 'Hello agent' },
    });

    await adapter.handleClientMessage('user-1', 'test@example.com', clientMsg);

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]!.channelType).toBe('web');
    expect(receivedMessages[0]!.senderId).toBe('user-1');
    expect(receivedMessages[0]!.senderName).toBe('test@example.com');
    expect(receivedMessages[0]!.text).toBe('Hello agent');

    await adapter.sendMessage({
      recipientId: 'user-1',
      text: 'Hello human!',
      metadata: { messageId: 'msg-resp-1', sessionId: 'sess-1' },
    });

    expect(mockWs.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(mockWs.send.mock.calls[0]![0] as string);
    expect(sent.type).toBe('message.create');
    expect(sent.payload.content).toBe('Hello human!');
  });

  it('multi-tab: both connections receive the response', async () => {
    const adapter = createWebAdapter(config);

    const ws1 = { readyState: 1, send: vi.fn(), close: vi.fn() };
    const ws2 = { readyState: 1, send: vi.fn(), close: vi.fn() };

    adapter.addConnection('user-1', ws1 as never);
    adapter.addConnection('user-1', ws2 as never);

    await adapter.sendMessage({
      recipientId: 'user-1',
      text: 'Response',
      metadata: { messageId: 'msg-1', sessionId: 'sess-1' },
    });

    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).toHaveBeenCalledTimes(1);
  });

  it('disconnected user: sendMessage does not throw', async () => {
    const adapter = createWebAdapter(config);

    await expect(
      adapter.sendMessage({
        recipientId: 'user-1',
        text: 'Nobody home',
        metadata: { messageId: 'msg-1', sessionId: 'sess-1' },
      }),
    ).resolves.toBe('msg-1');
  });

  it('ping responds with pong', async () => {
    const adapter = createWebAdapter(config);
    const ws = { readyState: 1, send: vi.fn(), close: vi.fn() };

    adapter.addConnection('user-1', ws as never);
    adapter.onMessage(vi.fn());

    await adapter.handleClientMessage(
      'user-1',
      'test@example.com',
      JSON.stringify({ type: 'ping', payload: {} }),
    );

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string);
    expect(sent.type).toBe('pong');
  });

  it('invalid message sends error to client', async () => {
    const adapter = createWebAdapter(config);
    const ws = { readyState: 1, send: vi.fn(), close: vi.fn() };

    adapter.addConnection('user-1', ws as never);
    adapter.onMessage(vi.fn());

    await adapter.handleClientMessage('user-1', 'test@example.com', 'not json');

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string);
    expect(sent.type).toBe('error');
    expect(sent.payload.code).toBe('INVALID_MESSAGE');
  });
});
