import { describe, expect, it } from 'vitest';

import type { Signal } from '../../src/signals/types.js';
import type { PortfolioContext } from '../../src/strategies/strategy-evaluator.js';
import {
  formatPercent,
  formatPrice,
  formatValue,
  renderSummaryOnly,
  renderTraceReport,
} from '../../src/strategies/trace-renderer.js';
import type { StrategyTraceReport } from '../../src/strategies/trace-types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSignal(overrides: Partial<Signal> & { ticker: string }): Signal {
  return {
    id: `sig-${overrides.ticker}-1`,
    contentHash: `hash-${overrides.ticker}-1`,
    type: 'NEWS',
    title: `${overrides.ticker} test signal`,
    assets: [
      {
        ticker: overrides.ticker,
        relevance: 0.8,
        linkType: 'DIRECT',
      },
    ],
    sources: [
      {
        id: 'jintel',
        name: 'Jintel',
        type: 'API',
        reliability: 0.9,
      },
    ],
    publishedAt: '2024-01-15T10:00:00.000Z',
    ingestedAt: '2024-01-15T10:05:00.000Z',
    confidence: 0.85,
    version: 1,
    outputType: 'INSIGHT',
    ...overrides,
  };
}

function makePortfolioContext(): PortfolioContext {
  return {
    weights: { AAPL: 0.6, GOOG: 0.4 },
    prices: { AAPL: 182.5, GOOG: 140.0 },
    priceChanges: { AAPL: -0.012, GOOG: 0.008 },
    periodReturns: { AAPL: 0.15, GOOG: -0.05 },
    indicators: {
      AAPL: { rsi: 67.2, macd: 1.5 },
      GOOG: { rsi: 45.0, macd: -0.3 },
    },
    earningsDays: { AAPL: 14, GOOG: 7 },
    portfolioDrawdown: -0.05,
    positionDrawdowns: { AAPL: -0.03, GOOG: -0.08 },
    metrics: {
      AAPL: { pe: 28.5, pb: 42.1 },
      GOOG: { pe: 22.1, pb: 5.8 },
    },
    signals: {
      AAPL: [makeSignal({ ticker: 'AAPL', title: 'Apple announces new product line', sentimentScore: 0.75 })],
      GOOG: [
        makeSignal({ ticker: 'GOOG', title: 'Google AI update raises competition concerns', sentimentScore: -0.3 }),
      ],
    },
  };
}

/** Build a complete StrategyTraceReport fixture for testing. */
function makeReport(): StrategyTraceReport {
  const portfolioContext = makePortfolioContext();

  return {
    evaluatedAt: '2024-01-15T12:00:00.000Z',
    portfolioContext,
    errors: [],
    strategies: [
      {
        strategyId: 'rsi-oversold',
        strategyName: 'RSI Oversold',
        active: true,
        scopedTickers: ['AAPL', 'GOOG'],
        filteredOutTickers: [],
        groups: [
          {
            groupIndex: 0,
            label: 'Entry signal',
            tickers: [
              {
                ticker: 'AAPL',
                conditions: [
                  {
                    type: 'INDICATOR_THRESHOLD',
                    description: 'RSI below 30',
                    params: { indicator: 'rsi', threshold: 30, direction: 'below' },
                    result: 'FAIL',
                    actualValue: 67.2,
                    threshold: 30,
                    detail: { value: 67.2, threshold: 30 },
                    failReason: 'RSI 67.2 is not below 30',
                  },
                ],
                groupResult: 'FAIL',
              },
              {
                ticker: 'GOOG',
                conditions: [
                  {
                    type: 'INDICATOR_THRESHOLD',
                    description: 'RSI below 30',
                    params: { indicator: 'rsi', threshold: 30, direction: 'below' },
                    result: 'NO_DATA',
                    actualValue: null,
                    threshold: 30,
                    detail: {},
                    failReason: 'No RSI data available',
                  },
                ],
                groupResult: 'FAIL',
              },
            ],
          },
        ],
        result: 'NO_MATCH',
        winningGroup: undefined,
        winningStrength: undefined,
      },
    ],
    summary: {
      totalStrategies: 1,
      activeStrategies: 1,
      fired: 0,
      noMatch: 1,
      tickersEvaluated: ['AAPL', 'GOOG'],
      noDataCount: 1,
      errorCount: 0,
      firedList: [],
    },
  };
}

