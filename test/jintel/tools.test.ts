import type { Entity, JintelClient, JintelResult, MarketQuote, SanctionsMatch } from '@yojinhq/jintel-client';
import { describe, expect, it, vi } from 'vitest';

import { createJintelTools } from '../../src/jintel/tools.js';
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
    quotes: vi.fn().mockResolvedValue(ok(MOCK_QUOTES)),
    sanctionsScreen: vi.fn().mockResolvedValue(ok(MOCK_SANCTIONS)),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 50 }),
    ...overrides,
  } as unknown as JintelClient;
}

function createMockIngestor(): SignalIngestor & { ingest: ReturnType<typeof vi.fn> } {
  return {
    ingest: vi.fn().mockResolvedValue({ ingested: 0, duplicates: 0, errors: [] }),
    initialize: vi.fn().mockResolvedValue(undefined),
  } as unknown as SignalIngestor & { ingest: ReturnType<typeof vi.fn> };
}

function findTool(name: string, client?: JintelClient, ingestor?: SignalIngestor) {
  const tools = createJintelTools({ client, ingestor });
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
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

    it('ingests risk signals as SENTIMENT type', async () => {
      const client = createMockClient();
      const ingestor = createMockIngestor();
      const tool = findTool('enrich_entity', client, ingestor);

      await tool.execute({ ticker: 'AAPL' });

      expect(ingestor.ingest).toHaveBeenCalledTimes(1);
      const ingestCall = ingestor.ingest.mock.calls[0][0] as RawSignalInput[];

      // 2 risk signals
      expect(ingestCall).toHaveLength(2);

      // Check risk items (should be SENTIMENT)
      const riskItems = ingestCall.filter((i) => i.type === 'SENTIMENT');
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

  describe('jintel failure', () => {
    it('returns isError with fallback guidance on failure', async () => {
      const client = createMockClient({
        searchEntities: vi.fn().mockResolvedValue(fail('Connection timeout')),
      });
      const tool = findTool('search_entities', client);

      const result = await tool.execute({ query: 'Apple' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Connection timeout');
      expect(result.content).toContain('query_data_source');
      expect(result.content).toContain('fallback');
    });

    it('quotes failure returns error with fallback', async () => {
      const client = createMockClient({
        quotes: vi.fn().mockResolvedValue(fail('Rate limit exceeded')),
      });
      const tool = findTool('market_quotes', client);

      const result = await tool.execute({ tickers: ['AAPL'] });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Rate limit exceeded');
      expect(result.content).toContain('query_data_source');
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
});
