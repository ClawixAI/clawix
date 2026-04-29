import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelAdapterConfig, InboundMessage } from '@clawix/shared';

// Use vi.hoisted so fakeConnection and createBaileysConnectionMock are available
// when vi.mock factories are hoisted to the top of the file.
const { fakeConnection, createBaileysConnectionMock } = vi.hoisted(() => {
  const fakeConnection = {
    sendText: vi.fn().mockResolvedValue(undefined),
    sendPresence: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const createBaileysConnectionMock = vi.fn(async (opts: { onMessage: (e: unknown) => void }) => {
    // Expose the registered onMessage so tests can drive it directly.
    (
      createBaileysConnectionMock as unknown as { lastOnMessage?: (e: unknown) => void }
    ).lastOnMessage = opts.onMessage;
    return fakeConnection;
  });

  return { fakeConnection, createBaileysConnectionMock };
});

vi.mock('../whatsapp/whatsapp.lifecycle.js', () => ({
  createBaileysConnection: createBaileysConnectionMock,
}));

import { createWhatsAppAdapter } from '../whatsapp/whatsapp.adapter.js';

const baseConfig: ChannelAdapterConfig = {
  id: 'channel-wa',
  type: 'whatsapp',
  name: 'WhatsApp Bot',
  config: {},
};

function fireUpsert(messages: unknown[]): void {
  const fn = (createBaileysConnectionMock as unknown as { lastOnMessage?: (e: unknown) => void })
    .lastOnMessage;
  if (!fn) throw new Error('onMessage not yet registered');
  fn({ messages, type: 'notify' });
}

describe('createWhatsAppAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeConnection.sendText.mockResolvedValue(undefined);
    fakeConnection.sendPresence.mockResolvedValue(undefined);
    fakeConnection.close.mockResolvedValue(undefined);
  });

  it('exposes the ChannelAdapter surface', async () => {
    const adapter = createWhatsAppAdapter(baseConfig);
    await adapter.connect();

    expect(adapter.id).toBe('channel-wa');
    expect(adapter.type).toBe('whatsapp');
    expect(typeof adapter.sendMessage).toBe('function');
    expect(typeof adapter.sendTyping).toBe('function');
    expect(typeof adapter.sendTypingStop).toBe('function');
    expect(typeof adapter.onMessage).toBe('function');
  });

  it('forwards user-direct text messages to the registered handler', async () => {
    const adapter = createWhatsAppAdapter(baseConfig);
    const handler = vi.fn<[InboundMessage], Promise<void>>().mockResolvedValue(undefined);
    adapter.onMessage(handler);
    await adapter.connect();

    fireUpsert([
      {
        key: { id: 'wa-1', remoteJid: '15551234567@s.whatsapp.net', fromMe: false },
        messageTimestamp: 1_700_000_000,
        pushName: 'Alice',
        message: { conversation: 'hello' },
      },
    ]);
    // Microtask flush
    await new Promise((r) => setImmediate(r));

    expect(handler).toHaveBeenCalledTimes(1);
    const inbound = handler.mock.calls[0]![0]!;
    expect(inbound.channelType).toBe('whatsapp');
    expect(inbound.channelMessageId).toBe('wa-1');
    expect(inbound.senderId).toBe('15551234567@s.whatsapp.net');
    expect(inbound.senderName).toBe('Alice');
    expect(inbound.text).toBe('hello');
  });

  it('extracts text from extendedTextMessage when conversation is absent', async () => {
    const adapter = createWhatsAppAdapter(baseConfig);
    const handler = vi.fn().mockResolvedValue(undefined);
    adapter.onMessage(handler);
    await adapter.connect();

    fireUpsert([
      {
        key: { id: 'wa-2', remoteJid: '15551234567@s.whatsapp.net', fromMe: false },
        messageTimestamp: 1_700_000_000,
        pushName: 'Alice',
        message: { extendedTextMessage: { text: 'reply text' } },
      },
    ]);
    await new Promise((r) => setImmediate(r));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]!.text).toBe('reply text');
  });

  it.each([
    [
      'self message',
      { fromMe: true, remoteJid: '15551234567@s.whatsapp.net' },
      { conversation: 'x' },
    ],
    ['group', { fromMe: false, remoteJid: '120363100000@g.us' }, { conversation: 'x' }],
    ['status broadcast', { fromMe: false, remoteJid: 'status@broadcast' }, { conversation: 'x' }],
    [
      'media-only message',
      { fromMe: false, remoteJid: '15551234567@s.whatsapp.net' },
      { imageMessage: {} },
    ],
  ])('skips %s', async (_label, key, message) => {
    const adapter = createWhatsAppAdapter(baseConfig);
    const handler = vi.fn().mockResolvedValue(undefined);
    adapter.onMessage(handler);
    await adapter.connect();

    fireUpsert([{ key: { id: 'wa-x', ...key }, messageTimestamp: 1_700_000_000, message }]);
    await new Promise((r) => setImmediate(r));

    expect(handler).not.toHaveBeenCalled();
  });

  it('chunks long sendMessage output and formats each chunk', async () => {
    const adapter = createWhatsAppAdapter(baseConfig);
    await adapter.connect();

    const longText = 'sentence. '.repeat(1_000);
    await adapter.sendMessage({ recipientId: '15551234567@s.whatsapp.net', text: longText });

    expect(fakeConnection.sendText.mock.calls.length).toBeGreaterThan(1);
    for (const call of fakeConnection.sendText.mock.calls) {
      expect(call[0]).toBe('15551234567@s.whatsapp.net');
      expect((call[1] as string).length).toBeLessThanOrEqual(4096);
    }
  });

  it('converts markdown via the formatter on send', async () => {
    const adapter = createWhatsAppAdapter(baseConfig);
    await adapter.connect();

    await adapter.sendMessage({
      recipientId: '15551234567@s.whatsapp.net',
      text: '**bold**',
    });

    expect(fakeConnection.sendText).toHaveBeenCalledWith('15551234567@s.whatsapp.net', '*bold*');
  });

  it('translates sendTyping / sendTypingStop to presence updates', async () => {
    const adapter = createWhatsAppAdapter(baseConfig);
    await adapter.connect();

    await adapter.sendTyping!('15551234567@s.whatsapp.net');
    await adapter.sendTypingStop!('15551234567@s.whatsapp.net');

    expect(fakeConnection.sendPresence).toHaveBeenNthCalledWith(
      1,
      'composing',
      '15551234567@s.whatsapp.net',
    );
    expect(fakeConnection.sendPresence).toHaveBeenNthCalledWith(
      2,
      'paused',
      '15551234567@s.whatsapp.net',
    );
  });

  it('swallows sendMessage errors (logs at error) and does not crash', async () => {
    const adapter = createWhatsAppAdapter(baseConfig);
    await adapter.connect();
    fakeConnection.sendText.mockRejectedValueOnce(new Error('connection is closed'));

    await expect(
      adapter.sendMessage({ recipientId: '15551234567@s.whatsapp.net', text: 'hi' }),
    ).resolves.toBeUndefined();
  });

  it('disconnect() delegates to connection.close()', async () => {
    const adapter = createWhatsAppAdapter(baseConfig);
    await adapter.connect();

    await adapter.disconnect();

    expect(fakeConnection.close).toHaveBeenCalledTimes(1);
  });
});
