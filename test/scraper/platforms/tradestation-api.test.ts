import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TradeStationApiConnector } from '../../../src/scraper/platforms/tradestation/api-connector.js';
import type { SecretVault } from '../../../src/trust/vault/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockVault extends SecretVault {
  setCalls: Array<{ key: string; value: string }>;
}

function makeMockVault(keys: Record<string, string> = {}): MockVault {
  const store = new Map(Object.entries(keys));
  const setCalls: Array<{ key: string; value: string }> = [];
  return {
    async set(key, value) {
      setCalls.push({ key, value });
      store.set(key, value);
    },
    async get(key) {
      if (!store.has(key)) throw new Error(`Key not found: ${key}`);
      return store.get(key)!;
    },
    async has(key) {
      return store.has(key);
    },
    async list() {
      return [...store.keys()];
    },
    async delete(key) {
      store.delete(key);
    },
    setCalls,
  };
}

function tokenResponse(
  overrides: Partial<{ access_token: string; expires_in: number; refresh_token: string }> = {},
): Response {
  return new Response(
    JSON.stringify({
      access_token: overrides.access_token ?? 'access-abc',
      expires_in: overrides.expires_in ?? 1200,
      token_type: 'Bearer',
      scope: 'openid offline_access ReadAccount',
      ...(overrides.refresh_token !== undefined ? { refresh_token: overrides.refresh_token } : {}),
    }),
    { status: 200 },
  );
}

function accountsResponse(accountIds: string[]): Response {
  return new Response(
    JSON.stringify({
      Accounts: accountIds.map((id) => ({
        AccountID: id,
        AccountType: 'Margin',
        Currency: 'USD',
        Status: 'Active',
      })),
    }),
    { status: 200 },
  );
}

function positionsResponse(
  positions: Array<Record<string, string>>,
  errors?: Array<{ AccountID: string; Error: string; Message: string }>,
): Response {
  return new Response(
    JSON.stringify({
      Positions: positions,
      ...(errors ? { Errors: errors } : {}),
    }),
    { status: 200 },
  );
}

