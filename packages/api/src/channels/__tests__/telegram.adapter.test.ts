import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTelegramAdapter } from '../telegram/telegram.adapter.js';
import type { ChannelAdapterConfig } from '@clawix/shared';

const sendMessageMock = vi.fn().mockResolvedValue({ message_id: 100 });
const sendChatActionMock = vi.fn().mockResolvedValue({});
const editMessageTextMock = vi.fn().mockResolvedValue({});

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
        editMessageText: editMessageTextMock,
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
    sendMessageMock.mockResolvedValue({ message_id: 100 });
    editMessageTextMock.mockClear();
    editMessageTextMock.mockResolvedValue({});
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

  describe('reply threading (reply_to_mode)', () => {
    const replyParams = (call: unknown[]): unknown =>
      (call[2] as { reply_parameters?: unknown } | undefined)?.reply_parameters;

    it('threads the first chunk to the inbound message by default ("first")', async () => {
      const adapter = createTelegramAdapter(config);
      // Long enough to split into multiple chunks.
      const longText = 'sentence. '.repeat(1_000);

      await adapter.sendMessage({
        recipientId: 'chat-1',
        text: longText,
        metadata: { replyToMessageId: '42' },
      });

      expect(sendMessageMock.mock.calls.length).toBeGreaterThan(1);
      // First chunk threads; later chunks do not.
      expect(replyParams(sendMessageMock.mock.calls[0]!)).toEqual({
        message_id: 42,
        allow_sending_without_reply: true,
      });
      for (const call of sendMessageMock.mock.calls.slice(1)) {
        expect(replyParams(call)).toBeUndefined();
      }
    });

    it('threads every chunk when reply_to_mode="all"', async () => {
      const adapter = createTelegramAdapter({
        ...config,
        config: { ...config.config, reply_to_mode: 'all' },
      });
      const longText = 'sentence. '.repeat(1_000);

      await adapter.sendMessage({
        recipientId: 'chat-1',
        text: longText,
        metadata: { replyToMessageId: '42' },
      });

      expect(sendMessageMock.mock.calls.length).toBeGreaterThan(1);
      for (const call of sendMessageMock.mock.calls) {
        expect(replyParams(call)).toEqual({
          message_id: 42,
          allow_sending_without_reply: true,
        });
      }
    });

    it('never threads when reply_to_mode="off"', async () => {
      const adapter = createTelegramAdapter({
        ...config,
        config: { ...config.config, reply_to_mode: 'off' },
      });

      await adapter.sendMessage({
        recipientId: 'chat-1',
        text: 'hello world',
        metadata: { replyToMessageId: '42' },
      });

      expect(replyParams(sendMessageMock.mock.calls[0]!)).toBeUndefined();
    });

    it('does not thread when no replyToMessageId is supplied', async () => {
      const adapter = createTelegramAdapter(config);

      await adapter.sendMessage({ recipientId: 'chat-1', text: 'hello world' });

      expect(replyParams(sendMessageMock.mock.calls[0]!)).toBeUndefined();
    });

    it('ignores a non-numeric / invalid reply anchor', async () => {
      const adapter = createTelegramAdapter(config);

      await adapter.sendMessage({
        recipientId: 'chat-1',
        text: 'hello world',
        metadata: { replyToMessageId: 'not-a-number' },
      });

      expect(replyParams(sendMessageMock.mock.calls[0]!)).toBeUndefined();
    });

    it('falls back to "first" for an unknown reply_to_mode value', async () => {
      const adapter = createTelegramAdapter({
        ...config,
        config: { ...config.config, reply_to_mode: 'bogus' },
      });

      await adapter.sendMessage({
        recipientId: 'chat-1',
        text: 'hello world',
        metadata: { replyToMessageId: '7' },
      });

      expect(replyParams(sendMessageMock.mock.calls[0]!)).toEqual({
        message_id: 7,
        allow_sending_without_reply: true,
      });
    });

    it('carries reply_parameters alongside parse_mode on the MarkdownV2 path', async () => {
      const adapter = createTelegramAdapter(config);

      await adapter.sendMessage({
        recipientId: 'chat-1',
        text: 'hello world',
        metadata: { replyToMessageId: '99' },
      });

      expect(sendMessageMock.mock.calls[0]![2]).toEqual({
        parse_mode: 'MarkdownV2',
        reply_parameters: { message_id: 99, allow_sending_without_reply: true },
      });
    });
  });

  describe('message ids and editMessage (edit-in-place)', () => {
    it('returns the sent message id as a string', async () => {
      const adapter = createTelegramAdapter(config);
      sendMessageMock.mockResolvedValueOnce({ message_id: 4242 });

      const id = await adapter.sendMessage({ recipientId: 'chat-1', text: 'hi' });

      expect(id).toBe('4242');
    });

    it('returns the last chunk id when the text is split', async () => {
      const adapter = createTelegramAdapter(config);
      let n = 0;
      sendMessageMock.mockImplementation(async () => ({ message_id: ++n }));

      const longText = 'sentence. '.repeat(1_000);
      const id = await adapter.sendMessage({ recipientId: 'chat-1', text: longText });

      expect(Number(id)).toBe(n);
      expect(n).toBeGreaterThan(1);
    });

    it('returns undefined for empty text (nothing sent)', async () => {
      const adapter = createTelegramAdapter(config);

      const id = await adapter.sendMessage({ recipientId: 'chat-1', text: '' });

      expect(id).toBeUndefined();
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('exposes editMessage that calls editMessageText with MarkdownV2', async () => {
      const adapter = createTelegramAdapter(config);

      await adapter.editMessage!('chat-1', '100', 'updated bubble');

      expect(editMessageTextMock).toHaveBeenCalledTimes(1);
      const [chatId, messageId, , options] = editMessageTextMock.mock.calls[0]!;
      expect(chatId).toBe('chat-1');
      expect(messageId).toBe(100);
      expect(options).toEqual({ parse_mode: 'MarkdownV2' });
    });

    it('retries editMessageText as plain text when MarkdownV2 rejects', async () => {
      const adapter = createTelegramAdapter(config);
      editMessageTextMock.mockImplementationOnce(async () => {
        throw new Error("Bad Request: can't parse entities");
      });

      await adapter.editMessage!('chat-1', '100', 'has _bad markdown');

      expect(editMessageTextMock).toHaveBeenCalledTimes(2);
      // Second (retry) call has no parse_mode options arg.
      expect(editMessageTextMock.mock.calls[1]![3]).toBeUndefined();
    });

    it('swallows the "message is not modified" no-op error', async () => {
      const adapter = createTelegramAdapter(config);
      editMessageTextMock.mockImplementationOnce(async () => {
        throw new Error('Bad Request: message is not modified');
      });

      await expect(adapter.editMessage!('chat-1', '100', 'same')).resolves.toBeUndefined();
      // No plain-text retry for a not-modified no-op.
      expect(editMessageTextMock).toHaveBeenCalledTimes(1);
    });

    it('ignores a non-numeric message id', async () => {
      const adapter = createTelegramAdapter(config);

      await adapter.editMessage!('chat-1', 'not-a-number', 'x');

      expect(editMessageTextMock).not.toHaveBeenCalled();
    });

    it('throws (no API call) when the text exceeds the length limit so callers can fall back to a split send', async () => {
      const adapter = createTelegramAdapter(config);
      // 5000 plain chars — over the 4096 cap in both raw and escaped form.
      const tooLong = 'a'.repeat(5000);

      await expect(adapter.editMessage!('chat-1', '100', tooLong)).rejects.toThrow(
        /exceeds Telegram message length limit/,
      );
      expect(editMessageTextMock).not.toHaveBeenCalled();
    });

    it('edits as plain text when only the MarkdownV2 expansion overflows', async () => {
      const adapter = createTelegramAdapter(config);
      // 3500 dots: raw fits (<4096) but MarkdownV2 escaping doubles to 7000.
      const pathological = '.'.repeat(3500);

      await adapter.editMessage!('chat-1', '100', pathological);

      // Single plain-text edit, no parse_mode, no doomed MarkdownV2 attempt.
      expect(editMessageTextMock).toHaveBeenCalledTimes(1);
      expect(editMessageTextMock.mock.calls[0]![2]).toBe(pathological);
      expect(editMessageTextMock.mock.calls[0]![3]).toBeUndefined();
    });
  });
});
