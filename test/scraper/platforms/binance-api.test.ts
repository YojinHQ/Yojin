import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BinanceApiConnector } from '../../../src/scraper/platforms/binance/api-connector.js';
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

describe('BinanceApiConnector', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('returns true when both keys exist', async () => {
      const vault = makeMockVault({
        BINANCE_API_KEY: 'key',
        BINANCE_API_SECRET: 'secret',
      });
      const connector = new BinanceApiConnector(vault);
      expect(await connector.isAvailable()).toBe(true);
    });

    it('returns false when keys are missing', async () => {
      const connector = new BinanceApiConnector(makeMockVault());
      expect(await connector.isAvailable()).toBe(false);
    });
  });

  describe('properties', () => {
    it('has correct platform metadata', () => {
      const connector = new BinanceApiConnector(makeMockVault());
      expect(connector.platformId).toBe('BINANCE');
      expect(connector.platformName).toBe('Binance');
      expect(connector.tier).toBe('API');
    });
  });

  describe('connect', () => {
    it('succeeds with valid credentials', async () => {
      const vault = makeMockVault({
        BINANCE_API_KEY: 'key',
        BINANCE_API_SECRET: 'secret',
      });
      const connector = new BinanceApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ balances: [] }), { status: 200 }),
      );

      const result = await connector.connect([]);
      expect(result.success).toBe(true);
    });

    it('fails with invalid credentials', async () => {
      const vault = makeMockVault({
        BINANCE_API_KEY: 'bad',
        BINANCE_API_SECRET: 'bad',
      });
      const connector = new BinanceApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Invalid API-key', { status: 401 }));

      const result = await connector.connect([]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
    });
  });

  describe('fetchPositions', () => {
    let connector: BinanceApiConnector;

    beforeEach(async () => {
      const vault = makeMockVault({
        BINANCE_API_KEY: 'key',
        BINANCE_API_SECRET: 'secret',
      });
      connector = new BinanceApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ balances: [] }), { status: 200 }),
      );
      await connector.connect([]);
      vi.restoreAllMocks();
    });

    it('maps Binance balances to positions with prices', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      // Account response
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            balances: [
              { asset: 'BTC', free: '0.5', locked: '0.1' },
              { asset: 'ETH', free: '10', locked: '0' },
              { asset: 'DOGE', free: '0', locked: '0' },
            ],
          }),
          { status: 200 },
        ),
      );

      // Ticker prices response
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { symbol: 'BTCUSDT', price: '50000' },
            { symbol: 'ETHUSDT', price: '2000' },
            { symbol: 'DOGEUSDT', price: '0.1' },
          ]),
          { status: 200 },
        ),
      );

      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      if (!result.success) return;

      // Zero balance (DOGE) filtered out
      expect(result.positions).toHaveLength(2);

      const btc = result.positions.find((p) => p.symbol === 'BTC')!;
      expect(btc.quantity).toBe(0.6); // 0.5 free + 0.1 locked
      expect(btc.currentPrice).toBe(50000);
      expect(btc.marketValue).toBe(30000);
      expect(btc.assetClass).toBe('CRYPTO');

      const eth = result.positions.find((p) => p.symbol === 'ETH')!;
      expect(eth.quantity).toBe(10);
      expect(eth.currentPrice).toBe(2000);
      expect(eth.marketValue).toBe(20000);
    });

    it('handles stablecoins at $1', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            balances: [{ asset: 'USDT', free: '1000', locked: '0' }],
          }),
          { status: 200 },
        ),
      );

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const usdt = result.positions[0]!;
      expect(usdt.symbol).toBe('USDT');
      expect(usdt.currentPrice).toBe(1);
      expect(usdt.marketValue).toBe(1000);
    });

    it('returns empty positions for empty account', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ balances: [] }), { status: 200 }));

      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.positions).toHaveLength(0);
    });

    it('returns error on API failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Server Error', { status: 500 }));

      const result = await connector.fetchPositions();
      expect(result.success).toBe(false);
    });
  });
});
