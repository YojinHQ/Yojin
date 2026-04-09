import type { Entity, MarketQuote, SocialSentiment, TechnicalIndicators } from '@yojinhq/jintel-client';
import { describe, expect, it } from 'vitest';

import type { Signal } from '../../src/signals/types.js';
import {
  buildPortfolioContext,
  computeDrawdown,
  computePeriodReturns,
  computeSUE,
  computeSentimentMomentum24h,
  mapIndicators,
  mapMetrics,
} from '../../src/skills/portfolio-context-builder.js';

describe('mapIndicators', () => {
  it('returns {} for null input', () => {
    expect(mapIndicators(null)).toEqual({});
  });

  it('returns {} for undefined input', () => {
    expect(mapIndicators(undefined)).toEqual({});
  });

  it('maps all scalar indicators', () => {
    const tech: TechnicalIndicators = {
      ticker: 'AAPL',
      rsi: 65,
      ema: 150.5,
      sma: 148.0,
      atr: 3.2,
      vwma: 149.0,
      mfi: 55,
    };
    const result = mapIndicators(tech);
    expect(result).toEqual({
      RSI: 65,
      EMA: 150.5,
      SMA: 148.0,
      ATR: 3.2,
      VWMA: 149.0,
      MFI: 55,
    });
  });

  it('maps MACD fields (histogram as MACD, plus MACD_LINE and MACD_SIGNAL)', () => {
    const tech: TechnicalIndicators = {
      ticker: 'AAPL',
      macd: { macd: 2.5, signal: 1.8, histogram: 0.7 },
    };
    const result = mapIndicators(tech);
    expect(result).toEqual({
      MACD: 0.7,
      MACD_LINE: 2.5,
      MACD_SIGNAL: 1.8,
    });
  });

  it('maps Bollinger Bands fields', () => {
    const tech: TechnicalIndicators = {
      ticker: 'AAPL',
      bollingerBands: { upper: 160, middle: 150, lower: 140 },
    };
    const result = mapIndicators(tech);
    expect(result).toEqual({
      BB_UPPER: 160,
      BB_MIDDLE: 150,
      BB_LOWER: 140,
    });
  });

  it('skips null fields', () => {
    const tech: TechnicalIndicators = {
      ticker: 'AAPL',
      rsi: 70,
      macd: null,
      bollingerBands: null,
      ema: null,
      sma: 100,
    };
    const result = mapIndicators(tech);
    expect(result).toEqual({ RSI: 70, SMA: 100 });
  });

  it('skips undefined fields', () => {
    const tech: TechnicalIndicators = {
      ticker: 'AAPL',
      rsi: 42,
    };
    const result = mapIndicators(tech);
    expect(result).toEqual({ RSI: 42 });
  });
});

describe('computeDrawdown', () => {
  it('computes drawdown correctly', () => {
    // price 90, high 100 → (90 - 100) / 100 = -0.1
    expect(computeDrawdown(90, 100)).toBeCloseTo(-0.1);
  });

  it('returns 0 when at 52-week high', () => {
    expect(computeDrawdown(100, 100)).toBe(0);
  });

  it('returns 0 when high is null', () => {
    expect(computeDrawdown(90, null)).toBe(0);
  });

  it('returns 0 when high is undefined', () => {
    expect(computeDrawdown(90, undefined)).toBe(0);
  });

  it('returns 0 when high is zero', () => {
    expect(computeDrawdown(90, 0)).toBe(0);
  });
});

