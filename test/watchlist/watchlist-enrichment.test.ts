import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JintelClient } from '../../src/jintel/client.js';
import { WatchlistEnrichment } from '../../src/watchlist/watchlist-enrichment.js';
import { WatchlistStore } from '../../src/watchlist/watchlist-store.js';

function mockJintelClient(overrides: Partial<JintelClient> = {}): JintelClient {
  return {
    searchEntities: vi.fn().mockResolvedValue({ success: true, data: [] }),
    enrichEntity: vi.fn().mockResolvedValue({ success: true, data: {} }),
    ...overrides,
  } as unknown as JintelClient;
}

const MOCK_ENTITY = {
  id: 'jintel-aapl',
  name: 'Apple Inc.',
  type: 'COMPANY',
  tickers: ['AAPL'],
};

const MOCK_ENRICHED = {
  id: 'jintel-aapl',
  name: 'Apple Inc.',
  type: 'COMPANY',
  tickers: ['AAPL'],
  market: {
    quote: {
      ticker: 'AAPL',
      price: 175.5,
      open: 174.0,
      high: 176.0,
      low: 173.5,
      previousClose: 174.2,
      change: 1.3,
      changePercent: 0.75,
      volume: 50000000,
      marketCap: 2800000000000,
      timestamp: '2026-03-23T16:00:00Z',
      source: 'jintel',
    },
  },
  news: [
    {
      title: 'Apple announces new product',
      url: 'https://example.com/news/1',
      source: 'Reuters',
      publishedAt: '2026-03-23T10:00:00Z',
      snippet: 'Apple today announced...',
      sentiment: 'POSITIVE',
    },
  ],
  risk: {
    overallScore: 25,
    signals: [],
    sanctionsHits: 0,
    adverseMediaHits: 0,
    regulatoryActions: 0,
  },
};

