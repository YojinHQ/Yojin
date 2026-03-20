import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type BrowserSessionData, SessionStore } from '../../src/scraper/session-store.js';
import type { SecretVault } from '../../src/trust/vault/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockVault(): SecretVault & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async set(key: string, value: string) {
      store.set(key, value);
    },
    async get(key: string) {
      if (!store.has(key)) throw new Error(`Key not found: ${key}`);
      return store.get(key)!;
    },
    async has(key: string) {
      return store.has(key);
    },
    async list() {
      return [...store.keys()];
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function sampleSession(): BrowserSessionData {
  return {
    cookies: [
      {
        name: 'session_id',
        value: 'abc123',
        domain: '.example.com',
        path: '/',
        expires: Date.now() / 1000 + 3600,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ],
    localStorage: { theme: 'dark' },
    savedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionStore', () => {
  let tmpDir: string;
  let vault: SecretVault & { store: Map<string, string> };
  let store: SessionStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'yojin-session-'));
    vault = makeMockVault();
    store = new SessionStore({ vault, sessionsDir: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('stores session data in vault', async () => {
      const session = sampleSession();
      await store.save('COINBASE', session);

      expect(vault.store.has('SESSION_COINBASE')).toBe(true);
      const stored = JSON.parse(vault.store.get('SESSION_COINBASE')!);
      expect(stored.cookies).toHaveLength(1);
      expect(stored.cookies[0].name).toBe('session_id');
    });

    it('writes a marker file', async () => {
      await store.save('COINBASE', sampleSession());

      const markerPath = path.join(tmpDir, 'coinbase.marker.json');
      const marker = JSON.parse(await readFile(markerPath, 'utf-8'));
      expect(marker.platform).toBe('COINBASE');
      expect(marker.savedAt).toBeDefined();
    });
  });

  describe('load', () => {
    it('returns saved session data', async () => {
      const session = sampleSession();
      await store.save('BINANCE', session);

      const loaded = await store.load('BINANCE');
      expect(loaded).not.toBeNull();
      expect(loaded!.cookies[0].value).toBe('abc123');
      expect(loaded!.localStorage?.theme).toBe('dark');
    });

    it('returns null for missing platform', async () => {
      const loaded = await store.load('UNKNOWN_PLATFORM');
      expect(loaded).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes session from vault and marker file', async () => {
      await store.save('ROBINHOOD', sampleSession());
      expect(await store.has('ROBINHOOD')).toBe(true);

      await store.clear('ROBINHOOD');
      expect(await store.has('ROBINHOOD')).toBe(false);
      expect(await store.load('ROBINHOOD')).toBeNull();
    });

    it('is idempotent for missing platform', async () => {
      // Should not throw
      await store.clear('NONEXISTENT');
    });
  });

  describe('has', () => {
    it('returns true for saved session', async () => {
      await store.save('FIDELITY', sampleSession());
      expect(await store.has('FIDELITY')).toBe(true);
    });

    it('returns false for missing session', async () => {
      expect(await store.has('FIDELITY')).toBe(false);
    });
  });

  describe('round-trip', () => {
    it('preserves all session fields through save/load cycle', async () => {
      const session: BrowserSessionData = {
        cookies: [
          {
            name: 'auth',
            value: 'token123',
            domain: '.broker.com',
            path: '/api',
            expires: 1700000000,
            httpOnly: false,
            secure: true,
            sameSite: 'Strict',
          },
          {
            name: 'csrf',
            value: 'xyz789',
            domain: '.broker.com',
            path: '/',
            expires: 1700000000,
            httpOnly: true,
            secure: true,
            sameSite: 'None',
          },
        ],
        localStorage: { preference: 'advanced', lastView: 'portfolio' },
        savedAt: '2026-03-20T10:00:00.000Z',
      };

      await store.save('INTERACTIVE_BROKERS', session);
      const loaded = await store.load('INTERACTIVE_BROKERS');

      expect(loaded).toEqual(session);
    });
  });
});
