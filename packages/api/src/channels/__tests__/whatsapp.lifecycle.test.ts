import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WhatsAppConnection } from '../whatsapp/whatsapp.lifecycle.js';
import { createBaileysConnection } from '../whatsapp/whatsapp.lifecycle.js';

// ----- Baileys mocks -----

interface FakeSocket {
  ev: { on: ReturnType<typeof vi.fn> };
  sendMessage: ReturnType<typeof vi.fn>;
  sendPresenceUpdate: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

const fakeSockets: FakeSocket[] = [];
const handlers = new Map<string, (payload: unknown) => void>();

function makeFakeSocket(): FakeSocket {
  const sock: FakeSocket = {
    ev: {
      on: vi.fn((event: string, fn: (payload: unknown) => void) => {
        handlers.set(event, fn);
      }),
    },
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    end: vi.fn(),
  };
  fakeSockets.push(sock);
  return sock;
}

// Use vi.hoisted so these are available when vi.mock factories are hoisted
const { makeWASocketMock, useMultiFileAuthStateMock, fetchLatestBaileysVersionMock, renderQrMock } =
  vi.hoisted(() => {
    return {
      makeWASocketMock: vi.fn(),
      useMultiFileAuthStateMock: vi.fn(async () => ({
        state: {},
        saveCreds: vi.fn().mockResolvedValue(undefined),
      })),
      fetchLatestBaileysVersionMock: vi.fn(async () => ({
        version: [2, 3000, 1027934702] as [number, number, number],
        isLatest: true,
      })),
      renderQrMock: vi.fn(),
    };
  });

vi.mock('@whiskeysockets/baileys', () => ({
  default: makeWASocketMock,
  useMultiFileAuthState: useMultiFileAuthStateMock,
  fetchLatestBaileysVersion: fetchLatestBaileysVersionMock,
  jidNormalizedUser: (s: string) => s,
  DisconnectReason: { loggedOut: 401 },
}));

vi.mock('qrcode-terminal', () => ({
  default: { generate: renderQrMock },
  generate: renderQrMock,
}));

// ----- Helpers -----

function emit(event: string, payload: unknown): void {
  const fn = handlers.get(event);
  if (!fn) throw new Error(`no handler registered for ${event}`);
  fn(payload);
}

describe('createBaileysConnection', () => {
  let connection: WhatsAppConnection;

  beforeEach(() => {
    fakeSockets.length = 0;
    handlers.clear();
    makeWASocketMock.mockClear();
    makeWASocketMock.mockImplementation(() => makeFakeSocket());
    useMultiFileAuthStateMock.mockClear();
    fetchLatestBaileysVersionMock.mockClear();
    renderQrMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (connection) await connection.close();
  });

  it('returns a WhatsAppConnection handle with sendText / sendPresence / close', async () => {
    connection = await createBaileysConnection({
      authDir: '/tmp/wa-auth',
      onMessage: vi.fn(),
    });

    expect(typeof connection.sendText).toBe('function');
    expect(typeof connection.sendPresence).toBe('function');
    expect(typeof connection.close).toBe('function');
  });

  it('wires creds.update, messages.upsert and connection.update event handlers', async () => {
    const onMessage = vi.fn();
    connection = await createBaileysConnection({ authDir: '/tmp/wa', onMessage });

    expect(handlers.has('creds.update')).toBe(true);
    expect(handlers.has('messages.upsert')).toBe(true);
    expect(handlers.has('connection.update')).toBe(true);

    emit('messages.upsert', { messages: [{ key: { id: 'x' } }], type: 'notify' });
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('renders a QR code when connection.update emits a qr field', async () => {
    connection = await createBaileysConnection({ authDir: '/tmp/wa', onMessage: vi.fn() });

    emit('connection.update', { qr: 'qr-data-blob' });

    expect(renderQrMock).toHaveBeenCalledWith('qr-data-blob', expect.any(Object));
  });

  it('does NOT reconnect on logged-out (401) close', async () => {
    connection = await createBaileysConnection({ authDir: '/tmp/wa', onMessage: vi.fn() });

    emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });

    // Advance fake timers — no new socket should be created.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(makeWASocketMock).toHaveBeenCalledTimes(1);
  });

  it('reconnects with backoff on transient close, replacing the socket', async () => {
    connection = await createBaileysConnection({ authDir: '/tmp/wa', onMessage: vi.fn() });
    expect(makeWASocketMock).toHaveBeenCalledTimes(1);

    emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    });

    // First backoff is 1s.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(makeWASocketMock).toHaveBeenCalledTimes(2);

    // sendText must hit the new socket, not the old one.
    await connection.sendText('1@s.whatsapp.net', 'hi');
    expect(fakeSockets[0]?.sendMessage).not.toHaveBeenCalled();
    expect(fakeSockets[1]?.sendMessage).toHaveBeenCalledWith('1@s.whatsapp.net', { text: 'hi' });
  });

  it('resets backoff after a successful open', async () => {
    connection = await createBaileysConnection({ authDir: '/tmp/wa', onMessage: vi.fn() });

    // Two transient closes back-to-back; backoff would have grown to 2s on the second.
    emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    emit('connection.update', { connection: 'open' });
    emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    });
    // After 'open' resets the counter, the next backoff should be 1s again.
    await vi.advanceTimersByTimeAsync(1_000);

    expect(makeWASocketMock).toHaveBeenCalledTimes(3);
  });

  it('close() cancels pending reconnect and ends the socket', async () => {
    connection = await createBaileysConnection({ authDir: '/tmp/wa', onMessage: vi.fn() });
    emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    });

    await connection.close();

    // Fast-forward past the would-be 1s backoff — no new socket should appear.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(makeWASocketMock).toHaveBeenCalledTimes(1);
    expect(fakeSockets[0]?.end).toHaveBeenCalled();
  });

  it('sendText / sendPresence after close throws', async () => {
    connection = await createBaileysConnection({ authDir: '/tmp/wa', onMessage: vi.fn() });
    await connection.close();

    await expect(connection.sendText('1@s.whatsapp.net', 'hi')).rejects.toThrow(/closed/i);
    await expect(connection.sendPresence('composing', '1@s.whatsapp.net')).rejects.toThrow(
      /closed/i,
    );
  });
});
