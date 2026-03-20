import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoinbaseApiConnector } from '../../../src/scraper/platforms/coinbase/api-connector.js';
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

describe('CoinbaseApiConnector', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('returns true when API key and secret exist in vault', async () => {
      const vault = makeMockVault({
        COINBASE_API_KEY: 'test-key',
        COINBASE_API_SECRET: 'test-secret',
      });
      const connector = new CoinbaseApiConnector(vault);
      expect(await connector.isAvailable()).toBe(true);
    });

    it('returns false when credentials are missing', async () => {
      const vault = makeMockVault();
      const connector = new CoinbaseApiConnector(vault);
      expect(await connector.isAvailable()).toBe(false);
    });
  });

  describe('properties', () => {
    it('has correct platform metadata', () => {
      const connector = new CoinbaseApiConnector(makeMockVault());
      expect(connector.platformId).toBe('COINBASE');
      expect(connector.platformName).toBe('Coinbase');
      expect(connector.tier).toBe('API');
    });
  });

  describe('connect', () => {
    it('succeeds with valid API response', async () => {
      const vault = makeMockVault({
        COINBASE_API_KEY: 'test-key',
        COINBASE_API_SECRET: 'test-secret',
      });
      const connector = new CoinbaseApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], pagination: { next_uri: null } }), { status: 200 }),
      );

      const result = await connector.connect([]);
      expect(result.success).toBe(true);
    });

    it('fails with invalid credentials', async () => {
      const vault = makeMockVault({
        COINBASE_API_KEY: 'bad-key',
        COINBASE_API_SECRET: 'bad-secret',
      });
      const connector = new CoinbaseApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const result = await connector.connect([]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
    });
  });

  describe('fetchPositions', () => {
    let connector: CoinbaseApiConnector;

    beforeEach(async () => {
      const vault = makeMockVault({
        COINBASE_API_KEY: 'test-key',
        COINBASE_API_SECRET: 'test-secret',
      });
      connector = new CoinbaseApiConnector(vault);

      // Connect first
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], pagination: { next_uri: null } }), { status: 200 }),
      );
      await connector.connect([]);
      vi.restoreAllMocks();
    });

    it('maps Coinbase accounts to ExtractedPosition[]', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: '1',
                name: 'BTC Wallet',
                balance: { amount: '0.5', currency: 'BTC' },
                native_balance: { amount: '25000', currency: 'USD' },
                type: 'wallet',
              },
              {
                id: '2',
                name: 'ETH Wallet',
                balance: { amount: '10', currency: 'ETH' },
                native_balance: { amount: '20000', currency: 'USD' },
                type: 'wallet',
              },
              {
                id: '3',
                name: 'Empty Wallet',
                balance: { amount: '0', currency: 'DOGE' },
                native_balance: { amount: '0', currency: 'USD' },
                type: 'wallet',
              },
            ],
            pagination: { next_uri: null, ending_before: null, starting_after: null, limit: 100, order: 'desc' },
          }),
          { status: 200 },
        ),
      );

      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      if (!result.success) return;

      // Zero-balance wallets are filtered out
      expect(result.positions).toHaveLength(2);

      const btc = result.positions.find((p) => p.symbol === 'BTC')!;
      expect(btc.quantity).toBe(0.5);
      expect(btc.marketValue).toBe(25000);
      expect(btc.currentPrice).toBe(50000);
      expect(btc.assetClass).toBe('CRYPTO');

      const eth = result.positions.find((p) => p.symbol === 'ETH')!;
      expect(eth.quantity).toBe(10);
      expect(eth.marketValue).toBe(20000);
      expect(eth.currentPrice).toBe(2000);

      expect(result.metadata.source).toBe('API');
      expect(result.metadata.platform).toBe('COINBASE');
      expect(result.metadata.confidence).toBe(1);
    });

    it('handles pagination', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      // Page 1 with next_uri
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: '1',
                name: 'BTC',
                balance: { amount: '1', currency: 'BTC' },
                native_balance: { amount: '50000', currency: 'USD' },
                type: 'wallet',
              },
            ],
            pagination: {
              next_uri: '/v2/accounts?starting_after=1',
              ending_before: null,
              starting_after: '1',
              limit: 100,
              order: 'desc',
            },
          }),
          { status: 200 },
        ),
      );

      // Page 2 (last page)
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: '2',
                name: 'ETH',
                balance: { amount: '5', currency: 'ETH' },
                native_balance: { amount: '10000', currency: 'USD' },
                type: 'wallet',
              },
            ],
            pagination: { next_uri: null, ending_before: null, starting_after: null, limit: 100, order: 'desc' },
          }),
          { status: 200 },
        ),
      );

      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.positions).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('returns error on API failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));

      const result = await connector.fetchPositions();
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('500');
    });
  });

  describe('disconnect', () => {
    it('clears credentials', async () => {
      const vault = makeMockVault({
        COINBASE_API_KEY: 'test-key',
        COINBASE_API_SECRET: 'test-secret',
      });
      const connector = new CoinbaseApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: [], pagination: { next_uri: null } }), { status: 200 }),
      );

      await connector.connect([]);
      await connector.disconnect();

      // After disconnect, fetchPositions should fail (empty api key)
      vi.restoreAllMocks();
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Should not be called with valid creds'));

      const result = await connector.fetchPositions();
      // Even with mock error, it should handle gracefully
      expect(result.success).toBe(false);
    });
  });
});
