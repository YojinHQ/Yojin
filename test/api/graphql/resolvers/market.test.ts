import type { JintelClient } from '@yojinhq/jintel-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { newsQuery, quoteQuery, setMarketJintelClient } from '../../../../src/api/graphql/resolvers/market.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockJintelClient(overrides: Partial<JintelClient> = {}): JintelClient {
  return {
    quotes: vi.fn().mockResolvedValue({ success: false, error: 'not configured' }),
    searchEntities: vi.fn(),
    enrichEntity: vi.fn().mockResolvedValue({
      success: true,
      data: {
        name: 'Apple Inc.',
        market: {
          quote: {
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
          },
        },
      },
    }),
    sanctionsScreen: vi.fn(),
    healthCheck: vi.fn(),
    ...overrides,
  } as unknown as JintelClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('market resolvers', () => {
  beforeEach(() => {
    setMarketJintelClient(undefined);
  });

  // ── quoteQuery ────────────────────────────────────────────────────────

  describe('quoteQuery', () => {
    it('returns Jintel data when client is available', async () => {
      const client = createMockJintelClient();
      setMarketJintelClient(client);

      const result = await quoteQuery(null, { symbol: 'AAPL' });

      expect(client.enrichEntity).toHaveBeenCalledWith('AAPL', ['market']);
      expect(result).toEqual({
        symbol: 'AAPL',
        name: 'Apple Inc.',
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
        enrichEntity: vi.fn().mockResolvedValue({ success: false, error: 'API down' }),
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

      expect(client.enrichEntity).toHaveBeenCalledWith('AAPL', ['market']);
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
});
