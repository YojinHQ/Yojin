import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IbkrApiConnector } from '../../../src/scraper/platforms/ibkr/api-connector.js';
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

describe('IbkrApiConnector', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('returns true when gateway port is configured', async () => {
      const vault = makeMockVault({ IBKR_GATEWAY_PORT: '5000' });
      const connector = new IbkrApiConnector(vault);
      expect(await connector.isAvailable()).toBe(true);
    });

    it('returns false when gateway port is missing', async () => {
      const connector = new IbkrApiConnector(makeMockVault());
      expect(await connector.isAvailable()).toBe(false);
    });
  });

  describe('properties', () => {
    it('has correct platform metadata', () => {
      const connector = new IbkrApiConnector(makeMockVault());
      expect(connector.platformId).toBe('INTERACTIVE_BROKERS');
      expect(connector.platformName).toBe('Interactive Brokers');
      expect(connector.tier).toBe('API');
    });
  });

  describe('connect', () => {
    it('succeeds when gateway is authenticated', async () => {
      const vault = makeMockVault({ IBKR_GATEWAY_PORT: '5000' });
      const connector = new IbkrApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ authenticated: true }), { status: 200 }),
      );

      const result = await connector.connect([]);
      expect(result.success).toBe(true);
    });

    it('fails when gateway is not authenticated', async () => {
      const vault = makeMockVault({ IBKR_GATEWAY_PORT: '5000' });
      const connector = new IbkrApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ authenticated: false }), { status: 200 }),
      );

      const result = await connector.connect([]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not authenticated');
    });

    it('fails when gateway is unreachable', async () => {
      const vault = makeMockVault({ IBKR_GATEWAY_PORT: '5000' });
      const connector = new IbkrApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await connector.connect([]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });
  });

  describe('fetchPositions', () => {
    let connector: IbkrApiConnector;

    beforeEach(async () => {
      const vault = makeMockVault({ IBKR_GATEWAY_PORT: '5000' });
      connector = new IbkrApiConnector(vault);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ authenticated: true }), { status: 200 }),
      );
      await connector.connect([]);
      vi.restoreAllMocks();
    });

    it('maps IBKR positions to ExtractedPosition[]', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');

      // Accounts response
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: '1', accountId: 'U1234567', type: 'individual' }]), { status: 200 }),
      );

      // Positions response
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              acctId: 'U1234567',
              conid: 265598,
              contractDesc: 'Apple Inc',
              position: 100,
              mktPrice: 175.5,
              mktValue: 17550,
              unrealizedPnl: 500,
              currency: 'USD',
              assetClass: 'STK',
              ticker: 'AAPL',
            },
            {
              acctId: 'U1234567',
              conid: 8314,
              contractDesc: 'US Treasury Bond',
              position: 10,
              mktPrice: 98.5,
              mktValue: 985,
              unrealizedPnl: -15,
              currency: 'USD',
              assetClass: 'BOND',
            },
          ]),
          { status: 200 },
        ),
      );

      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.positions).toHaveLength(2);

      const aapl = result.positions.find((p) => p.symbol === 'AAPL')!;
      expect(aapl.quantity).toBe(100);
      expect(aapl.currentPrice).toBe(175.5);
      expect(aapl.marketValue).toBe(17550);
      expect(aapl.unrealizedPnl).toBe(500);
      expect(aapl.assetClass).toBe('EQUITY');

      const bond = result.positions.find((p) => p.symbol === 'US Treasury Bond')!;
      expect(bond.assetClass).toBe('BOND');
    });

    it('returns error when no accounts found', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

      const result = await connector.fetchPositions();
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('No IBKR accounts found');
    });
  });
});
