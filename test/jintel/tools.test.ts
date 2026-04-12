import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Entity, JintelClient, JintelResult, MarketQuote, SanctionsMatch } from '@yojinhq/jintel-client';
import { JintelAuthError } from '@yojinhq/jintel-client';
import { describe, expect, it, vi } from 'vitest';

import { createJintelTools, riskSignalsToRaw } from '../../src/jintel/tools.js';
import { PortfolioSnapshotStore } from '../../src/portfolio/snapshot-store.js';
import type { RawSignalInput, SignalIngestor } from '../../src/signals/ingestor.js';

// ── Mock Helpers ─────────────────────────────────────────────────────────

function ok<T>(data: T): JintelResult<T> {
  return { success: true, data };
}

function fail<T>(error: string): JintelResult<T> {
  return { success: false, error };
}

const MOCK_ENTITIES: Entity[] = [
  {
    id: 'aapl',
    name: 'Apple Inc.',
    type: 'COMPANY',
    tickers: ['AAPL'],
    domain: 'apple.com',
    country: 'US',
  },
  {
    id: 'msft',
    name: 'Microsoft Corp.',
    type: 'COMPANY',
    tickers: ['MSFT'],
    country: 'US',
  },
];

const MOCK_ENRICHED_ENTITY: Entity = {
  id: 'aapl',
  name: 'Apple Inc.',
  type: 'COMPANY',
  tickers: ['AAPL'],
  market: {
    quote: {
      ticker: 'AAPL',
      price: 178.5,
      change: 2.3,
      changePercent: 1.3,
      volume: 45_000_000,
      timestamp: '2024-01-15T16:00:00Z',
      source: 'jintel',
    },
    fundamentals: {
      marketCap: 2_800_000_000_000,
      peRatio: 28.5,
      eps: 6.26,
      sector: 'Technology',
      source: 'jintel',
    },
  },
  risk: {
    overallScore: 25,
    signals: [
      {
        type: 'REGULATORY_ACTION',
        severity: 'MEDIUM',
        description: 'EU antitrust investigation ongoing',
        source: 'EU Commission',
        date: '2024-01-10T00:00:00Z',
      },
      {
        type: 'LITIGATION',
        severity: 'HIGH',
        description: 'Patent dispute with Qualcomm',
        source: 'US District Court',
      },
    ],
    sanctionsHits: 0,
    adverseMediaHits: 1,
    regulatoryActions: 1,
  },
};

const MOCK_QUOTES: MarketQuote[] = [
  {
    ticker: 'AAPL',
    price: 178.5,
    change: 2.3,
    changePercent: 1.3,
    volume: 45_000_000,
    timestamp: '2024-01-15T16:00:00Z',
    source: 'jintel',
  },
  {
    ticker: 'GOOG',
    price: 141.8,
    change: -0.5,
    changePercent: -0.35,
    volume: 22_000_000,
    timestamp: '2024-01-15T16:00:00Z',
    source: 'jintel',
  },
];

const MOCK_PRICE_HISTORY = [
  {
    ticker: 'AAPL',
    history: [
      { date: '2024-01-10', open: 175, high: 180, low: 174, close: 178, volume: 10_000_000 },
      { date: '2024-01-11', open: 178, high: 181, low: 177, close: 180, volume: 12_000_000 },
    ],
  },
];

const MOCK_SANCTIONS: SanctionsMatch[] = [
  {
    listName: 'OFAC SDN',
    matchedName: 'John Smith LLC',
    score: 0.92,
    details: 'Designated for sanctions evasion',
  },
];