describe('buildPortfolioContext', () => {
  const makeSnapshot = (
    positions: { symbol: string; currentPrice: number; marketValue: number }[],
    totalValue: number,
  ) => ({ positions, totalValue });

  const makeQuote = (ticker: string, price: number, changePercent: number): MarketQuote => ({
    ticker,
    price,
    change: price * (changePercent / 100),
    changePercent,
    volume: 1_000_000,
    timestamp: new Date().toISOString(),
    source: 'test',
  });

  const makeEntity = (
    ticker: string,
    opts?: {
      technicals?: TechnicalIndicators | null;
      fiftyTwoWeekHigh?: number | null;
      earningsDate?: string | null;
    },
  ): Entity =>
    ({
      id: `entity-${ticker}`,
      name: ticker,
      type: 'COMPANY' as const,
      tickers: [ticker],
      technicals: opts?.technicals ?? null,
      market: {
        quote: null,
        fundamentals:
          opts?.fiftyTwoWeekHigh !== undefined || opts?.earningsDate !== undefined
            ? {
                source: 'test',
                fiftyTwoWeekHigh: opts?.fiftyTwoWeekHigh ?? null,
                earningsDate: opts?.earningsDate ?? null,
              }
            : null,
      },
    }) as Entity;

  it('computes weights from marketValue / totalValue', () => {
    const snapshot = makeSnapshot(
      [
        { symbol: 'AAPL', currentPrice: 150, marketValue: 6000 },
        { symbol: 'GOOG', currentPrice: 100, marketValue: 4000 },
      ],
      10000,
    );
    const ctx = buildPortfolioContext(snapshot, [], []);
    expect(ctx.weights.AAPL).toBeCloseTo(0.6);
    expect(ctx.weights.GOOG).toBeCloseTo(0.4);
  });

  it('prefers live quote price over snapshot currentPrice', () => {
    const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 5000 }], 5000);
    const quotes = [makeQuote('AAPL', 155, 3.3)];
    const ctx = buildPortfolioContext(snapshot, quotes, []);
    expect(ctx.prices.AAPL).toBe(155);
  });

  it('falls back to snapshot currentPrice when no quote', () => {
    const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 5000 }], 5000);
    const ctx = buildPortfolioContext(snapshot, [], []);
    expect(ctx.prices.AAPL).toBe(150);
  });

  it('converts changePercent to fraction', () => {
    const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 5000 }], 5000);
    const quotes = [makeQuote('AAPL', 155, 3.3)];
    const ctx = buildPortfolioContext(snapshot, quotes, []);
    expect(ctx.priceChanges.AAPL).toBeCloseTo(0.033);
  });

  it('maps indicators from entity technicals', () => {
    const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 5000 }], 5000);
    const entities = [
      makeEntity('AAPL', {
        technicals: { ticker: 'AAPL', rsi: 72, sma: 148 },
      }),
    ];
    const ctx = buildPortfolioContext(snapshot, [], entities);
    expect(ctx.indicators.AAPL).toEqual({ RSI: 72, SMA: 148 });
  });

  it('computes position drawdowns from fundamentals fiftyTwoWeekHigh', () => {
    const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 90, marketValue: 900 }], 900);
    const entities = [makeEntity('AAPL', { fiftyTwoWeekHigh: 100 })];
    const ctx = buildPortfolioContext(snapshot, [], entities);
    expect(ctx.positionDrawdowns.AAPL).toBeCloseTo(-0.1);
  });

  it('computes portfolio drawdown as weighted sum', () => {
    const snapshot = makeSnapshot(
      [
        { symbol: 'AAPL', currentPrice: 90, marketValue: 6000 },
        { symbol: 'GOOG', currentPrice: 95, marketValue: 4000 },
      ],
      10000,
    );
    const entities = [makeEntity('AAPL', { fiftyTwoWeekHigh: 100 }), makeEntity('GOOG', { fiftyTwoWeekHigh: 100 })];
    const ctx = buildPortfolioContext(snapshot, [], entities);
    // AAPL: weight=0.6, drawdown=(90-100)/100=-0.1
    // GOOG: weight=0.4, drawdown=(95-100)/100=-0.05
    // portfolio = 0.6*(-0.1) + 0.4*(-0.05) = -0.06 + -0.02 = -0.08
    expect(ctx.portfolioDrawdown).toBeCloseTo(-0.08);
  });

  it('computes earningsDays for future earnings date', () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const earningsDateStr = futureDate.toISOString().split('T')[0];
    const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 5000 }], 5000);
    const entities = [makeEntity('AAPL', { earningsDate: earningsDateStr })];
    const ctx = buildPortfolioContext(snapshot, [], entities);
    // Should be approximately 5 days (ceil of ~5 days)
    expect(ctx.earningsDays.AAPL).toBeGreaterThanOrEqual(4);
    expect(ctx.earningsDays.AAPL).toBeLessThanOrEqual(6);
  });

  it('omits earningsDays for past earnings date', () => {
    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const earningsDateStr = pastDate.toISOString().split('T')[0];
    const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 5000 }], 5000);
    const entities = [makeEntity('AAPL', { earningsDate: earningsDateStr })];
    const ctx = buildPortfolioContext(snapshot, [], entities);
    expect(ctx.earningsDays.AAPL).toBeUndefined();
  });

  it('handles empty portfolio', () => {
    const snapshot = makeSnapshot([], 0);
    const ctx = buildPortfolioContext(snapshot, [], []);
    expect(ctx.weights).toEqual({});
    expect(ctx.prices).toEqual({});
    expect(ctx.priceChanges).toEqual({});
    expect(ctx.indicators).toEqual({});
    expect(ctx.earningsDays).toEqual({});
    expect(ctx.positionDrawdowns).toEqual({});
    expect(ctx.portfolioDrawdown).toBe(0);
  });

  it('handles missing quotes gracefully', () => {
    const snapshot = makeSnapshot(
      [
        { symbol: 'AAPL', currentPrice: 150, marketValue: 5000 },
        { symbol: 'GOOG', currentPrice: 100, marketValue: 5000 },
      ],
      10000,
    );
    const quotes = [makeQuote('AAPL', 155, 2.0)];
    const ctx = buildPortfolioContext(snapshot, quotes, []);
    expect(ctx.prices.AAPL).toBe(155);
    expect(ctx.prices.GOOG).toBe(100);
    expect(ctx.priceChanges.AAPL).toBeCloseTo(0.02);
    expect(ctx.priceChanges.GOOG).toBeUndefined();
  });

  it('handles missing entities gracefully', () => {
    const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 5000 }], 5000);
    const ctx = buildPortfolioContext(snapshot, [], []);
    expect(ctx.indicators.AAPL).toBeUndefined();
    expect(ctx.positionDrawdowns.AAPL).toBe(0);
    expect(ctx.earningsDays.AAPL).toBeUndefined();
  });
});

