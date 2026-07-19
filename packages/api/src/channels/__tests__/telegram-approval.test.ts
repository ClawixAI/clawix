import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTelegramAdapter, updateConstraint } from '../telegram/telegram.adapter.js';
import type { ChannelAdapterConfig } from '@clawix/shared';
import type { Context } from 'grammy';

const sendMessageMock = vi.fn().mockResolvedValue({ message_id: 100 });
const editMessageTextMock = vi.fn().mockResolvedValue({});
const answerCallbackQueryMock = vi.fn().mockResolvedValue(true);

// Captures the handler passed to `bot.on(event, handler)` so tests can invoke
// it directly, mirroring the mock pattern in `telegram.adapter.test.ts`.
let capturedHandlers: Record<string, (ctx: unknown) => Promise<void>> = {};

vi.mock('@grammyjs/runner', () => ({
  run: vi.fn(() => ({ isRunning: () => true, stop: vi.fn().mockResolvedValue(undefined) })),
  sequentialize: vi.fn(() => vi.fn()),
}));

vi.mock('grammy', () => {
  return {
    Bot: vi.fn().mockImplementation(() => ({
      on: vi.fn((event: string, handler: (ctx: unknown) => Promise<void>) => {
        capturedHandlers[event] = handler;
      }),
      command: vi.fn(),
      use: vi.fn(),
      catch: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      api: {
        sendMessage: sendMessageMock,
        sendChatAction: vi.fn().mockResolvedValue({}),
        editMessageText: editMessageTextMock,
        answerCallbackQuery: answerCallbackQueryMock,
        setWebhook: vi.fn().mockResolvedValue({}),
      },
    })),
  };
});

interface CallbackCtxOptions {
  readonly data: string;
  readonly fromId: number;
  readonly message?: { readonly message_id: number; readonly chat: { readonly id: number } };
}

function makeCallbackCtx(opts: CallbackCtxOptions): unknown {
  return {
    callbackQuery: {
      id: 'cbq-id',
      data: opts.data,
      from: { id: opts.fromId, is_bot: false, first_name: 'Test' },
      chat_instance: 'ci',
      message: opts.message,
    },
  };
}

function getCallbackHandler(): (ctx: unknown) => Promise<void> {
  const handler = capturedHandlers['callback_query:data'];
  if (!handler) {
    throw new Error('callback_query:data handler was not registered');
  }
  return handler;
}

