import { describe, expect, it } from 'vitest';

import { formatBriefsForContext, formatRiskMetrics } from '../../src/insights/data-gatherer.js';
import type { DataBrief } from '../../src/insights/data-gatherer.js';

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
    quotePrice: 182.5,
    changePercent: 1.39,
    volume: 50_000_000,
    marketCap: 3.1e12,
    pe: 31.2,
    eps: 6.13,
    beta: 1.2,
    dividendYield: 0.005,
    debtToEquity: 1.73,
    fiftyTwoWeekHigh: 199.62,
    fiftyTwoWeekLow: 164.08,
    enrichmentSector: 'Technology',
    enrichmentIndustry: 'Consumer Electronics',
    riskScore: 3.5,
    riskSignals: [],
    recentFilings: [],
    legalName: 'Apple Inc.',
    jurisdiction: 'US',
    signalCount: 2,
    signals: [
      {
        id: 'sig-001',
        type: 'EARNINGS',
        title: 'Q4 earnings beat estimates by 5%',
        tier2: 'Apple reported strong Q4 results.',
        sourceCount: 1,
        sourceNames: ['Reuters'],
        sentiment: 'BULLISH',
        outputType: 'INSIGHT',
        publishedAt: '2026-03-20T10:00:00Z',
        link: 'https://example.com/aapl-earnings',
        groupId: null,
      },
      {
        id: 'sig-002',
        type: 'NEWS',
        title: 'Apple announces new AI features',
        tier2: null,
        sourceCount: 1,
        sourceNames: ['Bloomberg'],
        sentiment: null,
        outputType: 'INSIGHT',
        publishedAt: '2026-03-19T14:00:00Z',
        link: null,
        groupId: null,
      },
    ],
    sentimentDirection: 'BULLISH',
    memories: [
      {
        situation: 'Previous analysis showed bullish momentum',
        recommendation: 'Hold position with trailing stop at $160',
        confidence: 0.85,
        date: '2026-03-15',
      },
    ],
    ...overrides,
  };
}

