import { describe, expect, it } from 'vitest';

import type { RelationshipEdge } from '../../src/insights/supply-chain-jintel.js';
import { rankCounterparties } from '../../src/insights/supply-chain-jintel.js';

function edge(overrides: Partial<RelationshipEdge> & Pick<RelationshipEdge, 'counterpartyName'>): RelationshipEdge {
  return {
    type: 'CUSTOMER',
    direction: 'OUT',
    disclosure: 'DIRECT',
    confidence: 0.9,
    counterpartyName: overrides.counterpartyName,
    counterpartyTicker: null,
    counterpartyCik: null,
    sharePct: null,
    valueUsd: null,
    context: null,
    source: { connector: 'sec-segments', url: null, asOf: null, ref: null },
    ...overrides,
  } as RelationshipEdge;
}

describe('rankCounterparties', () => {
  it('sorts by composite score (valueUsd > sharePct > confidence > typeBonus)', () => {
    const edges: RelationshipEdge[] = [
      edge({ counterpartyName: 'Low', counterpartyTicker: 'LOW', confidence: 0.5 }),
      edge({
        counterpartyName: 'HighValue',
        counterpartyTicker: 'HIV',
        valueUsd: 50_000_000_000,
        confidence: 0.6,
      }),
      edge({
        counterpartyName: 'HighShare',
        counterpartyTicker: 'HIS',
        sharePct: 0.4,
        confidence: 0.6,
      }),
    ];
    const ranked = rankCounterparties(edges);
    expect(ranked[0]).toBe('HIV');
    expect(ranked).toContain('HIS');
    expect(ranked).toContain('LOW');
  });

  it('drops edges with no counterparty ticker or CIK', () => {
    const edges: RelationshipEdge[] = [
      edge({ counterpartyName: 'NoId' }),
      edge({ counterpartyName: 'HasTicker', counterpartyTicker: 'FOO' }),
    ];
    const ranked = rankCounterparties(edges);
    expect(ranked).toEqual(['FOO']);
  });

  it('keeps edges with only a CIK in the ranking but returns only ticker-bearing tickers', () => {
    const edges: RelationshipEdge[] = [
      edge({ counterpartyName: 'CikOnly', counterpartyCik: '0001234567', confidence: 0.95 }),
      edge({ counterpartyName: 'TickerCo', counterpartyTicker: 'TKR', confidence: 0.5 }),
    ];
    const ranked = rankCounterparties(edges);
    // CIK-only contributes nothing to the output (no ticker to batchEnrich).
    expect(ranked).toEqual(['TKR']);
  });

  it('deduplicates repeated tickers', () => {
    const edges: RelationshipEdge[] = [
      edge({ counterpartyName: 'TSM A', counterpartyTicker: 'TSM', sharePct: 0.3 }),
      edge({ counterpartyName: 'TSM B', counterpartyTicker: 'TSM', sharePct: 0.2 }),
      edge({ counterpartyName: 'Other', counterpartyTicker: 'NVDA' }),
    ];
    const ranked = rankCounterparties(edges);
    expect(ranked.filter((t) => t === 'TSM').length).toBe(1);
  });

  it('caps at 8 unique tickers', () => {
    const edges: RelationshipEdge[] = Array.from({ length: 20 }, (_, i) =>
      edge({ counterpartyName: `Co${i}`, counterpartyTicker: `T${i}`, valueUsd: 1_000_000_000 * (20 - i) }),
    );
    const ranked = rankCounterparties(edges);
    expect(ranked).toHaveLength(8);
    // Top-valued should come first.
    expect(ranked[0]).toBe('T0');
  });

  it('returns an empty array when no edges have identifiers', () => {
    const edges: RelationshipEdge[] = [edge({ counterpartyName: 'A' }), edge({ counterpartyName: 'B' })];
    expect(rankCounterparties(edges)).toEqual([]);
  });
});