function makeReportWithFired(): StrategyTraceReport {
  const base = makeReport();
  return {
    ...base,
    strategies: [
      {
        ...base.strategies[0],
        groups: [
          {
            groupIndex: 0,
            label: 'Entry signal',
            tickers: [
              {
                ticker: 'AAPL',
                conditions: [
                  {
                    type: 'INDICATOR_THRESHOLD',
                    description: 'RSI below 30',
                    params: { indicator: 'rsi', threshold: 30, direction: 'below' },
                    result: 'PASS',
                    actualValue: 25.0,
                    threshold: 30,
                    detail: { value: 25.0, threshold: 30 },
                    strength: 'STRONG',
                  },
                ],
                groupResult: 'PASS',
                groupStrength: 'STRONG',
              },
              {
                ticker: 'GOOG',
                conditions: [
                  {
                    type: 'INDICATOR_THRESHOLD',
                    description: 'RSI below 30',
                    params: { indicator: 'rsi', threshold: 30, direction: 'below' },
                    result: 'FAIL',
                    actualValue: 45.0,
                    threshold: 30,
                    detail: { value: 45.0, threshold: 30 },
                    failReason: 'RSI 45.0 is not below 30',
                  },
                ],
                groupResult: 'FAIL',
              },
            ],
          },
        ],
        result: 'FIRED',
        winningGroup: 0,
        winningStrength: 'STRONG',
      },
    ],
    summary: {
      ...base.summary,
      fired: 1,
      noMatch: 0,
      firedList: [{ strategy: 'RSI Oversold', ticker: 'AAPL', strength: 'STRONG' }],
    },
  };
}

// ---------------------------------------------------------------------------
// renderTraceReport
// ---------------------------------------------------------------------------

describe('renderTraceReport', () => {
  it('produces valid Markdown with summary table', () => {
    const report = makeReport();
    const md = renderTraceReport(report);

    // Must contain the summary header and table structure
    expect(md).toContain('## Summary');
    expect(md).toContain('| Strategy');
    expect(md).toContain('Tickers');
    expect(md).toContain('Fired');
    expect(md).toContain('Strongest');
    expect(md).toContain('RSI Oversold');

    // Must contain the result line
    expect(md).toContain('trigger(s) fired');
  });

  it('includes context-build errors when present', () => {
    const report = makeReport();
    report.errors = [{ phase: 'jintel-technicals', message: 'No technicals returned', tickers: ['BTC', 'ETH'] }];

    const md = renderTraceReport(report);

    expect(md).toContain('## Errors During Context Build');
    expect(md).toContain('jintel-technicals');
    expect(md).toContain('No technicals returned');
    expect(md).toContain('BTC, ETH');
  });

  it('includes portfolio context appendix', () => {
    const report = makeReport();
    const md = renderTraceReport(report);

    expect(md).toContain('## Portfolio Context');
    expect(md).toContain('### Prices & Changes');
    expect(md).toContain('AAPL');
    expect(md).toContain('GOOG');
    // Indicators are split into groups; fixture uses lowercase keys → Oscillators group
    expect(md).toContain('### Oscillators');
    expect(md).toContain('### Metrics');
    expect(md).toContain('### Signals');
  });

  it('shows closest miss for NO_MATCH strategies', () => {
    const report = makeReport();
    const md = renderTraceReport(report);

    // AAPL fails with FAIL result (1 condition, 0 pass), GOOG fails with NO_DATA
    // Neither has passing conditions, closest miss shows 0/1
    expect(md).toContain('**Closest miss:**');
  });

  it('renders PASS conditions with checkmark', () => {
    const report = makeReportWithFired();
    const md = renderTraceReport(report);

    expect(md).toContain('✅');
    expect(md).toContain('25.00'); // AAPL RSI actual value
  });

  it('renders FAIL conditions with cross mark', () => {
    const report = makeReport();
    const md = renderTraceReport(report);

    expect(md).toContain('❌');
    expect(md).toContain('67.20'); // AAPL RSI actual value
  });

  it('renders NO_DATA conditions with warning icon', () => {
    const report = makeReport();
    const md = renderTraceReport(report);

    expect(md).toContain('⚠️');
  });

  it('separates sections with horizontal rules', () => {
    const report = makeReport();
    const md = renderTraceReport(report);

    expect(md).toContain('\n---\n\n');
  });

  it('renders signals with sentiment score', () => {
    const report = makeReport();
    const md = renderTraceReport(report);

    expect(md).toContain('Apple announces new product line');
    expect(md).toContain('+0.75');
    expect(md).toContain('Google AI update raises competition concerns');
    expect(md).toContain('-0.30');
  });

  it('renders filtered-out tickers with reasons', () => {
    const report = makeReport();
    report.strategies[0].filteredOutTickers = [{ ticker: 'TSLA', reason: 'Asset class not in scope' }];
    const md = renderTraceReport(report);

    expect(md).toContain('TSLA');
    expect(md).toContain('Asset class not in scope');
  });

  it('shows winning group for multi-group FIRED strategy', () => {
    const report = makeReportWithFired();
    // Add a second group to make it multi-group
    report.strategies[0].groups.push({
      groupIndex: 1,
      label: 'Exit signal',
      tickers: [
        {
          ticker: 'AAPL',
          conditions: [
            {
              type: 'PRICE_MOVE',
              description: 'Price drop > 5%',
              params: { threshold: -0.05 },
              result: 'FAIL',
              actualValue: -0.01,
              threshold: -0.05,
              detail: {},
            },
          ],
          groupResult: 'FAIL',
        },
      ],
    });
    const md = renderTraceReport(report);

    expect(md).toContain('Winner (OR across groups)');
  });
});

