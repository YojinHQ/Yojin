import { describe, expect, it } from 'vitest';

import { aggregatePortfolioSupplyChain } from '../../src/insights/supply-chain-aggregator.js';
import type { SupplyChainMap, UpstreamEdge } from '../../src/insights/supply-chain-types.js';

function edge(overrides: Partial<UpstreamEdge>): UpstreamEdge {
  return {
    counterpartyName: 'Counterparty',
    counterpartyTicker: null,
    counterpartyCik: null,
    relationship: 'SUPPLIER',
    edgeOrigin: 'JINTEL_DIRECT',
    criticality: 0.5,
    substitutability: null,
    evidence: [{ connector: 'sec-segments', url: null, ref: 'ref', asOf: '2024-11-01', contextQuote: null }],
    originCountry: null,
    ...overrides,
  };
}

function mapOf(ticker: string, partial: Partial<SupplyChainMap> = {}): SupplyChainMap {
  const now = new Date().toISOString();
  return {
    ticker,
    entityName: ticker,
    upstream: [],
    downstream: [],
    geographicFootprint: [],
    concentrationRisks: [],
    narrative: null,
    asOf: now,
    dataAsOf: '2024-11-01',
    staleAfter: new Date(Date.parse(now) + 86_400_000).toISOString(),
    sources: [],
    synthesizedBy: null,
    ...partial,
  };
}

