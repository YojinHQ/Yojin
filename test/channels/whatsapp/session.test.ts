import * as fsp from 'node:fs/promises';

import * as baileys from '@whiskeysockets/baileys';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWhatsAppSession } from '../../../channels/whatsapp/src/session.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@whiskeysockets/baileys', () => ({
  makeWASocket: vi.fn(),
  useMultiFileAuthState: vi.fn(),
  makeCacheableSignalKeyStore: vi.fn(),
  fetchLatestBaileysVersion: vi.fn(),
  DisconnectReason: {
    loggedOut: 401,
    restartRequired: 515,
  },
}));

vi.mock('../../../src/logging/logger.js', () => ({
  createSubsystemLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }),
}));

function makeMockSocket() {
  const evHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const wsHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  return {
    ev: {
      on(event: string, handler: (...args: unknown[]) => void) {
        evHandlers[event] = evHandlers[event] ?? [];
        evHandlers[event].push(handler);
      },
      emit(event: string, ...args: unknown[]) {
        for (const h of evHandlers[event] ?? []) h(...args);
      },
    },
    ws: {
      on(event: string, handler: (...args: unknown[]) => void) {
        wsHandlers[event] = wsHandlers[event] ?? [];
        wsHandlers[event].push(handler);
      },
      emit(event: string, ...args: unknown[]) {
        for (const h of wsHandlers[event] ?? []) h(...args);
      },
      close: vi.fn(),
    },
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    _evHandlers: evHandlers,
    _wsHandlers: wsHandlers,
  };
}

type MockSocket = ReturnType<typeof makeMockSocket>;