describe('WatchlistEnrichment', () => {
  let dir: string;
  let store: WatchlistStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'watchlist-enrich-'));
    store = new WatchlistStore({ dataDir: dir });
    await store.initialize();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('resolveEntity', () => {
    it('resolves entity by symbol and saves jintelEntityId', async () => {
      const client = mockJintelClient({
        searchEntities: vi.fn().mockResolvedValue({ success: true, data: [MOCK_ENTITY] }),
      });
      const enrichment = new WatchlistEnrichment({ store, jintelClient: client, dataDir: dir });
      await enrichment.initialize();

      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });
      await enrichment.resolveEntity('AAPL');

      expect(store.list()[0].jintelEntityId).toBe('jintel-aapl');
      expect(client.searchEntities).toHaveBeenCalledWith('AAPL', expect.anything());
    });

    it('falls back to name search when symbol search returns empty', async () => {
      const searchFn = vi
        .fn()
        .mockResolvedValueOnce({ success: true, data: [] })
        .mockResolvedValueOnce({ success: true, data: [MOCK_ENTITY] });
      const client = mockJintelClient({ searchEntities: searchFn });
      const enrichment = new WatchlistEnrichment({ store, jintelClient: client, dataDir: dir });
      await enrichment.initialize();

      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });
      await enrichment.resolveEntity('AAPL');

      expect(searchFn).toHaveBeenCalledTimes(2);
      expect(searchFn).toHaveBeenNthCalledWith(2, 'Apple Inc.', expect.anything());
      expect(store.list()[0].jintelEntityId).toBe('jintel-aapl');
    });

    it('leaves jintelEntityId empty when both searches fail', async () => {
      const client = mockJintelClient({
        searchEntities: vi.fn().mockResolvedValue({ success: true, data: [] }),
      });
      const enrichment = new WatchlistEnrichment({ store, jintelClient: client, dataDir: dir });
      await enrichment.initialize();

      await store.add({ symbol: 'XXXX', name: 'Unknown Corp', assetClass: 'EQUITY' });
      await enrichment.resolveEntity('XXXX');

      expect(store.list()[0].jintelEntityId).toBeUndefined();
    });

    it('short-circuits when jintelEntityId is already set', async () => {
      const searchFn = vi.fn().mockResolvedValue({ success: true, data: [MOCK_ENTITY] });
      const client = mockJintelClient({ searchEntities: searchFn });
      const enrichment = new WatchlistEnrichment({ store, jintelClient: client, dataDir: dir });
      await enrichment.initialize();

      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY', jintelEntityId: 'jintel-aapl' });
      const result = await enrichment.resolveEntity('AAPL');

      expect(result).toBe('jintel-aapl');
      expect(searchFn).not.toHaveBeenCalled();
    });

    it('throttles retry for unresolvable entries within TTL', async () => {
      const searchFn = vi.fn().mockResolvedValue({ success: true, data: [] });
      const client = mockJintelClient({ searchEntities: searchFn });
      const enrichment = new WatchlistEnrichment({ store, jintelClient: client, dataDir: dir, ttlSeconds: 3600 });
      await enrichment.initialize();

      await store.add({ symbol: 'XXXX', name: 'Unknown Corp', assetClass: 'EQUITY' });

      // First attempt — makes API calls
      await enrichment.resolveEntity('XXXX');
      expect(searchFn).toHaveBeenCalledTimes(2); // symbol + name fallback

      // Second attempt within TTL — skipped
      searchFn.mockClear();
      await enrichment.resolveEntity('XXXX');
      expect(searchFn).not.toHaveBeenCalled();
    });
  });

  describe('enrichSymbol', () => {
    it('enriches and caches result', async () => {
      const client = mockJintelClient({
        searchEntities: vi.fn().mockResolvedValue({ success: true, data: [MOCK_ENTITY] }),
        enrichEntity: vi.fn().mockResolvedValue({ success: true, data: MOCK_ENRICHED }),
      });
      const enrichment = new WatchlistEnrichment({ store, jintelClient: client, dataDir: dir });
      await enrichment.initialize();

      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY', jintelEntityId: 'jintel-aapl' });
      const result = await enrichment.enrichSymbol('AAPL');

      expect(result).not.toBeNull();
      expect(result!.quote?.price).toBe(175.5);
      expect(result!.news).toHaveLength(1);
      expect(result!.riskScore).toBe(25);

      const cacheRaw = await readFile(join(dir, 'watchlist', 'enrichment-cache.jsonl'), 'utf-8');
      expect(cacheRaw.trim()).not.toBe('');
    });
  });

  describe('getEnriched', () => {
    it('returns cached data when within TTL', async () => {
      const client = mockJintelClient({
        enrichEntity: vi.fn().mockResolvedValue({ success: true, data: MOCK_ENRICHED }),
      });
      const enrichment = new WatchlistEnrichment({
        store,
        jintelClient: client,
        dataDir: dir,
        ttlSeconds: 3600,
      });
      await enrichment.initialize();

      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY', jintelEntityId: 'jintel-aapl' });
      await enrichment.enrichSymbol('AAPL');
      const result = await enrichment.getEnriched('AAPL');

      expect(result).not.toBeNull();
      expect(client.enrichEntity).toHaveBeenCalledTimes(1);
    });

    it('re-enriches when cache is stale', async () => {
      const client = mockJintelClient({
        enrichEntity: vi.fn().mockResolvedValue({ success: true, data: MOCK_ENRICHED }),
      });
      const enrichment = new WatchlistEnrichment({
        store,
        jintelClient: client,
        dataDir: dir,
        ttlSeconds: 0,
      });
      await enrichment.initialize();

      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY', jintelEntityId: 'jintel-aapl' });
      await enrichment.enrichSymbol('AAPL');
      await enrichment.getEnriched('AAPL');

      expect(client.enrichEntity).toHaveBeenCalledTimes(2);
    });

    it('retries entity resolution for entries without jintelEntityId', async () => {
      const client = mockJintelClient({
        searchEntities: vi.fn().mockResolvedValue({ success: true, data: [MOCK_ENTITY] }),
        enrichEntity: vi.fn().mockResolvedValue({ success: true, data: MOCK_ENRICHED }),
      });
      const enrichment = new WatchlistEnrichment({ store, jintelClient: client, dataDir: dir });
      await enrichment.initialize();

      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });
      const result = await enrichment.getEnriched('AAPL');

      expect(client.searchEntities).toHaveBeenCalled();
      expect(result).not.toBeNull();
    });

    it('returns null when Jintel client is unavailable and no cache exists', async () => {
      const enrichment = new WatchlistEnrichment({ store, dataDir: dir });
      await enrichment.initialize();

      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' });
      const result = await enrichment.getEnriched('AAPL');

      expect(result).toBeNull();
    });

    it('returns cached data when Jintel client becomes unavailable', async () => {
      const client = mockJintelClient({
        enrichEntity: vi.fn().mockResolvedValue({ success: true, data: MOCK_ENRICHED }),
      });
      // Enrich with client available
      const enrichment1 = new WatchlistEnrichment({ store, jintelClient: client, dataDir: dir });
      await enrichment1.initialize();
      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY', jintelEntityId: 'jintel-aapl' });
      await enrichment1.enrichSymbol('AAPL');

      // Reload without client — should still return cached data
      const enrichment2 = new WatchlistEnrichment({ store, dataDir: dir });
      await enrichment2.initialize();
      const result = await enrichment2.getEnriched('AAPL');

      expect(result).not.toBeNull();
      expect(result!.quote?.price).toBe(175.5);
    });

    it('returns stale cache on enrichment failure', async () => {
      const client = mockJintelClient({
        enrichEntity: vi
          .fn()
          .mockResolvedValueOnce({ success: true, data: MOCK_ENRICHED })
          .mockResolvedValueOnce({ success: false, error: 'API error' }),
      });
      const enrichment = new WatchlistEnrichment({
        store,
        jintelClient: client,
        dataDir: dir,
        ttlSeconds: 0,
      });
      await enrichment.initialize();

      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY', jintelEntityId: 'jintel-aapl' });
      await enrichment.enrichSymbol('AAPL');
      const result = await enrichment.getEnriched('AAPL');

      expect(result).not.toBeNull();
      expect(result!.quote?.price).toBe(175.5);
    });
  });

  describe('getEnrichedBatch', () => {
    it('enriches all symbols concurrently and flushes once', async () => {
      const enrichFn = vi.fn().mockResolvedValue({ success: true, data: MOCK_ENRICHED });
      const client = mockJintelClient({ enrichEntity: enrichFn });
      const enrichment = new WatchlistEnrichment({ store, jintelClient: client, dataDir: dir, ttlSeconds: 0 });
      await enrichment.initialize();

      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY', jintelEntityId: 'jintel-aapl' });
      await store.add({ symbol: 'MSFT', name: 'Microsoft', assetClass: 'EQUITY', jintelEntityId: 'jintel-msft' });

      const results = await enrichment.getEnrichedBatch(['AAPL', 'MSFT']);

      expect(results.size).toBe(2);
      expect(results.get('AAPL')).not.toBeNull();
      expect(results.get('MSFT')).not.toBeNull();
      expect(enrichFn).toHaveBeenCalledTimes(2);

      // Verify cache was persisted (single flush at end)
      const raw = await readFile(join(dir, 'watchlist', 'enrichment-cache.jsonl'), 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(2);
    });
  });

  describe('removeCache', () => {
    it('removes enrichment cache for a symbol', async () => {
      const client = mockJintelClient({
        enrichEntity: vi.fn().mockResolvedValue({ success: true, data: MOCK_ENRICHED }),
      });
      const enrichment = new WatchlistEnrichment({ store, jintelClient: client, dataDir: dir });
      await enrichment.initialize();

      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY', jintelEntityId: 'jintel-aapl' });
      await enrichment.enrichSymbol('AAPL');
      await enrichment.removeCache('AAPL');

      const result = enrichment.getCached('AAPL');
      expect(result).toBeNull();
    });
  });

  describe('cache persistence', () => {
    it('survives re-initialization', async () => {
      const client = mockJintelClient({
        enrichEntity: vi.fn().mockResolvedValue({ success: true, data: MOCK_ENRICHED }),
      });
      const enrichment1 = new WatchlistEnrichment({ store, jintelClient: client, dataDir: dir });
      await enrichment1.initialize();

      await store.add({ symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY', jintelEntityId: 'jintel-aapl' });
      await enrichment1.enrichSymbol('AAPL');

      const enrichment2 = new WatchlistEnrichment({ store, jintelClient: client, dataDir: dir });
      await enrichment2.initialize();

      const cached = enrichment2.getCached('AAPL');
      expect(cached).not.toBeNull();
      expect(cached!.quote?.price).toBe(175.5);
    });

    it('warns and starts empty on corrupt cache file', async () => {
      await mkdir(join(dir, 'watchlist'), { recursive: true });
      await writeFile(join(dir, 'watchlist', 'enrichment-cache.jsonl'), 'corrupt data\n', 'utf-8');

      const enrichment = new WatchlistEnrichment({ store, dataDir: dir });
      await enrichment.initialize();

      const cached = enrichment.getCached('AAPL');
      expect(cached).toBeNull();
    });
  });
});
