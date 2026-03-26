import { describe, expect, it } from 'vitest';

import type { DataBrief } from '../../src/insights/data-gatherer.js';
import { triagePositions } from '../../src/insights/triage.js';
import type { InsightReport } from '../../src/insights/types.js';

function makeBrief(overrides?: Partial<DataBrief>): DataBrief {
  return {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    quantity: 10,
    costBasis: 150,
    currentPrice: 180,
    marketValue: 1800,
    unrealizedPnlPercent: 20,
    sector: 'Technology',
    assetClass: 'equity',
    quotePrice: 180,
    changePercent: 0.5,
    volume: 1_000_000,
    marketCap: 3e12,
    pe: 30,
    eps: 6,
    enrichmentSector: 'Technology',
    riskScore: 3,
    riskSignals: [],
    signalCount: 0,
    signals: [],
    sentimentDirection: 'NEUTRAL',
    memories: [],
    ...overrides,
  };
}

function makePreviousReport(positions: Array<{ symbol: string; rating: string }>): InsightReport {
  return {
    id: 'prev-report',
    snapshotId: 'snap-prev',
    positions: positions.map((p) => ({
      symbol: p.symbol,
      name: p.symbol,
      rating: p.rating as InsightReport['positions'][0]['rating'],
      conviction: 0.7,
      thesis: 'Previous thesis',
      keySignals: [],
      allSignalIds: [],
      risks: [],
      opportunities: [],
      memoryContext: null,
      priceTarget: null,
    })),
    portfolio: {
      overallHealth: 'HEALTHY',
      summary: 'Previous summary',
      sectorThemes: [],
      macroContext: '',
      topRisks: [],
      topOpportunities: [],
      actionItems: [],
    },
    agentOutputs: { researchAnalyst: '', riskManager: '', strategist: '' },
    emotionState: { confidence: 0.7, riskAppetite: 0.5, reason: '' },
    createdAt: new Date().toISOString(),
    durationMs: 1000,
  };
}

describe('triagePositions', () => {
  it('treats all positions as hot when portfolio has 15 or fewer', () => {
    const briefs = Array.from({ length: 10 }, (_, i) => makeBrief({ symbol: `SYM${i}` }));
    const result = triagePositions(briefs, null);

    expect(result.hot).toHaveLength(10);
    expect(result.warm).toHaveLength(0);
    expect(result.cold).toHaveLength(0);
  });

  it('treats all as hot at exactly 15 positions', () => {
    const briefs = Array.from({ length: 15 }, (_, i) => makeBrief({ symbol: `SYM${i}` }));
    const result = triagePositions(briefs, null);

    expect(result.hot).toHaveLength(15);
    expect(result.warm).toHaveLength(0);
    expect(result.cold).toHaveLength(0);
  });

  it('splits into hot/warm/cold for large portfolios', () => {
    const briefs = Array.from({ length: 40 }, (_, i) =>
      makeBrief({
        symbol: `SYM${i}`,
        changePercent: i < 10 ? 10 : i < 30 ? 1 : 0.1, // top 10 get high scores
        signalCount: i < 10 ? 5 : 0,
      }),
    );

    const result = triagePositions(briefs, null);

    expect(result.hot.length).toBeGreaterThanOrEqual(5);
    expect(result.warm.length).toBeGreaterThan(0);
    expect(result.cold.length).toBeGreaterThan(0);
    expect(result.hot.length + result.warm.length + result.cold.length).toBe(40);
  });

  it('scores price movement correctly — big movers rank higher', () => {
    const briefs = [
      makeBrief({ symbol: 'MOVER', changePercent: 8 }), // +30 from price
      makeBrief({ symbol: 'FLAT', changePercent: 0.1 }), // +0 from price
    ];

    // With only 2 positions (<= 15), both will be hot, but we can verify via ordering
    // by checking with a larger set
    const padded = [
      ...briefs,
      ...Array.from({ length: 20 }, (_, i) => makeBrief({ symbol: `PAD${i}`, changePercent: 0 })),
    ];

    const result = triagePositions(padded, null);
    // MOVER should be in hot tier
    expect(result.hot.some((b) => b.symbol === 'MOVER')).toBe(true);
  });

  it('scores signal count — more signals rank higher', () => {
    const padded = [
      makeBrief({ symbol: 'ACTIVE', signalCount: 10 }),
      makeBrief({ symbol: 'QUIET', signalCount: 0 }),
      ...Array.from({ length: 20 }, (_, i) => makeBrief({ symbol: `PAD${i}` })),
    ];

    const result = triagePositions(padded, null);
    expect(result.hot.some((b) => b.symbol === 'ACTIVE')).toBe(true);
  });

  it('scores sentiment divergence — flip from BUY to BEARISH signals rank higher', () => {
    const previous = makePreviousReport([
      { symbol: 'FLIP', rating: 'BUY' },
      { symbol: 'SAME', rating: 'HOLD' },
    ]);

    const padded = [
      makeBrief({ symbol: 'FLIP', sentimentDirection: 'BEARISH' }), // divergence: +20
      makeBrief({ symbol: 'SAME', sentimentDirection: 'NEUTRAL' }), // no divergence: +0
      ...Array.from({ length: 20 }, (_, i) => makeBrief({ symbol: `PAD${i}` })),
    ];

    const result = triagePositions(padded, previous);
    expect(result.hot.some((b) => b.symbol === 'FLIP')).toBe(true);
  });

  it('cold positions carry previous insights', () => {
    const previous = makePreviousReport([
      { symbol: 'COLD1', rating: 'HOLD' },
      { symbol: 'COLD2', rating: 'SELL' },
    ]);

    const briefs = [
      // Hot: lots of activity
      ...Array.from({ length: 12 }, (_, i) => makeBrief({ symbol: `HOT${i}`, changePercent: 10, signalCount: 5 })),
      // Cold: no activity
      makeBrief({ symbol: 'COLD1', changePercent: 0, signalCount: 0 }),
      makeBrief({ symbol: 'COLD2', changePercent: 0, signalCount: 0 }),
      ...Array.from({ length: 6 }, (_, i) => makeBrief({ symbol: `WARM${i}`, changePercent: 1 })),
    ];

    const result = triagePositions(briefs, previous);

    for (const cold of result.cold) {
      if (cold.brief.symbol === 'COLD1') {
        expect(cold.previousInsight?.rating).toBe('HOLD');
      }
      if (cold.brief.symbol === 'COLD2') {
        expect(cold.previousInsight?.rating).toBe('SELL');
      }
    }
  });

  it('first run with no previous report gives baseline boost to all', () => {
    const briefs = Array.from({ length: 20 }, (_, i) =>
      makeBrief({ symbol: `SYM${i}`, changePercent: 0, signalCount: 0 }),
    );

    const result = triagePositions(briefs, null);

    // All positions get the same baseline score — hot should include top 25%
    expect(result.hot.length).toBeGreaterThanOrEqual(5);
    expect(result.hot.length + result.warm.length + result.cold.length).toBe(20);
  });

  it('ensures at least 5 hot positions in large portfolios', () => {
    const briefs = Array.from({ length: 16 }, (_, i) =>
      makeBrief({ symbol: `SYM${i}`, changePercent: 0, signalCount: 0 }),
    );

    const result = triagePositions(briefs, null);
    expect(result.hot.length).toBeGreaterThanOrEqual(5);
  });
});