function createMockClient(overrides: Partial<JintelClient> = {}): JintelClient {
  return {
    searchEntities: vi.fn().mockResolvedValue(ok(MOCK_ENTITIES)),
    enrichEntity: vi.fn().mockResolvedValue(ok(MOCK_ENRICHED_ENTITY)),
    batchEnrich: vi.fn().mockResolvedValue(ok([MOCK_ENRICHED_ENTITY])),
    quotes: vi.fn().mockResolvedValue(ok(MOCK_QUOTES)),
    priceHistory: vi.fn().mockResolvedValue(ok(MOCK_PRICE_HISTORY)),
    sanctionsScreen: vi.fn().mockResolvedValue(ok(MOCK_SANCTIONS)),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 50 }),
    request: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as JintelClient;
}

function createMockIngestor(): SignalIngestor & { ingest: ReturnType<typeof vi.fn> } {
  return {
    ingest: vi.fn().mockResolvedValue({ ingested: 0, duplicates: 0, errors: [] }),
    initialize: vi.fn().mockResolvedValue(undefined),
  } as unknown as SignalIngestor & { ingest: ReturnType<typeof vi.fn> };
}

function findTool(
  name: string,
  client?: JintelClient,
  ingestor?: SignalIngestor,
  snapshotStore?: PortfolioSnapshotStore,
) {
  const tools = createJintelTools({ client, ingestor, snapshotStore });
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

function createSnapshotStore() {
  const dir = mkdtempSync(join(tmpdir(), 'yojin-jintel-tools-'));
  return { dir, store: new PortfolioSnapshotStore(dir) };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('jintel tools', () => {
  describe('search_entities', () => {
    it('returns formatted entity list from mocked client', async () => {
      const client = createMockClient();
      const tool = findTool('search_entities', client);

      const result = await tool.execute({ query: 'Apple' });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('Apple Inc.');
      expect(result.content).toContain('COMPANY');
      expect(result.content).toContain('AAPL');
      expect(result.content).toContain('Microsoft Corp.');
      expect(client.searchEntities).toHaveBeenCalledWith('Apple', { type: undefined, limit: undefined });
    });
  });

  describe('enrich_entity', () => {
    it('returns formatted enrichment sections', async () => {
      const client = createMockClient();
      const tool = findTool('enrich_entity', client);

      const result = await tool.execute({ ticker: 'AAPL' });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('# Apple Inc.');
      expect(result.content).toContain('## Market');
      expect(result.content).toContain('$178.50');
      expect(result.content).toContain('## Fundamentals');
      expect(result.content).toContain('P/E: 28.5');
      expect(result.content).toContain('## Risk (score: 25)');
      expect(result.content).toContain('REGULATORY_ACTION');
    });

    it('ingests risk signals as REGULATORY type', async () => {
      const client = createMockClient();
      const ingestor = createMockIngestor();
      const tool = findTool('enrich_entity', client, ingestor);

      await tool.execute({ ticker: 'AAPL' });

      expect(ingestor.ingest).toHaveBeenCalledTimes(1);
      const ingestCall = ingestor.ingest.mock.calls[0][0] as RawSignalInput[];

      // 2 risk signals (REGULATORY_ACTION + LITIGATION → both REGULATORY)
      expect(ingestCall).toHaveLength(2);

      const riskItems = ingestCall.filter((i) => i.type === 'REGULATORY');
      expect(riskItems).toHaveLength(2);

      const mediumRisk = riskItems.find((i) => i.title.includes('MEDIUM'));
      expect(mediumRisk).toBeDefined();
      expect(mediumRisk!.confidence).toBe(0.7);
      expect(mediumRisk!.tickers).toEqual(['AAPL']);

      const highRisk = riskItems.find((i) => i.title.includes('HIGH'));
      expect(highRisk).toBeDefined();
      expect(highRisk!.confidence).toBe(0.85);
    });
  });

  describe('riskSignalsToRaw', () => {
    it('maps SANCTIONS/REGULATORY_ACTION/LITIGATION/PEP to REGULATORY', () => {
      const signals = riskSignalsToRaw(
        [
          { type: 'REGULATORY_ACTION', severity: 'HIGH', description: 'Fine', source: 'SEC', date: null },
          { type: 'LITIGATION', severity: 'HIGH', description: 'Lawsuit', source: 'Court', date: null },
          { type: 'PEP', severity: 'HIGH', description: 'PEP flag', source: 'DB', date: null },
          { type: 'SANCTIONS', severity: 'HIGH', description: 'SDN hit', source: 'OFAC', date: null },
        ],
        ['AAPL'],
      );
      expect(signals).toHaveLength(4);
      expect(signals.every((s) => s.type === 'REGULATORY')).toBe(true);
    });

    it('maps ADVERSE_MEDIA to SENTIMENT', () => {
      const signals = riskSignalsToRaw(
        [{ type: 'ADVERSE_MEDIA', severity: 'MEDIUM', description: 'Bad press', source: 'News', date: null }],
        ['AAPL'],
      );
      expect(signals).toHaveLength(1);
      expect(signals[0].type).toBe('SENTIMENT');
    });

    it('filters out SANCTIONS with severity below HIGH', () => {
      const signals = riskSignalsToRaw(
        [
          { type: 'SANCTIONS', severity: 'MEDIUM', description: 'Fuzzy match', source: 'OFAC', date: null },
          { type: 'SANCTIONS', severity: 'LOW', description: 'Weak match', source: 'OFAC', date: null },
          { type: 'SANCTIONS', severity: 'HIGH', description: 'Strong match', source: 'OFAC', date: null },
          { type: 'SANCTIONS', severity: 'CRITICAL', description: 'Exact match', source: 'OFAC', date: null },
        ],
        ['MP'],
      );
      // Only HIGH and CRITICAL pass the filter
      expect(signals).toHaveLength(2);
      expect(signals[0].title).toContain('Strong match');
      expect(signals[1].title).toContain('Exact match');
    });

    it('does not filter non-SANCTIONS risk signals by severity', () => {
      const signals = riskSignalsToRaw(
        [
          { type: 'LITIGATION', severity: 'LOW', description: 'Minor suit', source: 'Court', date: null },
          { type: 'REGULATORY_ACTION', severity: 'MEDIUM', description: 'Warning', source: 'SEC', date: null },
        ],
        ['AAPL'],
      );
      expect(signals).toHaveLength(2);
    });
  });

  describe('batch_enrich', () => {
    it('uses batchEnrich client method (single API call)', async () => {
      const client = createMockClient();
      const tool = findTool('batch_enrich', client);

      const result = await tool.execute({ tickers: ['AAPL', 'MSFT'] });

      expect(result.isError).toBeUndefined();
      expect(client.batchEnrich).toHaveBeenCalledWith(['AAPL', 'MSFT'], ['market', 'risk']);
      expect(result.content).toContain('Apple Inc.');
    });
  });

  describe('market_quotes', () => {
    it('returns formatted quote lines', async () => {
      const client = createMockClient();
      const tool = findTool('market_quotes', client);

      const result = await tool.execute({ tickers: ['AAPL', 'GOOG'] });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('AAPL: $178.50');
      expect(result.content).toContain('GOOG: $141.80');
      expect(result.content).toContain('↑');
      expect(result.content).toContain('↓');
    });
  });

  describe('jintel_query', () => {
    it('routes quote queries through Jintel quotes', async () => {
      const client = createMockClient();
      const tool = findTool('jintel_query', client);

      const result = await tool.execute({ kind: 'quote', tickers: ['AAPL', 'GOOG'] });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('AAPL: $178.50');
      expect(client.quotes).toHaveBeenCalledWith(['AAPL', 'GOOG']);
    });

    it('routes history queries through Jintel price history', async () => {
      const client = createMockClient();
      const tool = findTool('jintel_query', client);

      const result = await tool.execute({ kind: 'history', ticker: 'AAPL', range: '1m', interval: '1d' });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('## AAPL (2 candles)');
      expect(result.content).toContain('Period change');
      expect(client.priceHistory).toHaveBeenCalledWith(['AAPL'], '1m', '1d');
    });
  });

  describe('sanctions_screen', () => {
    it('returns formatted sanctions matches', async () => {
      const client = createMockClient();
      const tool = findTool('sanctions_screen', client);

      const result = await tool.execute({ name: 'John Smith' });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('WARNING');
      expect(result.content).toContain('OFAC SDN');
      expect(result.content).toContain('John Smith LLC');
      expect(result.content).toContain('0.92');
    });
  });

  describe('economy tools', () => {
    it('get_gdp calls request with GDP query', async () => {
      const mockData = [
        { date: '2024-Q4', country: 'US', value: 28.78 },
        { date: '2024-Q3', country: 'US', value: 28.36 },
      ];
      const client = createMockClient({ request: vi.fn().mockResolvedValue(mockData) });
      const tool = findTool('get_gdp', client);

      const result = await tool.execute({ country: 'United States', type: 'REAL' });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('GDP');
      expect(result.content).toContain('28.78');
      expect(result.content).toContain('US');
      expect(client.request).toHaveBeenCalled();
    });

    it('get_inflation calls request with INFLATION query', async () => {
      const mockData = [{ date: '2024-12', country: 'US', value: 2.9 }];
      const client = createMockClient({ request: vi.fn().mockResolvedValue(mockData) });
      const tool = findTool('get_inflation', client);

      const result = await tool.execute({ country: 'United States' });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('Inflation');
      expect(result.content).toContain('2.90');
    });

    it('get_interest_rates calls request with INTEREST_RATES query', async () => {
      const mockData = [{ date: '2024-12', country: 'US', value: 4.5 }];
      const client = createMockClient({ request: vi.fn().mockResolvedValue(mockData) });
      const tool = findTool('get_interest_rates', client);

      const result = await tool.execute({ country: 'United States' });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('Interest Rates');
      expect(result.content).toContain('4.50');
    });

    it('get_sp500_multiples calls request with SP500_MULTIPLES query', async () => {
      const mockData = [
        { date: '2024-12', name: 'S&P 500 PE Ratio', value: 24.5 },
        { date: '2024-11', name: 'S&P 500 PE Ratio', value: 23.8 },
      ];
      const client = createMockClient({ request: vi.fn().mockResolvedValue(mockData) });
      const tool = findTool('get_sp500_multiples', client);

      const result = await tool.execute({ series: 'PE_MONTH' });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('S&P 500');
      expect(result.content).toContain('24.50');
    });
  });

  describe('jintel failure', () => {
    it('returns isError with fallback guidance on failure', async () => {
      const client = createMockClient({
        searchEntities: vi.fn().mockResolvedValue(fail('Connection timeout')),
      });
      const tool = findTool('search_entities', client);

      const result = await tool.execute({ query: 'Apple' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Connection timeout');
      expect(result.content).toContain('fallback');
      expect(result.content).toContain('connected source');
    });

    it('quotes failure returns error with fallback', async () => {
      const client = createMockClient({
        quotes: vi.fn().mockResolvedValue(fail('Rate limit exceeded')),
      });
      const tool = findTool('market_quotes', client);

      const result = await tool.execute({ tickers: ['AAPL'] });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Rate limit exceeded');
      expect(result.content).toContain('connected source');
    });

    it('auth error returns re-onboarding guidance', async () => {
      const client = createMockClient({
        request: vi.fn().mockRejectedValue(new JintelAuthError('Invalid API key')),
      });
      const tool = findTool('get_gdp', client);

      const result = await tool.execute({ country: 'US' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('401 Unauthorized');
      expect(result.content).toContain('Vault');
    });
  });

  describe('client undefined (not configured)', () => {
    it('all tools return not-configured error', async () => {
      const tools = createJintelTools({ client: undefined, ingestor: undefined });

      for (const tool of tools) {
        const result = await tool.execute({
          query: 'test',
          ticker: 'AAPL',
          tickers: ['AAPL'],
          name: 'test',
          country: 'US',
          series: 'PE_MONTH',
        });
        expect(result.isError).toBe(true);
        expect(result.content).toContain('Jintel API key not configured');
        expect(result.content).toContain('Settings');
        expect(result.content).toContain('Vault');
      }
    });
  });

  describe('ingestor error is best-effort', () => {
    it('enrich_entity succeeds even when ingestor throws', async () => {
      const client = createMockClient();
      const ingestor = createMockIngestor();
      ingestor.ingest.mockRejectedValue(new Error('Archive write failed'));

      const tool = findTool('enrich_entity', client, ingestor);
      const result = await tool.execute({ ticker: 'AAPL' });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('Apple Inc.');
    });
  });

  describe('portfolio enrichment tools', () => {
    it('enrich_position adds redacted portfolio context', async () => {
      const { dir, store } = createSnapshotStore();
      try {
        await store.save({
          platform: 'MANUAL',
          positions: [
            {
              symbol: 'AAPL',
              name: 'Apple Inc.',
              quantity: 25,
              costBasis: 150,
              currentPrice: 180,
              marketValue: 4500,
              unrealizedPnl: 750,
              unrealizedPnlPercent: 20,
              assetClass: 'EQUITY',
              platform: 'MANUAL',
            },
          ],
        });

        const client = createMockClient();
        const tool = findTool('enrich_position', client, undefined, store);
        const result = await tool.execute({ symbol: 'AAPL' });

        expect(result.isError).toBeUndefined();
        expect(result.content).toContain('## Portfolio Context');
        expect(result.content).toContain('Quantity: 10-100 units');
        expect(result.content).toContain('Position Value: $1k-$10k');
        expect(result.content).toContain('# Apple Inc. (COMPANY)');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('enrich_snapshot batch enriches portfolio symbols', async () => {
      const { dir, store } = createSnapshotStore();
      try {
        await store.save({
          platform: 'MANUAL',
          positions: [
            {
              symbol: 'AAPL',
              name: 'Apple Inc.',
              quantity: 25,
              costBasis: 150,
              currentPrice: 180,
              marketValue: 4500,
              unrealizedPnl: 750,
              unrealizedPnlPercent: 20,
              assetClass: 'EQUITY',
              platform: 'MANUAL',
            },
            {
              symbol: 'MSFT',
              name: 'Microsoft Corp.',
              quantity: 12,
              costBasis: 300,
              currentPrice: 420,
              marketValue: 5040,
              unrealizedPnl: 1440,
              unrealizedPnlPercent: 40,
              assetClass: 'EQUITY',
              platform: 'MANUAL',
            },
          ],
        });

        const client = createMockClient({
          batchEnrich: vi.fn().mockResolvedValue(
            ok([
              MOCK_ENRICHED_ENTITY,
              {
                ...MOCK_ENRICHED_ENTITY,
                id: 'msft',
                name: 'Microsoft Corp.',
                tickers: ['MSFT'],
                market: {
                  ...MOCK_ENRICHED_ENTITY.market,
                  quote: {
                    ...MOCK_ENRICHED_ENTITY.market!.quote!,
                    ticker: 'MSFT',
                    price: 420,
                    change: 3.2,
                    changePercent: 0.77,
                  },
                },
              },
            ]),
          ),
        });

        const tool = findTool('enrich_snapshot', client, undefined, store);
        const result = await tool.execute({});

        expect(result.isError).toBeUndefined();
        expect(result.content).toContain('# Portfolio Snapshot Enrichment');
        expect(result.content).toContain('Symbol: AAPL');
        expect(result.content).toContain('Symbol: MSFT');
        expect(result.content).toContain('Microsoft Corp.');
        expect(client.batchEnrich).toHaveBeenCalledWith(['AAPL', 'MSFT'], ['market', 'risk']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