describe('createWhatsAppSession', () => {
  const authDir = '/tmp/test-wa-auth';

  let mockSocket: MockSocket;

  const baseConfig = {
    authDir,
    onQr: vi.fn(),
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onLoggedOut: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSocket = makeMockSocket();

    vi.mocked(baileys.makeWASocket).mockReturnValue(mockSocket as unknown as ReturnType<typeof baileys.makeWASocket>);
    vi.mocked(baileys.useMultiFileAuthState).mockResolvedValue({
      state: { creds: {} as never, keys: {} as never },
      saveCreds: vi.fn(),
    });
    vi.mocked(baileys.makeCacheableSignalKeyStore).mockReturnValue({} as never);
    vi.mocked(baileys.fetchLatestBaileysVersion).mockResolvedValue({
      version: [2, 3000, 1023535450],
      isLatest: true,
    });
  });

  it('returns an object with the correct interface', () => {
    const session = createWhatsAppSession(baseConfig);
    expect(typeof session.connect).toBe('function');
    expect(typeof session.disconnect).toBe('function');
    expect(typeof session.isConnected).toBe('function');
    expect(typeof session.getSocket).toBe('function');
  });

  it('starts disconnected', () => {
    const session = createWhatsAppSession(baseConfig);
    expect(session.isConnected()).toBe(false);
  });

  it('getSocket() returns undefined before connect', () => {
    const session = createWhatsAppSession(baseConfig);
    expect(session.getSocket()).toBeUndefined();
  });

  it('calls makeWASocket after connect()', async () => {
    const session = createWhatsAppSession(baseConfig);
    await session.connect();
    expect(baileys.makeWASocket).toHaveBeenCalledOnce();
  });

  it('creates auth directory on connect()', async () => {
    const session = createWhatsAppSession(baseConfig);
    await session.connect();
    expect(fsp.mkdir).toHaveBeenCalledWith(authDir, { recursive: true });
  });

  it('calls useMultiFileAuthState with authDir', async () => {
    const session = createWhatsAppSession(baseConfig);
    await session.connect();
    expect(baileys.useMultiFileAuthState).toHaveBeenCalledWith(authDir);
  });

  it('getSocket() returns the socket after connect()', async () => {
    const session = createWhatsAppSession(baseConfig);
    await session.connect();
    expect(session.getSocket()).toBe(mockSocket);
  });

  it('registers creds.update handler for credential persistence', async () => {
    const session = createWhatsAppSession(baseConfig);
    await session.connect();
    expect(mockSocket._evHandlers['creds.update']).toBeDefined();
    expect(mockSocket._evHandlers['creds.update'].length).toBeGreaterThan(0);
  });

  it('registers connection.update handler', async () => {
    const session = createWhatsAppSession(baseConfig);
    await session.connect();
    expect(mockSocket._evHandlers['connection.update']).toBeDefined();
    expect(mockSocket._evHandlers['connection.update'].length).toBeGreaterThan(0);
  });

  describe('connection.update events', () => {
    it('calls onQr when QR code is received', async () => {
      const config = { ...baseConfig, onQr: vi.fn() };
      const session = createWhatsAppSession(config);
      await session.connect();

      mockSocket.ev.emit('connection.update', { qr: 'test-qr-data' });
      expect(config.onQr).toHaveBeenCalledWith('test-qr-data');
    });

    it('sets isConnected to true and calls onConnected when connection opens', async () => {
      const config = { ...baseConfig, onConnected: vi.fn() };
      const session = createWhatsAppSession(config);
      await session.connect();

      mockSocket.ev.emit('connection.update', { connection: 'open' });
      expect(session.isConnected()).toBe(true);
      expect(config.onConnected).toHaveBeenCalledOnce();
    });

    it('calls sendPresenceUpdate when connection opens', async () => {
      const session = createWhatsAppSession(baseConfig);
      await session.connect();

      mockSocket.ev.emit('connection.update', { connection: 'open' });
      expect(mockSocket.sendPresenceUpdate).toHaveBeenCalledWith('available');
    });

    it('calls onLoggedOut and does not reconnect on status 401', async () => {
      const config = { ...baseConfig, onLoggedOut: vi.fn(), onDisconnected: vi.fn() };
      const session = createWhatsAppSession(config);
      await session.connect();

      mockSocket.ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 401 } } },
      });

      expect(config.onLoggedOut).toHaveBeenCalledOnce();
      expect(config.onDisconnected).not.toHaveBeenCalled();
    });

    it('calls onDisconnected on unexpected close', async () => {
      const config = { ...baseConfig, onDisconnected: vi.fn(), onLoggedOut: vi.fn() };
      const session = createWhatsAppSession(config);
      await session.connect();

      mockSocket.ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 408 } } },
      });

      expect(config.onDisconnected).toHaveBeenCalledOnce();
      expect(config.onLoggedOut).not.toHaveBeenCalled();
    });

    it('sets isConnected to false when connection closes', async () => {
      const session = createWhatsAppSession(baseConfig);
      await session.connect();

      mockSocket.ev.emit('connection.update', { connection: 'open' });
      expect(session.isConnected()).toBe(true);

      mockSocket.ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 408 } } },
      });
      expect(session.isConnected()).toBe(false);
    });

    it('does not throw if connection.update handler throws internally', async () => {
      const config = {
        ...baseConfig,
        onConnected: vi.fn(() => {
          throw new Error('handler error');
        }),
      };
      const session = createWhatsAppSession(config);
      await session.connect();

      // Should not throw — handler is wrapped in try/catch
      expect(() => {
        mockSocket.ev.emit('connection.update', { connection: 'open' });
      }).not.toThrow();
    });
  });

  describe('disconnect()', () => {
    it('sets isConnected to false', async () => {
      const session = createWhatsAppSession(baseConfig);
      await session.connect();

      mockSocket.ev.emit('connection.update', { connection: 'open' });
      expect(session.isConnected()).toBe(true);

      await session.disconnect();
      expect(session.isConnected()).toBe(false);
    });

    it('closes the WebSocket', async () => {
      const session = createWhatsAppSession(baseConfig);
      await session.connect();

      await session.disconnect();
      expect(mockSocket.ws.close).toHaveBeenCalledOnce();
    });

    it('clears the socket reference (getSocket returns undefined)', async () => {
      const session = createWhatsAppSession(baseConfig);
      await session.connect();
      expect(session.getSocket()).toBeDefined();

      await session.disconnect();
      expect(session.getSocket()).toBeUndefined();
    });

    it('does not trigger onDisconnected callback after intentional disconnect', async () => {
      const config = { ...baseConfig, onDisconnected: vi.fn() };
      const session = createWhatsAppSession(config);
      await session.connect();

      await session.disconnect();

      // Simulate a close event firing after intentional disconnect
      mockSocket.ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 408 } } },
      });

      expect(config.onDisconnected).not.toHaveBeenCalled();
    });
  });
});