describe('aggregatePortfolioSupplyChain', () => {
  it('returns empty summary when no maps', () => {
    const out = aggregatePortfolioSupplyChain({ maps: [] });
    expect(out).toEqual({
      topCountryExposures: [],
      sharedCounterparties: [],
      singlePointsOfFailure: [],
      concentrationStack: [],
    });
  });

  describe('topCountryExposures', () => {
    it('groups upstream edges by originCountry and weights by criticality', () => {
      const maps = [
        mapOf('NVDA', {
          upstream: [
            edge({ counterpartyTicker: 'TSM', counterpartyName: 'TSMC', originCountry: 'TW', criticality: 0.9 }),
          ],
          geographicFootprint: [{ iso2: 'TW', country: 'Taiwan', criticality: 1, entities: ['TSMC'] }],
        }),
        mapOf('AMD', {
          upstream: [
            edge({ counterpartyTicker: 'TSM', counterpartyName: 'TSMC', originCountry: 'TW', criticality: 0.8 }),
            edge({ counterpartyName: 'Samsung', originCountry: 'KR', criticality: 0.4 }),
          ],
        }),
      ];
      const out = aggregatePortfolioSupplyChain({ maps });
      expect(out.topCountryExposures[0]).toEqual({
        iso2: 'TW',
        country: 'Taiwan',
        criticalityWeightedCount: 1.7,
        tickers: ['AMD', 'NVDA'],
      });
      expect(out.topCountryExposures[1]?.iso2).toBe('KR');
      // KR uses the ISO-2 fallback because no geographicFootprint entry named it.
      expect(out.topCountryExposures[1]?.country).toBe('KR');
    });

    it('ignores edges with no originCountry', () => {
      const maps = [
        mapOf('AAPL', {
          upstream: [edge({ counterpartyName: 'Unknown', originCountry: null, criticality: 0.9 })],
        }),
      ];
      const out = aggregatePortfolioSupplyChain({ maps });
      expect(out.topCountryExposures).toEqual([]);
    });
  });

  describe('sharedCounterparties', () => {
    it('finds counterparties that appear in 2+ portfolio tickers', () => {
      const tsm = { counterpartyTicker: 'TSM', counterpartyName: 'TSMC' };
      const maps = [
        mapOf('NVDA', { upstream: [edge(tsm)] }),
        mapOf('AMD', { upstream: [edge(tsm)] }),
        mapOf('AAPL', { upstream: [edge(tsm)] }),
        // Only appears once — must be filtered out.
        mapOf('MSFT', { upstream: [edge({ counterpartyName: 'Unique Supplier' })] }),
      ];
      const out = aggregatePortfolioSupplyChain({ maps });
      expect(out.sharedCounterparties).toHaveLength(1);
      expect(out.sharedCounterparties[0]).toMatchObject({
        counterpartyTicker: 'TSM',
        counterpartyName: 'TSMC',
        count: 3,
        tickers: ['AAPL', 'AMD', 'NVDA'],
      });
    });

    it('matches by name when ticker is absent (case-insensitive)', () => {
      const maps = [
        mapOf('PFE', { upstream: [edge({ counterpartyName: 'Lonza Group' })] }),
        mapOf('MRK', { upstream: [edge({ counterpartyName: 'LONZA GROUP' })] }),
      ];
      const out = aggregatePortfolioSupplyChain({ maps });
      expect(out.sharedCounterparties).toHaveLength(1);
      expect(out.sharedCounterparties[0]?.count).toBe(2);
    });

    it('does not double-count a counterparty listed twice under the same ticker', () => {
      const maps = [
        mapOf('NVDA', {
          upstream: [
            edge({ counterpartyTicker: 'TSM', counterpartyName: 'TSMC' }),
            edge({ counterpartyTicker: 'TSM', counterpartyName: 'TSMC' }),
          ],
        }),
        mapOf('AMD', {
          upstream: [edge({ counterpartyTicker: 'TSM', counterpartyName: 'TSMC' })],
        }),
      ];
      const out = aggregatePortfolioSupplyChain({ maps });
      expect(out.sharedCounterparties[0]?.count).toBe(2);
    });
  });

  describe('singlePointsOfFailure', () => {
    it('surfaces LOW-substitutability edges above the criticality cutoff', () => {
      const maps = [
        mapOf('NVDA', {
          upstream: [
            edge({ counterpartyName: 'TSMC', criticality: 0.92, substitutability: 'LOW' }),
            edge({ counterpartyName: 'Low-critical', criticality: 0.4, substitutability: 'LOW' }),
            edge({ counterpartyName: 'Medium', criticality: 0.9, substitutability: 'MEDIUM' }),
            edge({ counterpartyName: 'Not-annotated', criticality: 0.95, substitutability: null }),
          ],
        }),
      ];
      const out = aggregatePortfolioSupplyChain({ maps });
      expect(out.singlePointsOfFailure).toHaveLength(1);
      expect(out.singlePointsOfFailure[0]).toMatchObject({
        counterpartyName: 'TSMC',
        ticker: 'NVDA',
      });
      expect(out.singlePointsOfFailure[0]?.reason).toContain('LOW');
    });

    it('sorts SPoFs by criticality descending', () => {
      const maps = [
        mapOf('NVDA', {
          upstream: [edge({ counterpartyName: 'Low', criticality: 0.82, substitutability: 'LOW' })],
        }),
        mapOf('AAPL', {
          upstream: [edge({ counterpartyName: 'High', criticality: 0.95, substitutability: 'LOW' })],
        }),
      ];
      const out = aggregatePortfolioSupplyChain({ maps });
      expect(out.singlePointsOfFailure.map((s) => s.ticker)).toEqual(['AAPL', 'NVDA']);
    });
  });

  describe('concentrationStack', () => {
    it('returns flags above HHI threshold sorted descending', () => {
      const maps = [
        mapOf('AAPL', {
          concentrationRisks: [
            { dimension: 'CUSTOMER', hhi: 3200, label: 'Top-3 customers = 62%' },
            // Below threshold — excluded.
            { dimension: 'SEGMENT', hhi: 1800, label: 'diffuse segment' },
          ],
        }),
        mapOf('LMT', {
          concentrationRisks: [{ dimension: 'CUSTOMER', hhi: 7500, label: 'US government sole customer' }],
        }),
      ];
      const out = aggregatePortfolioSupplyChain({ maps });
      expect(out.concentrationStack).toHaveLength(2);
      expect(out.concentrationStack[0]?.ticker).toBe('LMT');
      expect(out.concentrationStack[1]?.ticker).toBe('AAPL');
    });
  });

  it('respects per-section limits', () => {
    const maps = Array.from({ length: 30 }, (_, i) =>
      mapOf(`T${i}`, {
        concentrationRisks: [{ dimension: 'CUSTOMER', hhi: 3000 + i, label: 'x' }],
      }),
    );
    const out = aggregatePortfolioSupplyChain({ maps, concentrationLimit: 5 });
    expect(out.concentrationStack).toHaveLength(5);
  });
});
