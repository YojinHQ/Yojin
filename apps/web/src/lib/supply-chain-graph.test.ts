import { describe, expect, it } from 'vitest';

import type { SupplyChainMap } from '../api/types';
import { buildSupplyChainGraph, substitutabilityColor } from './supply-chain-graph';

function map(partial: Partial<SupplyChainMap> & { ticker: string }): SupplyChainMap {
  return {
    ticker: partial.ticker,
    entityName: partial.entityName ?? partial.ticker,
    narrative: null,
    asOf: '2026-04-22T00:00:00Z',
    dataAsOf: null,
    staleAfter: '2026-04-23T00:00:00Z',
    synthesizedBy: null,
    upstream: partial.upstream ?? [],
    downstream: partial.downstream ?? [],
    geographicFootprint: partial.geographicFootprint ?? [],
    concentrationRisks: partial.concentrationRisks ?? [],
  };
}

describe('buildSupplyChainGraph', () => {
  it('seeds portfolio nodes even when no map is supplied', () => {
    const { nodes, links } = buildSupplyChainGraph({
      maps: [],
      portfolioTickers: ['AAPL', 'NVDA'],
    });

    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.kind === 'portfolio')).toBe(true);
    expect(links).toHaveLength(0);
  });

  it('creates upstream edges with substitutability + bottleneck flags', () => {
    const { nodes, links } = buildSupplyChainGraph({
      portfolioTickers: ['NVDA'],
      maps: [
        map({
          ticker: 'NVDA',
          upstream: [
            {
              counterpartyName: 'TSMC',
              counterpartyTicker: 'TSM',
              relationship: 'MANUFACTURER',
              edgeOrigin: 'SEC_FILING',
              criticality: 0.95,
              substitutability: 'LOW',
              originCountry: 'TW',
            },
          ],
        }),
      ],
    });

    const tsmc = nodes.find((n) => n.id === 'TSM');
    expect(tsmc).toBeDefined();
    expect(tsmc?.kind).toBe('counterparty');
    expect(tsmc?.bottleneck).toBe(true);
    expect(tsmc?.country).toBe('TW');
    expect(tsmc?.worstSubstitutability).toBe('LOW');

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      source: 'NVDA',
      target: 'TSM',
      kind: 'upstream',
      substitutability: 'LOW',
    });
  });

  it('marks counterparties shared when referenced by 2+ portfolio tickers', () => {
    const { nodes } = buildSupplyChainGraph({
      portfolioTickers: ['NVDA', 'AMD', 'AAPL'],
      maps: [
        map({
          ticker: 'NVDA',
          upstream: [
            {
              counterpartyName: 'TSMC',
              counterpartyTicker: 'TSM',
              relationship: 'MANUFACTURER',
              edgeOrigin: 'SEC_FILING',
              criticality: 0.9,
              substitutability: 'LOW',
              originCountry: 'TW',
            },
          ],
        }),
        map({
          ticker: 'AMD',
          upstream: [
            {
              counterpartyName: 'TSMC',
              counterpartyTicker: 'TSM',
              relationship: 'MANUFACTURER',
              edgeOrigin: 'SEC_FILING',
              criticality: 0.85,
              substitutability: 'LOW',
              originCountry: 'TW',
            },
          ],
        }),
        map({
          ticker: 'AAPL',
          upstream: [
            {
              counterpartyName: 'TSMC',
              counterpartyTicker: 'TSM',
              relationship: 'MANUFACTURER',
              edgeOrigin: 'SEC_FILING',
              criticality: 0.7,
              substitutability: 'MEDIUM',
              originCountry: 'TW',
            },
          ],
        }),
      ],
    });

    const tsmc = nodes.find((n) => n.id === 'TSM');
    expect(tsmc?.shared).toBe(true);
    expect(tsmc?.portfolioDegree).toBe(3);
    // LOW wins over MEDIUM — worst-case aggregation.
    expect(tsmc?.worstSubstitutability).toBe('LOW');
  });

  it('falls back to name-based id when ticker missing, case-insensitive', () => {
    const { nodes } = buildSupplyChainGraph({
      portfolioTickers: ['AAPL'],
      maps: [
        map({
          ticker: 'AAPL',
          upstream: [
            {
              counterpartyName: 'Foxconn',
              counterpartyTicker: null,
              relationship: 'MANUFACTURER',
              edgeOrigin: 'SEC_FILING',
              criticality: 0.5,
              substitutability: 'MEDIUM',
              originCountry: 'TW',
            },
            {
              counterpartyName: 'FOXCONN',
              counterpartyTicker: null,
              relationship: 'MANUFACTURER',
              edgeOrigin: 'JINTEL_RELATIONSHIP',
              criticality: 0.4,
              substitutability: 'MEDIUM',
              originCountry: 'TW',
            },
          ],
        }),
      ],
    });

    const foxconnNodes = nodes.filter((n) => n.label.toLowerCase() === 'foxconn');
    expect(foxconnNodes).toHaveLength(1);
    // portfolioDegree increments per incoming edge — even same-ticker edges
    // contribute once each so the hub size reflects edge weight.
    expect(foxconnNodes[0].portfolioDegree).toBe(2);
  });

  it('emits downstream links and flags customers', () => {
    const { links, nodes } = buildSupplyChainGraph({
      portfolioTickers: ['NVDA'],
      maps: [
        map({
          ticker: 'NVDA',
          downstream: [
            {
              counterpartyName: 'Microsoft',
              counterpartyTicker: 'MSFT',
              edgeOrigin: 'SEC_FILING',
              sharePct: 15,
              valueUsd: null,
            },
          ],
        }),
      ],
    });

    expect(links[0].kind).toBe('downstream');
    expect(links[0].sharePct).toBe(15);
    expect(nodes.find((n) => n.id === 'MSFT')?.kind).toBe('counterparty');
  });

  it('does not flag bottleneck when criticality is low even with LOW substitutability', () => {
    const { nodes } = buildSupplyChainGraph({
      portfolioTickers: ['NVDA'],
      maps: [
        map({
          ticker: 'NVDA',
          upstream: [
            {
              counterpartyName: 'Niche Supplier',
              counterpartyTicker: null,
              relationship: 'SUPPLIER',
              edgeOrigin: 'JINTEL_RELATIONSHIP',
              criticality: 0.3,
              substitutability: 'LOW',
              originCountry: 'JP',
            },
          ],
        }),
      ],
    });

    const supplier = nodes.find((n) => n.label === 'Niche Supplier');
    expect(supplier?.bottleneck).toBe(false);
    expect(supplier?.worstSubstitutability).toBe('LOW');
  });
});

describe('substitutabilityColor', () => {
  it('maps each tier to a distinct hex', () => {
    expect(substitutabilityColor('LOW')).toBe('#ef4444');
    expect(substitutabilityColor('MEDIUM')).toBe('#f59e0b');
    expect(substitutabilityColor('HIGH')).toBe('#22c55e');
    expect(substitutabilityColor(null)).toBe('#64748b');
  });
});