describe('computePeriodReturns', () => {
  it('computes 12-month return with 1-month skip', () => {
    const now = new Date();
    const monthAgo = new Date(now);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    const yearAgo = new Date(now);
    yearAgo.setMonth(yearAgo.getMonth() - 12);

    const candles = [
      { date: yearAgo.toISOString().slice(0, 10), open: 100, high: 100, low: 100, close: 100, volume: 1000 },
      { date: monthAgo.toISOString().slice(0, 10), open: 115, high: 115, low: 115, close: 115, volume: 1000 },
      { date: now.toISOString().slice(0, 10), open: 130, high: 130, low: 130, close: 130, volume: 1000 },
    ];

    const result = computePeriodReturns([{ ticker: 'AAPL', history: candles }], [{ months: 12, skipMonths: 1 }]);

    // Return from 12 months ago to 1 month ago: (115-100)/100 = 0.15
    // The most recent candle (130) should be excluded by skipMonths
    expect(result['AAPL:12']).toBeCloseTo(0.15, 1);
  });

  it('returns empty for empty histories', () => {
    expect(computePeriodReturns([], [{ months: 12 }])).toEqual({});
  });

  it('returns empty when history has no candles', () => {
    expect(computePeriodReturns([{ ticker: 'AAPL', history: [] }], [{ months: 12 }])).toEqual({});
  });
});

describe('computeSUE', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(computeSUE(null)).toBeNull();
    expect(computeSUE(undefined)).toBeNull();
    expect(computeSUE([])).toBeNull();
  });

  it('returns null when fewer than 2 usable quarters', () => {
    expect(computeSUE([{ period: '2024-12-31', epsDifference: 0.5 }])).toBeNull();
    expect(
      computeSUE([
        { period: '2024-12-31', epsDifference: 0.5 },
        { period: '2024-09-30', epsDifference: null },
      ]),
    ).toBeNull();
  });

  it('returns null when stddev is zero (identical surprises)', () => {
    expect(
      computeSUE([
        { period: '2024-12-31', epsDifference: 0.2 },
        { period: '2024-09-30', epsDifference: 0.2 },
        { period: '2024-06-30', epsDifference: 0.2 },
        { period: '2024-03-31', epsDifference: 0.2 },
      ]),
    ).toBeNull();
  });

  it('computes SUE = latest / sample stddev', () => {
    // Diffs [1, 1/3, 1/3, 1/3]: mean = 0.5, variance = ((0.5)^2 + 3*(-1/6)^2)/3 = 0.25/3 + 1/36 ... easier to verify numerically
    const sue = computeSUE([
      { period: '2024-12-31', epsDifference: 1 },
      { period: '2024-09-30', epsDifference: 1 / 3 },
      { period: '2024-06-30', epsDifference: 1 / 3 },
      { period: '2024-03-31', epsDifference: 1 / 3 },
    ]);
    // Formula: a=1, b=1/3; mean = (1 + 3*(1/3))/4 = 0.5; variance = ((0.5)^2 + 3*(-1/6)^2)/3
    //   = (0.25 + 3*(1/36))/3 = (0.25 + 1/12)/3 = (1/3)/3 = 1/9; stddev = 1/3; SUE = 1 / (1/3) = 3
    expect(sue).toBeCloseTo(3, 5);
  });
});