// ---------------------------------------------------------------------------
// renderSummaryOnly
// ---------------------------------------------------------------------------

describe('renderSummaryOnly', () => {
  it('includes summary table', () => {
    const report = makeReport();
    const md = renderSummaryOnly(report);

    expect(md).toContain('## Summary');
    expect(md).toContain('| Strategy');
    expect(md).toContain('Tickers');
    expect(md).toContain('RSI Oversold');
  });

  it('includes fired triggers list when strategies fired', () => {
    const report = makeReportWithFired();
    const md = renderSummaryOnly(report);

    expect(md).toContain('### Fired Triggers');
    expect(md).toContain('RSI Oversold');
    expect(md).toContain('AAPL');
    expect(md).toContain('STRONG');
  });

  it('does not include portfolio context appendix', () => {
    const report = makeReport();
    const md = renderSummaryOnly(report);

    expect(md).not.toContain('## Portfolio Context');
    expect(md).not.toContain('### Prices & Changes');
  });

  it('does not include strategy breakdown section', () => {
    const report = makeReport();
    const md = renderSummaryOnly(report);

    expect(md).not.toContain('## Strategy Breakdown');
  });
});

// ---------------------------------------------------------------------------
// formatPrice / formatPercent / formatValue helpers
// ---------------------------------------------------------------------------

describe('formatPrice', () => {
  it('formats a number as dollar price', () => {
    expect(formatPrice(182.5)).toBe('$182.50');
  });

  it('returns — for non-finite values', () => {
    expect(formatPrice(NaN)).toBe('—');
    expect(formatPrice(Infinity)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('formats a whole percent (non-fractional) correctly', () => {
    expect(formatPercent(5.5)).toBe('+5.50%');
    expect(formatPercent(-1.2)).toBe('-1.20%');
  });

  it('formats a fractional (0-1) percent when fractional=true', () => {
    expect(formatPercent(0.155, true)).toBe('+15.50%');
    expect(formatPercent(-0.012, true)).toBe('-1.20%');
  });

  it('returns — for non-finite values', () => {
    expect(formatPercent(NaN)).toBe('—');
  });
});

describe('formatValue', () => {
  it('returns — for null', () => {
    expect(formatValue(null)).toBe('—');
  });

  it('returns — for undefined', () => {
    expect(formatValue(undefined)).toBe('—');
  });

  it('formats numbers to 2 decimal places', () => {
    expect(formatValue(67.2)).toBe('67.20');
    expect(formatValue(30)).toBe('30.00');
  });

  it('returns strings as-is', () => {
    expect(formatValue('BULLISH')).toBe('BULLISH');
  });
});
