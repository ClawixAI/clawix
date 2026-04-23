import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTelegramAdapter } from '../telegram/telegram.adapter.js';
import type { ChannelAdapterConfig } from '@clawix/shared';

const sendMessageMock = vi.fn().mockResolvedValue({});
const sendChatActionMock = vi.fn().mockResolvedValue({});

vi.mock('grammy', () => {
  return {
    Bot: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      command: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      api: {
        sendMessage: sendMessageMock,
        sendChatAction: sendChatActionMock,
        setWebhook: vi.fn().mockResolvedValue({}),
      },
    })),
  };
});

describe('createTelegramAdapter', () => {
  const config: ChannelAdapterConfig = {
    id: 'channel-1',
    type: 'telegram',
    name: 'Test Bot',
    config: { bot_token: 'test-token-123' },
  };

  beforeEach(() => {
    sendMessageMock.mockClear();
    sendMessageMock.mockResolvedValue({});
  });

  it('creates adapter with correct id and type', () => {
    const adapter = createTelegramAdapter(config);

    expect(adapter.id).toBe('channel-1');
    expect(adapter.type).toBe('telegram');
  });

  it('has all required Channel methods', () => {
    const adapter = createTelegramAdapter(config);

    expect(typeof adapter.connect).toBe('function');
    expect(typeof adapter.disconnect).toBe('function');
    expect(typeof adapter.sendMessage).toBe('function');
    expect(typeof adapter.sendTyping).toBe('function');
    expect(typeof adapter.onMessage).toBe('function');
  });

  it('throws when no bot token is provided', () => {
    const noTokenConfig: ChannelAdapterConfig = {
      id: 'ch-2',
      type: 'telegram',
      name: 'No Token',
      config: {},
    };

    expect(() => createTelegramAdapter(noTokenConfig)).toThrow('bot token');
  });

  it('registers onMessage handler', () => {
    const adapter = createTelegramAdapter(config);
    const handler = vi.fn();

    adapter.onMessage(handler);
    expect(adapter).toBeDefined();
  });

  it('sends long messages as multiple sequential chunks', async () => {
    const adapter = createTelegramAdapter(config);
    // 10_000 chars of plain text — well above the 4096 limit.
    const longText = 'sentence. '.repeat(1_000);

    await adapter.sendMessage({ recipientId: 'chat-1', text: longText });

    expect(sendMessageMock.mock.calls.length).toBeGreaterThan(1);
    for (const call of sendMessageMock.mock.calls) {
      const [, text] = call as [string, string, unknown];
      expect(text.length).toBeLessThanOrEqual(4096);
    }
  });

  it('sends a single call for short messages', async () => {
    const adapter = createTelegramAdapter(config);
    await adapter.sendMessage({ recipientId: 'chat-1', text: 'hello world' });

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it('preserves chunk order (sequential sends)', async () => {
    const adapter = createTelegramAdapter(config);
    const sendOrder: string[] = [];
    sendMessageMock.mockImplementation(async (_chatId: string, text: string) => {
      sendOrder.push(text.slice(0, 10));
      return {};
    });

    const longText = 'AAAA\n\n'.repeat(500) + 'BBBB\n\n'.repeat(500);
    await adapter.sendMessage({ recipientId: 'chat-1', text: longText });

    const firstA = sendOrder.findIndex((s) => s.startsWith('AAAA'));
    const firstB = sendOrder.findIndex((s) => s.startsWith('BBBB'));
    expect(firstA).toBeGreaterThanOrEqual(0);
    expect(firstB).toBeGreaterThan(firstA);
  });

  it('sends plain text (no parse_mode) when MarkdownV2 escaping pushes chunk over 4096', async () => {
    const adapter = createTelegramAdapter(config);
    // 3500 chars of '.' — MarkdownV2 escaping doubles this to 7000 '\.'.
    // splitMessage caps raw at SAFE_SPLIT_LENGTH=3500, so one chunk of 3500 dots.
    const pathological = '.'.repeat(3500);

    await adapter.sendMessage({ recipientId: 'chat-1', text: pathological });

    expect(sendMessageMock).toHaveBeenCalled();
    // Every call must be the plain-text form (no options / no parse_mode).
    for (const call of sendMessageMock.mock.calls) {
      const options = call[2];
      expect(options).toBeUndefined();
    }
  });

  it('falls back to plain text per-chunk when MarkdownV2 send rejects', async () => {
    const adapter = createTelegramAdapter(config);
    sendMessageMock.mockImplementationOnce(async () => {
      throw new Error("Bad Request: can't parse entities");
    });

    await adapter.sendMessage({ recipientId: 'chat-1', text: 'hello _unbalanced' });

    // First call rejected (MarkdownV2), second call retries as plain text.
    expect(sendMessageMock.mock.calls.length).toBe(2);
    expect(sendMessageMock.mock.calls[0]![2]).toEqual({ parse_mode: 'MarkdownV2' });
    expect(sendMessageMock.mock.calls[1]![2]).toBeUndefined();
  });
});
