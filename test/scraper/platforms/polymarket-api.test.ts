import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PolymarketApiConnector } from '../../../src/scraper/platforms/polymarket/api-connector.js';
import type { SecretVault } from '../../../src/trust/vault/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockVault(keys: Record<string, string> = {}): SecretVault {
  const store = new Map(Object.entries(keys));
  return {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PolymarketApiConnector', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('returns true when API key exists', async () => {
      const vault = makeMockVault({ POLYMARKET_API_KEY: 'test-key' });
      const connector = new PolymarketApiConnector(vault);
      expect(await connector.isAvailable()).toBe(true);
    });

    it('returns false when API key is missing', async () => {
      const connector = new PolymarketApiConnector(makeMockVault());
      expect(await connector.isAvailable()).toBe(false);
    });
  });

  describe('properties', () => {
    it('has correct platform metadata', () => {
      const connector = new PolymarketApiConnector(makeMockVault());
      expect(connector.platformId).toBe('POLYMARKET');
      expect(connector.platformName).toBe('Polymarket');
      expect(connector.tier).toBe('API');
    });
  });

  describe('connect', () => {
    it('succeeds with valid API key', async () => {
      const vault = makeMockVault({ POLYMARKET_API_KEY: 'valid-key' });
      const connector = new PolymarketApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ positions: [] }), { status: 200 }),
      );

      const result = await connector.connect([]);
      expect(result.success).toBe(true);
    });

    it('fails with invalid API key', async () => {
      const vault = makeMockVault({ POLYMARKET_API_KEY: 'bad-key' });
      const connector = new PolymarketApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

      const result = await connector.connect([]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('403');
    });
  });

  describe('fetchPositions', () => {
    let connector: PolymarketApiConnector;

    beforeEach(async () => {
      const vault = makeMockVault({ POLYMARKET_API_KEY: 'test-key' });
      connector = new PolymarketApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ positions: [] }), { status: 200 }),
      );
      await connector.connect([]);
      vi.restoreAllMocks();
    });

    it('maps Polymarket positions to ExtractedPosition[]', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            positions: [
              {
                market_id: 'abc12345-6789-0000-0000-000000000000',
                title: 'Will BTC reach $100k by 2027?',
                outcome: 'Yes',
                size: 100,
                avg_price: 0.65,
                current_price: 0.78,
                pnl: 13,
              },
              {
                market_id: 'def12345-6789-0000-0000-000000000000',
                title: 'US Election 2028 Winner',
                outcome: 'Candidate A',
                size: 50,
                avg_price: 0.4,
                current_price: 0.55,
                pnl: 7.5,
              },
            ],
          }),
          { status: 200 },
        ),
      );

      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.positions).toHaveLength(2);

      const btcMarket = result.positions[0]!;
      expect(btcMarket.symbol).toBe('POLY-abc12345');
      expect(btcMarket.name).toContain('BTC');
      expect(btcMarket.name).toContain('Yes');
      expect(btcMarket.quantity).toBe(100);
      expect(btcMarket.currentPrice).toBe(0.78);
      expect(btcMarket.marketValue).toBe(78);
      expect(btcMarket.costBasis).toBe(65);
      expect(btcMarket.unrealizedPnl).toBe(13);
      expect(btcMarket.assetClass).toBe('OTHER');

      expect(result.metadata.platform).toBe('POLYMARKET');
    });

    it('returns error on API failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Server Error', { status: 500 }));

      const result = await connector.fetchPositions();
      expect(result.success).toBe(false);
    });
  });
});
