import baileys, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type ConnectionState,
  type WASocket,
} from '@whiskeysockets/baileys';
import qrcodeTerminal from 'qrcode-terminal';
import { createLogger } from '@clawix/shared';

const logger = createLogger('channels:whatsapp:lifecycle');

// Baileys publishes both default and named exports; in CJS interop both shapes
// can show up depending on the bundler. Resolve the callable at runtime.
type MakeWASocket = typeof baileys;
const makeWASocket: MakeWASocket =
  (baileys as unknown as { default?: MakeWASocket }).default ?? baileys;

const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 60_000] as const;

// WhatsApp returns this status when the client's appVersion is older than
// what the servers currently accept. We respond by re-fetching the latest
// known-good version and reconnecting.
const STATUS_OUTDATED_VERSION = 405;

/**
 * Fetch the latest WhatsApp Web protocol version Baileys is willing to
 * present. Baileys ships with a hardcoded fallback that goes stale within
 * weeks of any release; without this, WA returns 405 on handshake. If the
 * fetch fails (network/proxy issue) we fall back to the library default.
 */
async function resolveAppVersion(): Promise<readonly [number, number, number] | undefined> {
  try {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info({ version, isLatest }, 'Resolved WhatsApp app version');
    return version;
  } catch (err: unknown) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'fetchLatestBaileysVersion failed; using library default (may trigger 405)',
    );
    return undefined;
  }
}

export interface WhatsAppConnection {
  sendText(jid: string, text: string): Promise<void>;
  sendPresence(presence: 'composing' | 'paused', jid: string): Promise<void>;
  close(): Promise<void>;
}

export interface CreateBaileysConnectionOpts {
  readonly authDir: string;
  readonly onMessage: (event: { messages: unknown[]; type: string }) => void;
  readonly onConnectionUpdate?: (update: Partial<ConnectionState>) => void;
}

interface BoomLikeError {
  output?: { statusCode?: number };
}

function statusCodeOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  return (err as BoomLikeError).output?.statusCode;
}

export async function createBaileysConnection(
  opts: CreateBaileysConnectionOpts,
): Promise<WhatsAppConnection> {
  const { authDir, onMessage, onConnectionUpdate } = opts;
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  let appVersion = await resolveAppVersion();

  let sock: WASocket | null = null;
  let closed = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let backoffIndex = 0;

  const wireSocket = (s: WASocket): void => {
    // saveCreds is async but event listener expects void — fire and forget
    s.ev.on('creds.update', () => {
      void saveCreds();
    });
    s.ev.on('messages.upsert', onMessage);
    s.ev.on('connection.update', (update) => {
      onConnectionUpdate?.(update as Partial<ConnectionState>);
      handleConnectionUpdate(update as Partial<ConnectionState>);
    });
  };

  const startSocket = (): void => {
    if (closed) return;
    const fresh = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      ...(appVersion ? { version: [...appVersion] as [number, number, number] } : {}),
    });
    wireSocket(fresh);
    sock = fresh;
  };

  const scheduleReconnect = (): void => {
    if (closed) return;
    const delay =
      RECONNECT_DELAYS_MS[Math.min(backoffIndex, RECONNECT_DELAYS_MS.length - 1)] ??
      RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1];
    backoffIndex++;
    logger.info({ delay }, 'WhatsApp scheduling reconnect');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      startSocket();
    }, delay);
  };

  const handleConnectionUpdate = (update: Partial<ConnectionState>): void => {
    if (typeof update.qr === 'string' && update.qr.length > 0) {
      logger.warn('WhatsApp QR ready — scan within ~60s via Linked Devices');
      qrcodeTerminal.generate(update.qr, { small: true });
      return;
    }
    if (update.connection === 'open') {
      logger.info('WhatsApp connected');
      backoffIndex = 0;
      return;
    }
    if (update.connection === 'close') {
      const code = statusCodeOf((update.lastDisconnect as { error?: unknown } | undefined)?.error);
      if (code === DisconnectReason.loggedOut) {
        logger.error({ authDir }, 'WhatsApp logged out — wipe the auth dir and re-pair to recover');
        return;
      }
      if (code === STATUS_OUTDATED_VERSION) {
        // WhatsApp bumped the accepted protocol version; refresh before we
        // reconnect so the next handshake doesn't loop on the same 405.
        logger.warn(
          { code },
          'WhatsApp rejected client version (405); refreshing version before reconnect',
        );
        void resolveAppVersion().then((next) => {
          if (next) appVersion = next;
        });
      } else {
        logger.warn({ code }, 'WhatsApp connection closed; will reconnect');
      }
      scheduleReconnect();
    }
  };

  startSocket();

  const requireSocket = (): WASocket => {
    if (closed) throw new Error('WhatsApp connection is closed');
    if (!sock) throw new Error('WhatsApp connection is closed');
    return sock;
  };

  return {
    async sendText(jid: string, text: string): Promise<void> {
      const s = requireSocket();
      await s.sendMessage(jid, { text });
    },
    async sendPresence(presence, jid): Promise<void> {
      const s = requireSocket();
      await s.sendPresenceUpdate(presence, jid);
    },
    async close(): Promise<void> {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const current = sock;
      sock = null;
      if (current) {
        try {
          current.end(undefined);
        } catch (err: unknown) {
          logger.debug({ err: err instanceof Error ? err.message : err }, 'sock.end threw');
        }
      }
    },
  };
}