describe('computeSentimentMomentum24h', () => {
  it('returns null for null/undefined sentiment', () => {
    expect(computeSentimentMomentum24h(null)).toBeNull();
    expect(computeSentimentMomentum24h(undefined)).toBeNull();
  });

  it('returns null when mentions24hAgo is missing or zero', () => {
    expect(computeSentimentMomentum24h({ mentions: 100 } as unknown as SocialSentiment)).toBeNull();
    expect(computeSentimentMomentum24h({ mentions: 100, mentions24hAgo: 0 } as unknown as SocialSentiment)).toBeNull();
  });

  it('computes fractional change in mention volume', () => {
    expect(
      computeSentimentMomentum24h({ mentions: 120, mentions24hAgo: 100 } as unknown as SocialSentiment),
    ).toBeCloseTo(0.2, 5);
    expect(
      computeSentimentMomentum24h({ mentions: 80, mentions24hAgo: 100 } as unknown as SocialSentiment),
    ).toBeCloseTo(-0.2, 5);
  });
});

describe('mapMetrics', () => {
  it('returns {} for null/undefined entity', () => {
    expect(mapMetrics(null)).toEqual({});
    expect(mapMetrics(undefined)).toEqual({});
  });

  it('maps priceToBook and bookValue when present', () => {
    const entity = {
      id: 'AAPL',
      tickers: ['AAPL'],
      market: {
        fundamentals: { priceToBook: 49.3, bookValue: 4.4 },
      },
    } as unknown as Entity;
    const result = mapMetrics(entity);
    expect(result.priceToBook).toBe(49.3);
    expect(result.bookValue).toBe(4.4);
  });

  it('omits keys when upstream fields are null', () => {
    const entity = {
      id: 'AAPL',
      tickers: ['AAPL'],
      market: {
        fundamentals: { priceToBook: null, bookValue: null },
      },
    } as unknown as Entity;
    expect(mapMetrics(entity)).toEqual({});
  });

  it('populates SUE when earningsHistory has enough usable quarters', () => {
    const entity = {
      id: 'AAPL',
      tickers: ['AAPL'],
      market: {
        fundamentals: {
          earningsHistory: [
            { period: '2024-12-31', epsDifference: 1 },
            { period: '2024-09-30', epsDifference: 1 / 3 },
            { period: '2024-06-30', epsDifference: 1 / 3 },
            { period: '2024-03-31', epsDifference: 1 / 3 },
          ],
        },
      },
    } as unknown as Entity;
    const result = mapMetrics(entity);
    expect(result.SUE).toBeCloseTo(3, 5);
  });

  it('populates sentiment_momentum_24h from entity.sentiment', () => {
    const entity = {
      id: 'AAPL',
      tickers: ['AAPL'],
      market: { fundamentals: null },
      sentiment: { mentions: 150, mentions24hAgo: 100 },
    } as unknown as Entity;
    expect(mapMetrics(entity).sentiment_momentum_24h).toBeCloseTo(0.5, 5);
  });
});

describe('buildPortfolioContext — signals passthrough', () => {
  it('passes signalsByTicker through to context.signals unchanged', () => {
    const signal: Signal = {
      id: 's1',
      type: 'NEWS',
      title: 'AAPL up',
      sources: [{ id: 'src', name: 'Src', type: 'API', reliability: 0.8 }],
      assets: [{ ticker: 'AAPL', linkType: 'DIRECT' }],
      publishedAt: new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
      contentHash: 'h1',
      confidence: 0.8,
    } as unknown as Signal;

    const snapshot = {
      positions: [{ symbol: 'AAPL', currentPrice: 150, marketValue: 1500 }],
      totalValue: 1500,
    };

    const ctx = buildPortfolioContext(snapshot, [], [], undefined, { AAPL: [signal] });
    expect(ctx.signals).toEqual({ AAPL: [signal] });
  });

  it('defaults signals to {} when signalsByTicker is omitted', () => {
    const snapshot = {
      positions: [{ symbol: 'AAPL', currentPrice: 150, marketValue: 1500 }],
      totalValue: 1500,
    };
    const ctx = buildPortfolioContext(snapshot, [], []);
    expect(ctx.signals).toEqual({});
    expect(ctx.metrics).toEqual({});
  });
});