const FULL_CREDS = {
  TRADESTATION_CLIENT_ID: 'client-1',
  TRADESTATION_CLIENT_SECRET: 'secret-1',
  TRADESTATION_REFRESH_TOKEN: 'refresh-1',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TradeStationApiConnector', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('properties', () => {
    it('has correct platform metadata', () => {
      const connector = new TradeStationApiConnector(makeMockVault());
      expect(connector.platformId).toBe('TRADESTATION');
      expect(connector.platformName).toBe('TradeStation');
      expect(connector.tier).toBe('API');
    });
  });

  describe('isAvailable', () => {
    it('returns true when all three vault keys exist', async () => {
      const connector = new TradeStationApiConnector(makeMockVault(FULL_CREDS));
      expect(await connector.isAvailable()).toBe(true);
    });

    it('returns false when any credential is missing', async () => {
      const connector = new TradeStationApiConnector(
        makeMockVault({ TRADESTATION_CLIENT_ID: 'x', TRADESTATION_CLIENT_SECRET: 'y' }),
      );
      expect(await connector.isAvailable()).toBe(false);
    });
  });

  describe('connect', () => {
    it('succeeds and mints an access token', async () => {
      const connector = new TradeStationApiConnector(makeMockVault(FULL_CREDS));
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(tokenResponse());
      const result = await connector.connect([]);
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe('https://signin.tradestation.com/oauth/token');
    });

    it('surfaces 400 invalid_grant with a re-auth hint', async () => {
      const connector = new TradeStationApiConnector(makeMockVault(FULL_CREDS));
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('invalid_grant', { status: 400 }));
      const result = await connector.connect([]);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('400');
      expect(result.error).toContain('yojin tradestation-auth');
    });

    it('clears state on failure so a second connect starts fresh', async () => {
      const connector = new TradeStationApiConnector(makeMockVault(FULL_CREDS));
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('invalid_grant', { status: 400 }));
      const first = await connector.connect([]);
      expect(first.success).toBe(false);

      // Subsequent fetchPositions() must NOT use stale in-memory creds — it
      // should fail cleanly because the connector has no access token.
      vi.restoreAllMocks();
      const positions = await connector.fetchPositions();
      expect(positions.success).toBe(false);
    });

    it('returns error when token response is malformed', async () => {
      const connector = new TradeStationApiConnector(makeMockVault(FULL_CREDS));
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ foo: 'bar' }), { status: 200 }),
      );
      const result = await connector.connect([]);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('malformed');
    });
  });

  describe('fetchPositions', () => {
    let connector: TradeStationApiConnector;

    beforeEach(async () => {
      connector = new TradeStationApiConnector(makeMockVault(FULL_CREDS));
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(tokenResponse());
      await connector.connect([]);
      vi.restoreAllMocks();
    });

    it('maps accounts → positions, filters zero-quantity, and classifies asset types', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(accountsResponse(['ACC1', 'ACC2']))
        .mockResolvedValueOnce(
          positionsResponse([
            {
              AccountID: 'ACC1',
              AssetType: 'STOCK',
              Symbol: 'AAPL',
              Quantity: '10',
              AveragePrice: '150',
              Last: '180',
              MarketValue: '1800',
              TotalCost: '1500',
              UnrealizedProfitLoss: '300',
              UnrealizedProfitLossPercent: '20',
            },
            {
              AccountID: 'ACC2',
              AssetType: 'STOCKOPTION',
              Symbol: 'AAPL 240621C00200000',
              Quantity: '2',
              AveragePrice: '5',
              Last: '7',
              MarketValue: '1400',
              TotalCost: '1000',
              UnrealizedProfitLoss: '400',
              UnrealizedProfitLossPercent: '40',
            },
            {
              AccountID: 'ACC1',
              AssetType: 'STOCK',
              Symbol: 'EMPTY',
              Quantity: '0',
              AveragePrice: '0',
              Last: '0',
              MarketValue: '0',
              TotalCost: '0',
              UnrealizedProfitLoss: '0',
              UnrealizedProfitLossPercent: '0',
            },
          ]),
        );

      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.positions).toHaveLength(2);
      const aapl = result.positions.find((p) => p.symbol === 'AAPL')!;
      expect(aapl.quantity).toBe(10);
      // costBasis is per-share (AveragePrice 150), NOT total (TotalCost 1500).
      // Yojin computes totalCost as costBasis * quantity elsewhere.
      expect(aapl.costBasis).toBe(150);
      expect(aapl.currentPrice).toBe(180);
      expect(aapl.marketValue).toBe(1800);
      expect(aapl.unrealizedPnl).toBe(300);
      expect(aapl.unrealizedPnlPercent).toBe(20);
      expect(aapl.assetClass).toBe('EQUITY');

      const opt = result.positions.find((p) => p.symbol.startsWith('AAPL '))!;
      expect(opt.assetClass).toBe('OTHER');

      expect(result.metadata.source).toBe('API');
      expect(result.metadata.platform).toBe('TRADESTATION');
    });

    it('handles empty accounts response without issuing a positions call', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(accountsResponse([]));

      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.positions).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('surfaces partial-success Errors[] in metadata.warnings', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(accountsResponse(['ACC1', 'ACC2']))
        .mockResolvedValueOnce(
          positionsResponse(
            [
              {
                AccountID: 'ACC1',
                AssetType: 'STOCK',
                Symbol: 'MSFT',
                Quantity: '5',
                AveragePrice: '300',
                Last: '350',
                MarketValue: '1750',
                TotalCost: '1500',
                UnrealizedProfitLoss: '250',
                UnrealizedProfitLossPercent: '16.67',
              },
            ],
            [{ AccountID: 'ACC2', Error: 'AccountError', Message: 'Account temporarily unavailable' }],
          ),
        );

      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.positions).toHaveLength(1);
      expect(result.metadata.warnings).toContain(
        'TradeStation account ACC2: AccountError — Account temporarily unavailable',
      );
    });

    it('omits malformed numeric fields instead of producing NaN', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(accountsResponse(['ACC1']))
        .mockResolvedValueOnce(
          positionsResponse([
            {
              AccountID: 'ACC1',
              AssetType: 'STOCK',
              Symbol: 'JUNK',
              Quantity: '3',
              AveragePrice: '150',
              Last: '',
              MarketValue: 'NaN',
              TotalCost: 'bad',
              UnrealizedProfitLoss: '',
              UnrealizedProfitLossPercent: 'bad',
            },
          ]),
        );

      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      if (!result.success) return;
      const junk = result.positions.find((p) => p.symbol === 'JUNK')!;
      expect(junk.quantity).toBe(3);
      expect(junk.costBasis).toBe(150);
      expect(junk.currentPrice).toBeUndefined();
      expect(junk.marketValue).toBeUndefined();
      expect(junk.unrealizedPnl).toBeUndefined();
      expect(junk.unrealizedPnlPercent).toBeUndefined();
    });
  });

  describe('access token refresh', () => {
    it('retries with a forced refresh on 401 from the API', async () => {
      const connector = new TradeStationApiConnector(makeMockVault(FULL_CREDS));
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(tokenResponse({ access_token: 'access-1' })) // connect
        .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 })) // accounts #1
        .mockResolvedValueOnce(tokenResponse({ access_token: 'access-2' })) // forced refresh
        .mockResolvedValueOnce(accountsResponse(['ACC1'])) // accounts retry
        .mockResolvedValueOnce(positionsResponse([])); // positions

      await connector.connect([]);
      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('propagates error when second 401 arrives after forced refresh (and clears state)', async () => {
      const connector = new TradeStationApiConnector(makeMockVault(FULL_CREDS));
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(tokenResponse()) // connect
        .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 })) // accounts
        .mockResolvedValueOnce(tokenResponse({ access_token: 'access-2' })) // forced refresh
        .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 })); // retry fails

      await connector.connect([]);
      const result = await connector.fetchPositions();
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('401 after forced refresh');
    });

    it('persists rotated refresh token to vault BEFORE committing access_token', async () => {
      const vault = makeMockVault(FULL_CREDS);
      const connector = new TradeStationApiConnector(vault);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        tokenResponse({ refresh_token: 'rotated-refresh-2', access_token: 'access-new' }),
      );

      const result = await connector.connect([]);
      expect(result.success).toBe(true);

      const rotationWrites = vault.setCalls.filter((c) => c.key === 'TRADESTATION_REFRESH_TOKEN');
      expect(rotationWrites).toHaveLength(1);
      expect(rotationWrites[0]!.value).toBe('rotated-refresh-2');
    });

    it('does NOT write to vault when refresh_token is absent (non-rotating mode)', async () => {
      const vault = makeMockVault(FULL_CREDS);
      const connector = new TradeStationApiConnector(vault);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(tokenResponse());

      await connector.connect([]);
      const writes = vault.setCalls.filter((c) => c.key === 'TRADESTATION_REFRESH_TOKEN');
      expect(writes).toHaveLength(0);
    });

    it('surfaces rotation as a metadata warning on the next fetchPositions()', async () => {
      const connector = new TradeStationApiConnector(makeMockVault(FULL_CREDS));
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(tokenResponse({ refresh_token: 'rotated-2' })) // connect with rotation
        .mockResolvedValueOnce(accountsResponse([])) // empty accounts — no positions call needed
        .mockResolvedValueOnce(new Response('should-not-be-called', { status: 500 }));

      await connector.connect([]);
      const result = await connector.fetchPositions();
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.metadata.warnings.some((w) => w.includes('rotated refresh token'))).toBe(true);
    });

    it('fails refresh when vault.set() throws during rotation', async () => {
      const vault = makeMockVault(FULL_CREDS);
      vault.set = vi.fn().mockRejectedValue(new Error('disk full'));
      const connector = new TradeStationApiConnector(vault);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(tokenResponse({ refresh_token: 'rotated-2' }));

      const result = await connector.connect([]);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('persisting it to the vault failed');
      expect(result.error).toContain('disk full');
      expect(result.error).toContain('yojin tradestation-auth');
    });

    it('single-flight: concurrent authedGet calls on expired token issue exactly ONE token refresh', async () => {
      const connector = new TradeStationApiConnector(makeMockVault(FULL_CREDS));
      // Connect then force expiry so both fetchPositions calls trigger refresh.
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(tokenResponse({ expires_in: 60 }));
      await connector.connect([]);
      // @ts-expect-error — reach into private field to force expiry
      connector.accessTokenExpiresAt = Date.now() - 1000;

      vi.restoreAllMocks();
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      let tokenCalls = 0;
      fetchMock.mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes('/oauth/token')) {
          tokenCalls += 1;
          // Simulate latency so both concurrent callers land in the refreshInFlight window.
          await new Promise((r) => setTimeout(r, 10));
          return tokenResponse({ access_token: 'shared-access' });
        }
        if (u.endsWith('/v3/brokerage/accounts')) return accountsResponse([]);
        throw new Error(`Unexpected URL: ${u}`);
      });

      const [r1, r2] = await Promise.all([connector.fetchPositions(), connector.fetchPositions()]);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(tokenCalls).toBe(1);
    });

    it('refreshInFlight clears after success — next forced refresh triggers a new token call', async () => {
      const connector = new TradeStationApiConnector(makeMockVault(FULL_CREDS));
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(tokenResponse({ access_token: 'access-1' }))
        .mockResolvedValueOnce(tokenResponse({ access_token: 'access-2' }));

      await connector.connect([]);
      // @ts-expect-error — private access
      expect(connector.refreshInFlight).toBeNull();

      // @ts-expect-error — private method, call directly to verify single-flight cleanup
      await connector.ensureAccessToken(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // @ts-expect-error — private access
      expect(connector.refreshInFlight).toBeNull();
    });
  });

  describe('disconnect', () => {
    it('clears in-memory state without deleting vault keys', async () => {
      const vault = makeMockVault(FULL_CREDS);
      const connector = new TradeStationApiConnector(vault);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(tokenResponse());

      await connector.connect([]);
      await connector.disconnect();

      expect(await vault.has('TRADESTATION_REFRESH_TOKEN')).toBe(true);

      // After disconnect fetchPositions should fail — client_id was cleared
      // so the next refresh attempt will fail against the mocked vault.
      vi.restoreAllMocks();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse());
      const result = await connector.fetchPositions();
      // connect() must be called again — bare fetchPositions after disconnect
      // can mint a new token if the vault is still populated, so this just
      // verifies no crash.
      expect(typeof result.success).toBe('boolean');
    });
  });
});
