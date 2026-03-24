import type { JintelClient, JintelResult, MarketQuote } from '@yojinhq/jintel-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  newsQuery,
  quoteQuery,
  sectorExposureQuery,
  setMarketJintelClient,
  setMarketSnapshotStore,
} from '../../../../src/api/graphql/resolvers/market.js';
import type { PortfolioSnapshotStore } from '../../../../src/portfolio/snapshot-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockJintelClient(overrides: Partial<JintelClient> = {}): JintelClient {
  return {
    quotes: vi.fn<(tickers: string[]) => Promise<JintelResult<MarketQuote[]>>>().mockResolvedValue({
      success: true,
      data: [
        {
          ticker: 'AAPL',
          price: 195.0,
          change: 3.5,
          changePercent: 1.83,
          volume: 60_000_000,
          high: 196.0,
          low: 192.0,
          open: 193.0,
          previousClose: 191.5,
          timestamp: '2024-01-15T16:00:00Z',
          source: 'jintel',
          marketCap: null,
        },
      ],
    }),
    searchEntities: vi.fn(),
    enrichEntity: vi.fn(),
    sanctionsScreen: vi.fn(),
    healthCheck: vi.fn(),
    ...overrides,
  } as unknown as JintelClient;
}

function createMockSnapshotStore(
  snapshot: Awaited<ReturnType<PortfolioSnapshotStore['getLatest']>> = null,
): PortfolioSnapshotStore {
  return {
    getLatest: vi.fn().mockResolvedValue(snapshot),
    save: vi.fn(),
    getAll: vi.fn(),
    clearAll: vi.fn(),
    getLatestRedacted: vi.fn(),
  } as unknown as PortfolioSnapshotStore;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('market resolvers', () => {
  beforeEach(() => {
    setMarketJintelClient(undefined);
    setMarketSnapshotStore(undefined);
  });

  // ── quoteQuery ────────────────────────────────────────────────────────

  describe('quoteQuery', () => {
    it('returns Jintel data when client is available', async () => {
      const client = createMockJintelClient();
      setMarketJintelClient(client);

      const result = await quoteQuery(null, { symbol: 'AAPL' });

      expect(client.quotes).toHaveBeenCalledWith(['AAPL']);
      expect(result).toEqual({
        symbol: 'AAPL',
        price: 195.0,
        change: 3.5,
        changePercent: 1.83,
        volume: 60_000_000,
        high: 196.0,
        low: 192.0,
        open: 193.0,
        previousClose: 191.5,
        timestamp: '2024-01-15T16:00:00Z',
      });
    });

    it('falls back to stub when Jintel fails', async () => {
      const client = createMockJintelClient({
        quotes: vi.fn().mockResolvedValue({ success: false, error: 'API down' }),
      });
      setMarketJintelClient(client);

      const result = await quoteQuery(null, { symbol: 'AAPL' });

      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('AAPL');
      expect(result!.price).toBe(178.5); // stub price
    });

    it('falls back to stub when no client is set', async () => {
      const result = await quoteQuery(null, { symbol: 'MSFT' });

      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('MSFT');
      expect(result!.price).toBe(415.2); // stub price
    });

    it('returns null for unknown symbol without client', async () => {
      const result = await quoteQuery(null, { symbol: 'UNKNOWN' });

      expect(result).toBeNull();
    });

    it('uppercases the symbol before lookup', async () => {
      const client = createMockJintelClient();
      setMarketJintelClient(client);

      await quoteQuery(null, { symbol: 'aapl' });

      expect(client.quotes).toHaveBeenCalledWith(['AAPL']);
    });
  });

  // ── newsQuery ─────────────────────────────────────────────────────────

  describe('newsQuery', () => {
    it('returns stub articles', async () => {
      const result = await newsQuery(null, {});

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].title).toBe('Apple Reports Record Q4 Revenue');
    });

    it('filters stubs by symbol', async () => {
      const result = await newsQuery(null, { symbol: 'BTC' });

      expect(result).toHaveLength(1);
      expect(result[0].symbols).toContain('BTC');
    });

    it('limits stub results', async () => {
      const result = await newsQuery(null, { limit: 1 });

      expect(result).toHaveLength(1);
    });
  });

  // ── sectorExposureQuery ───────────────────────────────────────────────

  describe('sectorExposureQuery', () => {
    it('returns stub data when no snapshot store is set', async () => {
      const result = await sectorExposureQuery();

      expect(result).toHaveLength(2);
      expect(result[0].sector).toBe('Technology');
    });

    it('computes sector weights from snapshot positions', async () => {
      const store = createMockSnapshotStore({
        id: 'snap-1',
        positions: [
          { symbol: 'AAPL', sector: 'Technology', marketValue: 5000 },
          { symbol: 'MSFT', sector: 'Technology', marketValue: 3000 },
          { symbol: 'JPM', sector: 'Financials', marketValue: 2000 },
        ] as never[],
        totalValue: 10000,
        totalCost: 9000,
        totalPnl: 1000,
        totalPnlPercent: 11.11,
        timestamp: '2024-01-15T16:00:00Z',
        platform: 'INTERACTIVE_BROKERS',
      });
      setMarketSnapshotStore(store);

      const result = await sectorExposureQuery();

      expect(result).toHaveLength(2);
      const tech = result.find((s) => s.sector === 'Technology');
      const fin = result.find((s) => s.sector === 'Financials');
      expect(tech).toBeDefined();
      expect(tech!.weight).toBeCloseTo(0.8);
      expect(tech!.value).toBe(8000);
      expect(fin).toBeDefined();
      expect(fin!.weight).toBeCloseTo(0.2);
      expect(fin!.value).toBe(2000);
    });

    it('falls back to stubs when snapshot has no positions', async () => {
      const store = createMockSnapshotStore({
        id: 'snap-1',
        positions: [],
        totalValue: 0,
        totalCost: 0,
        totalPnl: 0,
        totalPnlPercent: 0,
        timestamp: '2024-01-15T16:00:00Z',
        platform: null,
      });
      setMarketSnapshotStore(store);

      const result = await sectorExposureQuery();

      expect(result).toHaveLength(2);
      expect(result[0].sector).toBe('Technology');
    });
  });
});