describe('telegram adapter — tool-call approval', () => {
  const config: ChannelAdapterConfig = {
    id: 'channel-1',
    type: 'telegram',
    name: 'Test Bot',
    config: { bot_token: 'test-token-123' },
  };

  const findByTelegramIdMock = vi.fn();
  const resolveMock = vi.fn();
  const revokeMock = vi.fn();
  const deps = {
    userRepo: { findByTelegramId: findByTelegramIdMock },
    toolApprovals: { resolve: resolveMock, revoke: revokeMock },
  };

  beforeEach(() => {
    capturedHandlers = {};
    sendMessageMock.mockClear();
    sendMessageMock.mockResolvedValue({ message_id: 100 });
    editMessageTextMock.mockClear();
    editMessageTextMock.mockResolvedValue({});
    answerCallbackQueryMock.mockClear();
    findByTelegramIdMock.mockReset();
    resolveMock.mockReset();
    revokeMock.mockReset();
  });

  // The prompt is raised from inside the message handler, which holds its
  // chat's sequentialize lane for as long as the approval is pending. If a tap
  // shared that lane it would queue behind the very handler it has to release,
  // and the approval could only ever resolve by timing out.
  describe('updateConstraint — approval taps must not share the message lane', () => {
    it('returns no constraint for a callback query, even with a chat', () => {
      const ctx = {
        callbackQuery: { id: 'cbq-id', data: 'apr:apr1:allow_once' },
        chat: { id: 42 },
      } as unknown as Context;

      expect(updateConstraint(ctx)).toBeUndefined();
    });

    it('constrains messages to a per-chat lane', () => {
      const ctx = { chat: { id: 42 } } as unknown as Context;

      expect(updateConstraint(ctx)).toBe('42');
    });

    it('gives different chats different lanes so one run cannot block another', () => {
      const a = { chat: { id: 1 } } as unknown as Context;
      const b = { chat: { id: 2 } } as unknown as Context;

      expect(updateConstraint(a)).not.toBe(updateConstraint(b));
    });
  });

  describe('approval.request — inline keyboard prompt', () => {
    it('sends one button per offered scope with the correct label and callback_data', async () => {
      const adapter = createTelegramAdapter(config, deps);

      await adapter.sendMessage({
        recipientId: 'chat-1',
        text: 'fallback text',
        metadata: {
          event: 'approval.request',
          approval: {
            kind: 'prompt',
            sessionId: 's1',
            userId: 'u1',
            approvalId: 'apr1',
            toolName: 'shell',
            paramsSummary: { cmd: 'ls' },
            offeredScopes: ['allow_once', 'allow_session', 'deny_once', 'deny_session'],
            reason: 'no_memory',
            expiresAt: new Date().toISOString(),
          },
        },
      });

      expect(sendMessageMock).toHaveBeenCalledTimes(1);
      const [, , options] = sendMessageMock.mock.calls[0] as [
        string,
        string,
        {
          reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] };
        },
      ];
      const flat = options.reply_markup.inline_keyboard
        .flat()
        .sort((a, b) => a.callback_data.localeCompare(b.callback_data));

      expect(flat).toEqual(
        [
          { text: 'Deny (session)', callback_data: 'apr:apr1:deny_session' },
          { text: 'Deny once', callback_data: 'apr:apr1:deny_once' },
          { text: 'Allow (session)', callback_data: 'apr:apr1:allow_session' },
          { text: 'Allow once', callback_data: 'apr:apr1:allow_once' },
        ].sort((a, b) => a.callback_data.localeCompare(b.callback_data)),
      );
    });

    it('never renders a fixed six buttons — only what offeredScopes carries', async () => {
      const adapter = createTelegramAdapter(config, deps);

      await adapter.sendMessage({
        recipientId: 'chat-1',
        text: 'fallback',
        metadata: {
          event: 'approval.request',
          approval: {
            kind: 'prompt',
            sessionId: 's1',
            userId: 'u1',
            approvalId: 'apr-extractor-failed',
            toolName: 'shell',
            offeredScopes: ['allow_once', 'deny_once'],
            reason: 'extractor_error',
            expiresAt: new Date().toISOString(),
          },
        },
      });

      const [, , options] = sendMessageMock.mock.calls[0] as [
        string,
        string,
        { reply_markup: { inline_keyboard: unknown[][] } },
      ];
      expect(options.reply_markup.inline_keyboard.flat()).toHaveLength(2);
    });
  });

  describe('approval.notice — single revoke button', () => {
    it('renders reason text plus a single "Revoke standing deny" button', async () => {
      const adapter = createTelegramAdapter(config, deps);

      await adapter.sendMessage({
        recipientId: 'chat-1',
        text: 'fallback',
        metadata: {
          event: 'approval.notice',
          approval: {
            kind: 'notice',
            sessionId: 's1',
            userId: 'u1',
            approvalId: 'apr2',
            toolName: 'shell',
            paramsSummary: { cmd: 'rm -rf /' },
            reason: 'standing_deny',
          },
        },
      });

      const [, , options] = sendMessageMock.mock.calls[0] as [
        string,
        string,
        {
          reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] };
        },
      ];
      expect(options.reply_markup.inline_keyboard).toEqual([
        [{ text: 'Revoke standing deny', callback_data: 'aprrevoke:apr2' }],
      ]);
    });
  });

  describe('callback_query — resolving via inline keyboard', () => {
    it('resolves for the mapped user, answers the callback, and edits the outcome', async () => {
      const adapter = createTelegramAdapter(config, deps);
      void adapter;

      findByTelegramIdMock.mockResolvedValueOnce({ id: 'u1', telegramId: '555' });
      resolveMock.mockResolvedValueOnce({ ok: true, downgraded: false });

      await getCallbackHandler()(
        makeCallbackCtx({
          data: 'apr:apr1:allow_once',
          fromId: 555,
          message: { message_id: 100, chat: { id: 555 } },
        }),
      );

      expect(findByTelegramIdMock).toHaveBeenCalledWith('555');
      expect(resolveMock).toHaveBeenCalledWith('apr1', 'u1', 'allow_once');
      expect(answerCallbackQueryMock).toHaveBeenCalledWith('cbq-id', expect.any(Object));
      expect(editMessageTextMock).toHaveBeenCalledWith(
        555,
        100,
        expect.stringContaining('Approved'),
      );
    });

    it('edits the tracked prompt when Telegram omits the tapped message (>48h old)', async () => {
      const adapter = createTelegramAdapter(config, deps);

      // Seed the prompt-message map by sending the original inline-keyboard
      // prompt (chatId = recipientId '555', messageId = 100 from the mock).
      await adapter.sendMessage({
        recipientId: '555',
        text: 'fallback',
        metadata: {
          event: 'approval.request',
          approval: {
            kind: 'prompt',
            sessionId: 's1',
            userId: 'u1',
            approvalId: 'apr1',
            toolName: 'shell',
            offeredScopes: ['allow_once', 'deny_once'],
          },
        },
      });
      editMessageTextMock.mockClear();

      findByTelegramIdMock.mockResolvedValueOnce({ id: 'u1', telegramId: '555' });
      resolveMock.mockResolvedValueOnce({ ok: true, downgraded: false });

      // Telegram omits `message` for callbacks on messages older than 48h.
      await getCallbackHandler()(
        makeCallbackCtx({ data: 'apr:apr1:allow_once', fromId: 555, message: undefined }),
      );

      expect(resolveMock).toHaveBeenCalledWith('apr1', 'u1', 'allow_once');
      // The prompt is still edited via the tracked {chatId, messageId} — its
      // buttons are replaced, not left live.
      expect(editMessageTextMock).toHaveBeenCalledWith(
        '555',
        100,
        expect.stringContaining('Approved'),
      );
    });

    it('rejects a callback from an unmapped Telegram user and never calls resolve', async () => {
      const adapter = createTelegramAdapter(config, deps);
      void adapter;

      findByTelegramIdMock.mockResolvedValueOnce(null);

      await getCallbackHandler()(
        makeCallbackCtx({
          data: 'apr:apr1:allow_once',
          fromId: 999,
          message: { message_id: 100, chat: { id: 999 } },
        }),
      );

      expect(resolveMock).not.toHaveBeenCalled();
      expect(answerCallbackQueryMock).toHaveBeenCalledWith(
        'cbq-id',
        expect.objectContaining({ show_alert: true }),
      );
      expect(editMessageTextMock).not.toHaveBeenCalled();
    });

    it('never trusts a userId embedded in callback_data — always resolves via from.id', async () => {
      const adapter = createTelegramAdapter(config, deps);
      void adapter;

      // Even a well-formed apr:<id>:<choice> payload carries no userId at all;
      // the only identity signal is `from.id`, resolved server-side.
      findByTelegramIdMock.mockResolvedValueOnce({ id: 'real-user', telegramId: '555' });
      resolveMock.mockResolvedValueOnce({ ok: true, downgraded: false });

      await getCallbackHandler()(
        makeCallbackCtx({
          data: 'apr:apr1:allow_once',
          fromId: 555,
          message: { message_id: 100, chat: { id: 555 } },
        }),
      );

      expect(resolveMock).toHaveBeenCalledWith('apr1', 'real-user', 'allow_once');
    });

    it('answers with an alert and does not resolve when the approval is no longer available', async () => {
      const adapter = createTelegramAdapter(config, deps);
      void adapter;

      findByTelegramIdMock.mockResolvedValueOnce({ id: 'u1', telegramId: '555' });
      resolveMock.mockResolvedValueOnce({ ok: false, downgraded: false });

      await getCallbackHandler()(
        makeCallbackCtx({
          data: 'apr:apr1:allow_once',
          fromId: 555,
          message: { message_id: 100, chat: { id: 555 } },
        }),
      );

      expect(answerCallbackQueryMock).toHaveBeenCalledWith(
        'cbq-id',
        expect.objectContaining({ show_alert: true }),
      );
      expect(editMessageTextMock).not.toHaveBeenCalled();
    });

    it('revokes a standing deny via the aprrevoke callback for the mapped user', async () => {
      const adapter = createTelegramAdapter(config, deps);
      void adapter;

      findByTelegramIdMock.mockResolvedValueOnce({ id: 'u1', telegramId: '555' });
      revokeMock.mockResolvedValueOnce(true);

      await getCallbackHandler()(
        makeCallbackCtx({
          data: 'aprrevoke:apr2',
          fromId: 555,
          message: { message_id: 200, chat: { id: 555 } },
        }),
      );

      expect(revokeMock).toHaveBeenCalledWith('apr2', 'u1');
      expect(editMessageTextMock).toHaveBeenCalledWith(
        555,
        200,
        expect.stringContaining('Revoked'),
      );
    });

    it('answers with an error and calls neither resolve nor revoke when deps are not wired', async () => {
      const adapter = createTelegramAdapter(config); // no deps
      void adapter;

      await getCallbackHandler()(
        makeCallbackCtx({
          data: 'apr:apr1:allow_once',
          fromId: 555,
          message: { message_id: 100, chat: { id: 555 } },
        }),
      );

      expect(findByTelegramIdMock).not.toHaveBeenCalled();
      expect(resolveMock).not.toHaveBeenCalled();
      expect(answerCallbackQueryMock).toHaveBeenCalledWith(
        'cbq-id',
        expect.objectContaining({ show_alert: true }),
      );
    });
  });

  describe('approval.resolved — editing the original prompt message', () => {
    it('edits the tracked prompt message when a mapping exists', async () => {
      const adapter = createTelegramAdapter(config, deps);
      sendMessageMock.mockResolvedValueOnce({ message_id: 777 });

      await adapter.sendMessage({
        recipientId: 'chat-9',
        text: 'fallback',
        metadata: {
          event: 'approval.request',
          approval: {
            kind: 'prompt',
            sessionId: 's1',
            userId: 'u1',
            approvalId: 'apr9',
            toolName: 'shell',
            offeredScopes: ['allow_once', 'deny_once'],
            reason: 'no_memory',
            expiresAt: new Date().toISOString(),
          },
        },
      });

      await adapter.sendMessage({
        recipientId: 'chat-9',
        text: 'fallback resolved',
        metadata: {
          event: 'approval.resolved',
          approval: {
            kind: 'resolved',
            sessionId: 's1',
            userId: 'u1',
            approvalId: 'apr9',
            status: 'APPROVED',
            scope: 'once',
          },
        },
      });

      expect(editMessageTextMock).toHaveBeenCalledWith(
        'chat-9',
        777,
        expect.stringContaining('Approved'),
      );
    });

    it('is a no-op when there is no tracked mapping for the approvalId', async () => {
      const adapter = createTelegramAdapter(config, deps);

      const result = await adapter.sendMessage({
        recipientId: 'chat-9',
        text: 'fallback resolved',
        metadata: {
          event: 'approval.resolved',
          approval: {
            kind: 'resolved',
            sessionId: 's1',
            userId: 'u1',
            approvalId: 'unknown-approval',
            status: 'APPROVED',
          },
        },
      });

      expect(editMessageTextMock).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('caps the tracked prompt-message map at 500 entries (FIFO eviction)', async () => {
      const adapter = createTelegramAdapter(config, deps);
      let n = 0;
      sendMessageMock.mockImplementation(async () => ({ message_id: ++n }));

      for (let i = 0; i < 501; i++) {
        await adapter.sendMessage({
          recipientId: 'chat-x',
          text: 'fallback',
          metadata: {
            event: 'approval.request',
            approval: {
              kind: 'prompt',
              sessionId: 's',
              userId: 'u',
              approvalId: `apr-${i}`,
              toolName: 'shell',
              offeredScopes: ['allow_once', 'deny_once'],
              reason: 'no_memory',
              expiresAt: new Date().toISOString(),
            },
          },
        });
      }

      editMessageTextMock.mockClear();

      // apr-0 (the oldest) should have been evicted by the 501st insert.
      await adapter.sendMessage({
        recipientId: 'chat-x',
        text: 'resolved',
        metadata: {
          event: 'approval.resolved',
          approval: {
            kind: 'resolved',
            sessionId: 's',
            userId: 'u',
            approvalId: 'apr-0',
            status: 'APPROVED',
          },
        },
      });
      expect(editMessageTextMock).not.toHaveBeenCalled();

      // apr-500 (the most recent) should still be tracked.
      await adapter.sendMessage({
        recipientId: 'chat-x',
        text: 'resolved',
        metadata: {
          event: 'approval.resolved',
          approval: {
            kind: 'resolved',
            sessionId: 's',
            userId: 'u',
            approvalId: 'apr-500',
            status: 'APPROVED',
          },
        },
      });
      expect(editMessageTextMock).toHaveBeenCalledTimes(1);
    });
  });
});
