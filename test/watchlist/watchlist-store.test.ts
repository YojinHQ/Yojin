import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WatchlistStore } from '../../src/watchlist/watchlist-store.js';

describe('WatchlistStore', () => {
  let dir: string;
  let store: WatchlistStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'watchlist-'));
    store = new WatchlistStore({ dataDir: dir });
    await store.initialize();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('add', () => {
    it('adds an entry and persists to JSONL', async () => {
      const result = await store.add({
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'EQUITY',
      });

      expect(result).toEqual({ success: true });
      expect(store.list()).toHaveLength(1);
      expect(store.list()[0].symbol).toBe('AAPL');
      expect(store.list()[0].addedAt).toBeDefined();

      // Verify persistence
      const raw = await readFile(join(dir, 'watchlist', 'watchlist.jsonl'), 'utf-8');
      const lines = raw.trim().split('\n');
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.symbol).toBe('AAPL');
    });

    it('rejects duplicate symbols (case-insensitive)', async () => {
      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });
      const result = await store.add({ symbol: 'aapl', name: 'Apple Inc.', assetClass: 'EQUITY' });

      expect(result).toEqual({ success: false, error: 'already in watchlist' });
      expect(store.list()).toHaveLength(1);
    });

    it('normalizes symbol to uppercase', async () => {
      await store.add({ symbol: 'aapl', name: 'Apple Inc.', assetClass: 'EQUITY' });

      expect(store.list()[0].symbol).toBe('AAPL');
    });
  });

  describe('remove', () => {
    it('removes an entry and persists removal', async () => {
      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });
      const result = await store.remove('AAPL');

      expect(result).toEqual({ success: true });
      expect(store.list()).toHaveLength(0);

      // Verify persistence
      const raw = await readFile(join(dir, 'watchlist', 'watchlist.jsonl'), 'utf-8');
      expect(raw.trim()).toBe('');
    });

    it('returns error for non-existent symbol', async () => {
      const result = await store.remove('AAPL');

      expect(result).toEqual({ success: false, error: 'symbol not found' });
    });

    it('normalizes symbol to uppercase for lookup', async () => {
      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });
      const result = await store.remove('aapl');

      expect(result).toEqual({ success: true });
      expect(store.list()).toHaveLength(0);
    });
  });

  describe('list', () => {
    it('returns all entries', async () => {
      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });
      await store.add({ symbol: 'BTC', name: 'Bitcoin', assetClass: 'CRYPTO' });

      expect(store.list()).toHaveLength(2);
    });

    it('returns empty array when empty', () => {
      expect(store.list()).toEqual([]);
    });
  });

  describe('has', () => {
    it('returns true for existing symbol (case-insensitive)', async () => {
      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });

      expect(store.has('AAPL')).toBe(true);
      expect(store.has('aapl')).toBe(true);
      expect(store.has('Aapl')).toBe(true);
    });

    it('returns false for non-existent symbol', () => {
      expect(store.has('AAPL')).toBe(false);
    });
  });

  describe('updateEntry', () => {
    it('updates jintelEntityId on existing entry', async () => {
      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });
      const result = await store.updateEntry('AAPL', { jintelEntityId: 'jintel-123' });

      expect(result).toEqual({ success: true });
      expect(store.list()[0].jintelEntityId).toBe('jintel-123');
    });

    it('persists update across instances', async () => {
      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });
      await store.updateEntry('AAPL', { jintelEntityId: 'jintel-123' });

      const store2 = new WatchlistStore({ dataDir: dir });
      await store2.initialize();

      expect(store2.list()[0].jintelEntityId).toBe('jintel-123');
    });

    it('returns error for non-existent symbol', async () => {
      const result = await store.updateEntry('XXXX', { jintelEntityId: 'jintel-999' });

      expect(result).toEqual({ success: false, error: 'symbol not found' });
    });

    it('is case-insensitive for symbol lookup', async () => {
      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });
      const result = await store.updateEntry('aapl', { jintelEntityId: 'jintel-456' });

      expect(result).toEqual({ success: true });
      expect(store.list()[0].jintelEntityId).toBe('jintel-456');
    });
  });

  describe('initialize', () => {
    it('creates empty file when missing', async () => {
      expect(store.list()).toEqual([]);
    });

    it('loads existing entries from JSONL', async () => {
      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });

      const store2 = new WatchlistStore({ dataDir: dir });
      await store2.initialize();

      expect(store2.list()).toHaveLength(1);
      expect(store2.list()[0].symbol).toBe('AAPL');
    });

    it('warns and starts empty on corrupt file', async () => {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const corruptDir = await mkdtemp(join(tmpdir(), 'watchlist-corrupt-'));
      await mkdir(join(corruptDir, 'watchlist'), { recursive: true });
      await writeFile(join(corruptDir, 'watchlist', 'watchlist.jsonl'), 'not valid json\n', 'utf-8');

      const corruptStore = new WatchlistStore({ dataDir: corruptDir });
      await corruptStore.initialize();

      expect(corruptStore.list()).toEqual([]);

      await rm(corruptDir, { recursive: true, force: true });
    });

    it('skips entries that fail Zod validation', async () => {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const badDir = await mkdtemp(join(tmpdir(), 'watchlist-bad-'));
      await mkdir(join(badDir, 'watchlist'), { recursive: true });
      const good = JSON.stringify({
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'EQUITY',
        addedAt: '2026-01-01T00:00:00.000Z',
      });
      const bad = JSON.stringify({ symbol: '', name: '', assetClass: 'INVALID' });
      await writeFile(join(badDir, 'watchlist', 'watchlist.jsonl'), `${good}\n${bad}\n`, 'utf-8');

      const badStore = new WatchlistStore({ dataDir: badDir });
      await badStore.initialize();

      expect(badStore.list()).toHaveLength(1);
      expect(badStore.list()[0].symbol).toBe('AAPL');

      await rm(badDir, { recursive: true, force: true });
    });
  });
});