describe('formatBriefsForContext', () => {
  it('returns placeholder for empty briefs', () => {
    const result = formatBriefsForContext([]);
    expect(result).toBe('No positions in portfolio.');
  });

  it('formats a single brief with all fields', () => {
    const brief = makeBrief();
    const result = formatBriefsForContext([brief]);

    expect(result).toContain('## AAPL — Apple Inc.');
    expect(result).toContain('Price: $182.50');
    expect(result).toContain('+1.39%');
    expect(result).toContain('P&L: 20.0%');
    expect(result).toContain('Sector: Technology');
    expect(result).toContain('MCap: $3.1T');
    expect(result).toContain('P/E: 31.2');
    expect(result).toContain('Risk: 3.5/100');
    expect(result).toContain('Signals (7d): 2');
    expect(result).toContain('sentiment: BULLISH');
    expect(result).toContain('[INSIGHT] Q4 earnings beat estimates by 5% (Reuters) (id:sig-001)');
    expect(result).toContain('[INSIGHT] Apple announces new AI features (Bloomberg) (id:sig-002)');
    expect(result).toContain('Past analysis:');
    expect(result).toContain('Hold position with trailing stop');
  });

  it('uses currentPrice when quotePrice is null', () => {
    const brief = makeBrief({ quotePrice: null, changePercent: null, currentPrice: 175 });
    const result = formatBriefsForContext([brief]);
    expect(result).toContain('Price: $175.00');
  });

  it('shows negative change percent', () => {
    const brief = makeBrief({ changePercent: -2.5 });
    const result = formatBriefsForContext([brief]);
    expect(result).toContain('-2.50%');
  });

  it('shows risk signals when present', () => {
    const brief = makeBrief({ riskSignals: ['HIGH: Concentrated position', 'MEDIUM: Earnings next week'] });
    const result = formatBriefsForContext([brief]);
    expect(result).toContain('Risk flags: HIGH: Concentrated position; MEDIUM: Earnings next week');
  });

  it('separates multiple briefs with divider', () => {
    const briefs = [makeBrief({ symbol: 'AAPL', name: 'Apple' }), makeBrief({ symbol: 'MSFT', name: 'Microsoft' })];
    const result = formatBriefsForContext(briefs);

    expect(result).toContain('## AAPL — Apple');
    expect(result).toContain('## MSFT — Microsoft');
    expect(result).toContain('---');
  });

  it('limits to 5 signals per brief', () => {
    const brief = makeBrief({
      signalCount: 8,
      signals: Array.from({ length: 8 }, (_, i) => ({
        id: `sig-${i}`,
        type: 'NEWS',
        title: `Signal ${i}`,
        tier2: null,
        sourceCount: 1,
        sourceNames: ['TestSource'],
        sentiment: null,
        outputType: 'INSIGHT',
        publishedAt: '2026-03-20T10:00:00Z',
        link: null,
        groupId: null,
      })),
    });

    const result = formatBriefsForContext([brief]);
    const signalLines = result.split('\n').filter((l) => l.match(/Signal \d/));
    expect(signalLines).toHaveLength(5);
  });

  it('limits to 2 memories per brief', () => {
    const brief = makeBrief({
      memories: Array.from({ length: 5 }, (_, i) => ({
        situation: `Situation ${i}`,
        recommendation: `Recommendation ${i}`,
        confidence: 0.8,
        date: '2026-03-15',
      })),
    });

    const result = formatBriefsForContext([brief]);
    const memoryLines = result.split('\n').filter((l) => l.includes('Recommendation'));
    expect(memoryLines).toHaveLength(2);
  });

  it('handles empty briefs in formatRiskMetrics', () => {
    expect(formatRiskMetrics([])).toBe('No positions.');
  });

  it('omits fundamentals section when no data available', () => {
    const brief = makeBrief({
      sector: null,
      enrichmentSector: null,
      marketCap: null,
      pe: null,
      riskScore: null,
    });
    const result = formatBriefsForContext([brief]);
    // Should still have price and signals, but no sector/MCap line
    expect(result).toContain('Price:');
    expect(result).not.toContain('Sector:');
    expect(result).not.toContain('MCap:');
  });
});

describe('formatRiskMetrics', () => {
  it('computes position weights and sector exposure', () => {
    const briefs = [
      makeBrief({ symbol: 'AAPL', marketValue: 5000, enrichmentSector: 'Technology' }),
      makeBrief({ symbol: 'MSFT', marketValue: 3000, enrichmentSector: 'Technology' }),
      makeBrief({ symbol: 'JPM', marketValue: 2000, enrichmentSector: 'Financials' }),
    ];
    const result = formatRiskMetrics(briefs);

    expect(result).toContain('AAPL: 50.0%');
    expect(result).toContain('MSFT: 30.0%');
    expect(result).toContain('JPM: 20.0%');
    expect(result).toContain('Technology: 80.0%');
    expect(result).toContain('Financials: 20.0%');
  });

  it('flags concentration warnings', () => {
    const briefs = [
      makeBrief({ symbol: 'AAPL', marketValue: 8000, enrichmentSector: 'Technology' }),
      makeBrief({ symbol: 'MSFT', marketValue: 2000, enrichmentSector: 'Technology' }),
    ];
    const result = formatRiskMetrics(briefs);

    expect(result).toContain('WARNING: Technology sector at 100.0%');
    expect(result).toContain('CRITICAL: AAPL at 80.0%');
  });

  it('computes HHI correctly', () => {
    const briefs = Array.from({ length: 4 }, (_, i) => makeBrief({ symbol: `S${i}`, marketValue: 2500 }));
    const result = formatRiskMetrics(briefs);

    expect(result).toContain('HHI: 2500');
    expect(result).toContain('Effective positions (1/HHI): 4.0');
  });
});
