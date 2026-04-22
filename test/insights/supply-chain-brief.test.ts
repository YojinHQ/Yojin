import { describe, expect, it, vi } from 'vitest';

import { buildSupplyChainBrief, formatSupplyChainBrief } from '../../src/insights/supply-chain-brief.js';
import type { SupplyChainMap } from '../../src/insights/supply-chain-types.js';
import type { SignalArchive } from '../../src/signals/archive.js';
import type { Signal } from '../../src/signals/types.js';

function signal(id: string, ticker: string, publishedAt: string, title = `signal ${id}`): Signal {
  return {
    id,
    contentHash: `hash-${id}`,
    type: 'NEWS',
    title,
    assets: [{ ticker, relevance: 0.8, linkType: 'DIRECT' }],
    sources: [{ id: 'jintel', name: 'Jintel', type: 'API', reliability: 0.9 }],
    publishedAt,
    ingestedAt: publishedAt,
    confidence: 0.8,
    outputType: 'INSIGHT',
    version: 1,
  };
}

function makeMap(overrides: Partial<SupplyChainMap> = {}): SupplyChainMap {
  return {
    ticker: 'AAPL',
    entityName: 'Apple Inc.',
    upstream: [],
    downstream: [],
    geographicFootprint: [],
    concentrationRisks: [],
    narrative: null,
    asOf: '2026-04-22T00:00:00Z',
    dataAsOf: '2026-04-20T00:00:00Z',
    staleAfter: '2026-04-23T00:00:00Z',
    sources: [],
    synthesizedBy: null,
    ...overrides,
  };
}

function stubArchive(signals: Signal[] = []): {
  archive: SignalArchive;
  calls: Array<{ tickers?: string[]; since?: string; limit?: number }>;
} {
  const calls: Array<{ tickers?: string[]; since?: string; limit?: number }> = [];
  const archive = {
    query: vi.fn(async (filter: { tickers?: string[]; since?: string; limit?: number }) => {
      calls.push(filter);
      return signals;
    }),
  } as unknown as SignalArchive;
  return { archive, calls };
}

describe('buildSupplyChainBrief', () => {
  it('returns null when map is null', async () => {
    const { archive } = stubArchive();
    expect(await buildSupplyChainBrief(null, archive, '2026-04-01')).toBeNull();
  });

  it('returns null when map has no upstream, downstream, or concentration flags', async () => {
    const { archive } = stubArchive();
    const brief = await buildSupplyChainBrief(makeMap(), archive, '2026-04-01');
    expect(brief).toBeNull();
  });

  it('sorts upstream by criticality desc and downstream by sharePct desc', async () => {
    const { archive } = stubArchive();
    const map = makeMap({
      upstream: [
        {
          counterpartyName: 'Low Crit Co',
          counterpartyTicker: 'LCC',
          counterpartyCik: null,
          relationship: 'SUPPLIER',
          edgeOrigin: 'JINTEL_DIRECT',
          criticality: 0.2,
          substitutability: null,
          evidence: [{ connector: 'x', url: null, ref: null, asOf: null, contextQuote: null }],
          originCountry: null,
        },
        {
          counterpartyName: 'High Crit Co',
          counterpartyTicker: 'HCC',
          counterpartyCik: null,
          relationship: 'SUPPLIER',
          edgeOrigin: 'JINTEL_DIRECT',
          criticality: 0.9,
          substitutability: null,
          evidence: [{ connector: 'x', url: null, ref: null, asOf: null, contextQuote: null }],
          originCountry: 'TW',
        },
      ],
      downstream: [
        {
          counterpartyName: 'Small Cust',
          counterpartyTicker: 'SC',
          edgeOrigin: 'JINTEL_DIRECT',
          sharePct: 0.05,
          valueUsd: null,
          evidence: [{ connector: 'x', url: null, ref: null, asOf: null, contextQuote: null }],
        },
        {
          counterpartyName: 'Big Cust',
          counterpartyTicker: 'BC',
          edgeOrigin: 'JINTEL_DIRECT',
          sharePct: 0.4,
          valueUsd: null,
          evidence: [{ connector: 'x', url: null, ref: null, asOf: null, contextQuote: null }],
        },
      ],
    });
    const brief = await buildSupplyChainBrief(map, archive, '2026-04-01');
    expect(brief?.upstream.map((c) => c.name)).toEqual(['High Crit Co', 'Low Crit Co']);
    expect(brief?.downstream.map((c) => c.name)).toEqual(['Big Cust', 'Small Cust']);
  });

  it('queries the archive once with all counterparty tickers (N+1 safe) and cites recent signals', async () => {
    const signals = [
      signal('s-hcc', 'HCC', '2026-04-15T00:00:00Z', 'HCC factory fire'),
      signal('s-bc', 'BC', '2026-04-18T00:00:00Z', 'BC earnings beat'),
      signal('s-hcc-old', 'HCC', '2026-03-01T00:00:00Z', 'HCC old news'),
    ];
    const { archive, calls } = stubArchive(signals);
    const map = makeMap({
      upstream: [
        {
          counterpartyName: 'High Crit Co',
          counterpartyTicker: 'HCC',
          counterpartyCik: null,
          relationship: 'SUPPLIER',
          edgeOrigin: 'JINTEL_DIRECT',
          criticality: 0.9,
          substitutability: null,
          evidence: [{ connector: 'x', url: null, ref: null, asOf: null, contextQuote: null }],
          originCountry: null,
        },
      ],
      downstream: [
        {
          counterpartyName: 'Big Cust',
          counterpartyTicker: 'BC',
          edgeOrigin: 'JINTEL_DIRECT',
          sharePct: 0.4,
          valueUsd: null,
          evidence: [{ connector: 'x', url: null, ref: null, asOf: null, contextQuote: null }],
        },
      ],
    });

    const brief = await buildSupplyChainBrief(map, archive, '2026-04-01');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.tickers?.sort()).toEqual(['BC', 'HCC']);
    expect(calls[0]?.since).toBe('2026-04-01');

    const hcc = brief?.upstream.find((c) => c.ticker === 'HCC');
    expect(hcc?.recentSignals.map((s) => s.title)).toEqual(['HCC factory fire', 'HCC old news']);

    const bc = brief?.downstream.find((c) => c.ticker === 'BC');
    expect(bc?.recentSignals.map((s) => s.title)).toEqual(['BC earnings beat']);
  });

  it('surfaces concentration flags and formats a readable block', async () => {
    const { archive } = stubArchive();
    const map = makeMap({
      concentrationRisks: [{ dimension: 'CUSTOMER', hhi: 3200, label: 'Top-3 customers = 85% of revenue' }],
    });
    const brief = await buildSupplyChainBrief(map, archive, '2026-04-01');
    expect(brief?.concentrationFlags).toHaveLength(1);

    const text = formatSupplyChainBrief(brief);
    expect(text).toContain('Concentration risks:');
    expect(text).toContain('CUSTOMER: HHI 3200');
    expect(text).toContain('Top-3 customers');
  });
});
