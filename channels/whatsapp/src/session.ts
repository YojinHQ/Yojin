import { mkdir } from 'node:fs/promises';

import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';

import { createSubsystemLogger } from '../../../src/logging/logger.js';

const logger = createSubsystemLogger('whatsapp-session');

export interface WhatsAppSessionConfig {
  authDir: string;
  onQr: (qrData: string) => void;
  onConnected: () => void;
  onDisconnected: (reason: string) => void;
  onLoggedOut: () => void;
}

export interface WhatsAppSession {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getSocket(): WASocket | undefined;
}

const RECONNECT = {
  initialMs: 2_000,
  maxMs: 30_000,
  factor: 1.8,
  jitter: 0.25,
  maxAttempts: 12,
} as const;

function backoffMs(attempt: number): number {
  const base = Math.min(RECONNECT.initialMs * Math.pow(RECONNECT.factor, attempt), RECONNECT.maxMs);
  const jitter = base * RECONNECT.jitter * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

export function createWhatsAppSession(config: WhatsAppSessionConfig): WhatsAppSession {
  let sock: WASocket | undefined;
  let connected = false;
  let intentionalClose = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function clearReconnectTimer(): void {
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  }

  function scheduleReconnect(delayMs?: number): void {
    if (intentionalClose) return;
    if (reconnectAttempt >= RECONNECT.maxAttempts) {
      logger.warn('Max reconnect attempts reached, giving up', { attempts: reconnectAttempt });
      return;
    }

    const delay = delayMs ?? backoffMs(reconnectAttempt);
    reconnectAttempt++;
    logger.info('Scheduling reconnect', { attempt: reconnectAttempt, delayMs: delay });

    reconnectTimer = setTimeout(() => {
      if (!intentionalClose) {
        createSocket().catch((err: unknown) => {
          logger.error('Error during reconnect socket creation', { error: err });
        });
      }
    }, delay);
  }

  async function createSocket(): Promise<void> {
    try {
      await mkdir(config.authDir, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
      const { version } = await fetchLatestBaileysVersion();

      sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys),
        },
        version,
        printQRInTerminal: false,
        browser: ['Yojin', 'Desktop', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', (update) => {
        try {
          const { connection, qr, lastDisconnect } = update;

          if (qr) {
            logger.debug('QR code received');
            config.onQr(qr);
          }

          if (connection === 'open') {
            logger.info('WhatsApp connected');
            connected = true;
            reconnectAttempt = 0;
            sock?.sendPresenceUpdate('available').catch((err: unknown) => {
              logger.warn('Failed to send presence update', { error: err });
            });
            config.onConnected();
          }

          if (connection === 'close') {
            connected = false;
            const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
              ?.statusCode;
            const reason = String(lastDisconnect?.error ?? 'unknown');

            logger.info('WhatsApp connection closed', { statusCode, reason });

            if (statusCode === DisconnectReason.loggedOut) {
              logger.warn('WhatsApp session logged out (401) — re-pairing required');
              config.onLoggedOut();
              return;
            }

            if (statusCode === DisconnectReason.restartRequired) {
              logger.info('Restart required (515) — reconnecting immediately');
              scheduleReconnect(0);
              return;
            }

            // 440 = session conflict — another WhatsApp Web session is active.
            // Non-retryable: retrying just gets the same conflict.
            if (statusCode === 440) {
              logger.error(
                'Session conflict (440) — another WhatsApp Web session is active. ' +
                  'Close other sessions (WhatsApp > Linked Devices) and reconnect.',
              );
              config.onDisconnected('Session conflict — another WhatsApp Web session is active');
              return;
            }

            if (!intentionalClose) {
              config.onDisconnected(reason);
              scheduleReconnect();
            }
          }
        } catch (err) {
          logger.error('Error in connection.update handler', { error: err });
        }
      });

      if (sock.ws && typeof (sock.ws as { on?: unknown }).on === 'function') {
        (sock.ws as { on: (event: string, handler: (err: unknown) => void) => void }).on('error', (err: unknown) => {
          logger.warn('WebSocket error', { error: err });
        });
      }
    } catch (err) {
      logger.error('Failed to create Baileys socket', { error: err });
      throw err;
    }
  }

  return {
    async connect(): Promise<void> {
      intentionalClose = false;
      clearReconnectTimer();
      await createSocket();
    },

    async disconnect(): Promise<void> {
      intentionalClose = true;
      clearReconnectTimer();
      connected = false;

      if (sock) {
        try {
          sock.ws.close();
        } catch (err) {
          logger.warn('Error closing WebSocket', { error: err });
        }
        sock = undefined;
      }
    },

    isConnected(): boolean {
      return connected;
    },

    getSocket(): WASocket | undefined {
      return sock;
    },
  };
}
