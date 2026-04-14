import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Entity } from '@yojinhq/jintel-client';
import { describe, expect, it } from 'vitest';

import type { Signal } from '../../src/signals/types.js';
import { buildPortfolioContext } from '../../src/strategies/portfolio-context-builder.js';
import { StrategyEvaluator } from '../../src/strategies/strategy-evaluator.js';
import { StrategyStore } from '../../src/strategies/strategy-store.js';
import type { Strategy } from '../../src/strategies/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStrategy(
  overrides: Partial<Strategy> &
    Pick<Strategy, 'id'> & {
      triggers?: Strategy['triggerGroups'][number]['conditions'];
      triggerGroups?: Strategy['triggerGroups'];
    },
): Strategy {
  const triggerGroups =
    overrides.triggerGroups ??
    (overrides.triggers
      ? overrides.triggers.map((t) => ({ label: '', conditions: [t] }))
      : [{ label: '', conditions: [{ type: 'CUSTOM' as const, description: 'default' }] }]);

  const { triggers: _triggers, ...rest } = overrides;

  return {
    name: 'Test Strategy',
    description: 'Test',
    category: 'MARKET',
    active: true,
    source: 'custom',
    style: 'mean_reversion',
    requires: ['technicals'],
    createdBy: 'test',
    createdAt: new Date().toISOString(),
    content: '# Test\nBuy when conditions met.',
    tickers: [],
    triggerGroups,
    ...rest,
  };
}

function makeSnapshot(positions: { symbol: string; currentPrice: number; marketValue: number }[], totalValue: number) {
  return { positions, totalValue };
}

function makeEntity(
  ticker: string,
  opts?: {
    rsi?: number | null;
    fiftyTwoWeekHigh?: number | null;
  },
): Entity {
  return {
    id: ticker,
    name: ticker,
    type: 'COMPANY' as const,
    tickers: [ticker],
    technicals:
      opts?.rsi != null
        ? {
            ticker,
            rsi: opts.rsi,
            macd: null,
            bollingerBands: null,
            ema: null,
            sma: null,
            atr: null,
            vwma: null,
            mfi: null,
          }
        : null,
    market: {
      quote: null,
      fundamentals:
        opts?.fiftyTwoWeekHigh != null
          ? { fiftyTwoWeekHigh: opts.fiftyTwoWeekHigh, fiftyTwoWeekLow: 0, source: 'yf' }
          : null,
    },
  } as Entity;
}

// ---------------------------------------------------------------------------
// Integration tests: buildPortfolioContext -> StrategyEvaluator.evaluate
// ---------------------------------------------------------------------------

describe('strategy evaluation integration', () => {
  it('INDICATOR_THRESHOLD fires when RSI is below threshold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-rsi-oversold',
        triggers: [
          {
            type: 'INDICATOR_THRESHOLD',
            description: 'RSI below 30',
            params: { indicator: 'RSI', threshold: 30, direction: 'below' },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));

      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot(
        [
          { symbol: 'AAPL', currentPrice: 150, marketValue: 5000 },
          { symbol: 'GOOG', currentPrice: 100, marketValue: 5000 },
        ],
        10000,
      );

      const entities = [makeEntity('AAPL', { rsi: 25.0 }), makeEntity('GOOG', { rsi: 55.0 })];

      const ctx = buildPortfolioContext(snapshot, [], entities);
      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluate(ctx);

      expect(results).toHaveLength(1);
      expect(results[0].context['ticker']).toBe('AAPL');
      expect(results[0].context['indicator']).toBe('RSI');
      expect(results[0].context['value']).toBe(25.0);
      expect(results[0].context['threshold']).toBe(30);
      expect(results[0].triggerType).toBe('INDICATOR_THRESHOLD');
      expect(results[0].strategyId).toBe('test-rsi-oversold');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('DRAWDOWN fires when position drops past threshold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-drawdown',
        category: 'RISK',
        triggers: [
          {
            type: 'DRAWDOWN',
            description: 'Position drawdown exceeds 15%',
            params: { threshold: -0.15 },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));

      const store = new StrategyStore({ dir });
      await store.initialize();

      // TSLA: price 80, 52wk high 100 -> drawdown = (80-100)/100 = -0.20 (fires)
      // MSFT: price 400, 52wk high 420 -> drawdown = (400-420)/420 = -0.0476 (doesn't fire)
      const snapshot = makeSnapshot(
        [
          { symbol: 'TSLA', currentPrice: 80, marketValue: 4000 },
          { symbol: 'MSFT', currentPrice: 400, marketValue: 6000 },
        ],
        10000,
      );

      const entities = [makeEntity('TSLA', { fiftyTwoWeekHigh: 100 }), makeEntity('MSFT', { fiftyTwoWeekHigh: 420 })];

      const ctx = buildPortfolioContext(snapshot, [], entities);

      // Verify drawdowns are computed correctly before evaluating
      expect(ctx.positionDrawdowns['TSLA']).toBeCloseTo(-0.2);
      expect(ctx.positionDrawdowns['MSFT']).toBeCloseTo(-0.0476, 3);

      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluate(ctx);

      expect(results).toHaveLength(1);
      expect(results[0].context['ticker']).toBe('TSLA');
      expect(results[0].context['drawdown']).toBeCloseTo(-0.2);
      expect(results[0].context['threshold']).toBe(-0.15);
      expect(results[0].triggerType).toBe('DRAWDOWN');
      expect(results[0].strategyId).toBe('test-drawdown');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('CONCENTRATION_DRIFT fires for overweight positions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-concentration',
        category: 'PORTFOLIO',
        triggers: [
          {
            type: 'CONCENTRATION_DRIFT',
            description: 'Position exceeds 12% weight',
            params: { maxWeight: 0.12 },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));

      const store = new StrategyStore({ dir });
      await store.initialize();

      // AAPL: 60% weight, GOOG: 40% weight — both exceed 12%
      const snapshot = makeSnapshot(
        [
          { symbol: 'AAPL', currentPrice: 150, marketValue: 6000 },
          { symbol: 'GOOG', currentPrice: 100, marketValue: 4000 },
        ],
        10000,
      );

      const ctx = buildPortfolioContext(snapshot, [], []);

      // Verify weights before evaluating
      expect(ctx.weights['AAPL']).toBeCloseTo(0.6);
      expect(ctx.weights['GOOG']).toBeCloseTo(0.4);

      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluate(ctx);

      expect(results).toHaveLength(2);

      const tickers = results.map((r) => r.context['ticker']).sort();
      expect(tickers).toEqual(['AAPL', 'GOOG']);

      const aaplResult = results.find((r) => r.context['ticker'] === 'AAPL')!;
      expect(aaplResult.context['weight']).toBeCloseTo(0.6);
      expect(aaplResult.context['maxWeight']).toBe(0.12);
      expect(aaplResult.triggerType).toBe('CONCENTRATION_DRIFT');

      const googResult = results.find((r) => r.context['ticker'] === 'GOOG')!;
      expect(googResult.context['weight']).toBeCloseTo(0.4);
      expect(googResult.context['maxWeight']).toBe(0.12);
      expect(googResult.strategyId).toBe('test-concentration');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // PRICE_MOVE with lookback_months (multi-period returns)
  // -------------------------------------------------------------------------

  it('PRICE_MOVE with lookback_months fires on 6-month return exceeding threshold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-price-momentum-6m',
        triggers: [
          {
            type: 'PRICE_MOVE',
            description: '6-month return above 10%',
            params: { threshold: 0.1, lookback_months: 6 },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));

      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot(
        [
          { symbol: 'AAPL', currentPrice: 165, marketValue: 8250 },
          { symbol: 'GOOG', currentPrice: 100, marketValue: 5000 },
        ],
        13250,
      );

      // Build price histories: AAPL +15% over 6 months (fires), GOOG +5% (doesn't fire)
      const now = new Date();
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const priceHistories = [
        {
          ticker: 'AAPL',
          history: [
            { date: sixMonthsAgo.toISOString().slice(0, 10), open: 100, high: 100, low: 100, close: 100, volume: 1000 },
            { date: now.toISOString().slice(0, 10), open: 115, high: 115, low: 115, close: 115, volume: 1000 },
          ],
        },
        {
          ticker: 'GOOG',
          history: [
            { date: sixMonthsAgo.toISOString().slice(0, 10), open: 100, high: 100, low: 100, close: 100, volume: 1000 },
            { date: now.toISOString().slice(0, 10), open: 105, high: 105, low: 105, close: 105, volume: 1000 },
          ],
        },
      ];

      const ctx = buildPortfolioContext(snapshot, [], [], priceHistories);

      // Verify period returns are populated
      expect(ctx.periodReturns?.['AAPL:6']).toBeCloseTo(0.15, 1);
      expect(ctx.periodReturns?.['GOOG:6']).toBeCloseTo(0.05, 1);

      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluate(ctx);

      // Only AAPL fires (15% > 10% threshold)
      expect(results).toHaveLength(1);
      expect(results[0].context['ticker']).toBe('AAPL');
      expect(results[0].triggerType).toBe('PRICE_MOVE');
      expect(results[0].context['threshold']).toBe(0.1);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // SIGNAL_PRESENT — invalid signal_types validation
  // -------------------------------------------------------------------------

  it('SIGNAL_PRESENT filters out invalid signal_types entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-signal-invalid-type',
        triggers: [
          {
            type: 'SIGNAL_PRESENT',
            description: 'Recent news',
            // 'NEWZ' is a typo — should be filtered out, leaving only 'NEWS'
            params: { signal_types: ['NEWZ', 'NEWS'], lookback_hours: 24 },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 1500 }], 1500);
      const signalsByTicker = {
        AAPL: [makeNewsSignal('AAPL', { id: 's1', hoursAgo: 2 })],
      };
      const ctx = buildPortfolioContext(snapshot, [], [], undefined, signalsByTicker);

      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluate(ctx);

      // Should still fire because 'NEWS' is valid even though 'NEWZ' was filtered
      expect(results).toHaveLength(1);
      expect(results[0].context['signalType']).toBe('NEWS');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('SIGNAL_PRESENT returns null when all signal_types are invalid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-signal-all-invalid',
        triggers: [
          {
            type: 'SIGNAL_PRESENT',
            description: 'Broken types',
            params: { signal_types: ['NEWZ', 'FAKETYPE'], lookback_hours: 24 },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 1500 }], 1500);
      const signalsByTicker = {
        AAPL: [makeNewsSignal('AAPL', { id: 's1', hoursAgo: 2 })],
      };
      const ctx = buildPortfolioContext(snapshot, [], [], undefined, signalsByTicker);

      const evaluator = new StrategyEvaluator(store);
      // All signal types are invalid → filter leaves empty array → trigger returns null
      expect(evaluator.evaluate(ctx)).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // METRIC_THRESHOLD
  // -------------------------------------------------------------------------

  function makeEntityWithSUE(ticker: string, sue: number | null): Entity {
    if (sue == null) {
      return {
        id: ticker,
        name: ticker,
        type: 'COMPANY' as const,
        tickers: [ticker],
        market: { quote: null, fundamentals: null },
      } as Entity;
    }
    // Construct 4-quarter diffs [a, b, b, b] where a=1 and b = 1 - 2/sue.
    // This yields sample stddev = |a - b| / 2 = 1/sue, so SUE = a / stddev = sue exactly.
    if (sue === 0 || !Number.isFinite(sue)) {
      throw new Error('SUE must be a finite non-zero value for this fixture');
    }
    const a = 1;
    const b = 1 - 2 / sue;
    return {
      id: ticker,
      name: ticker,
      type: 'COMPANY' as const,
      tickers: [ticker],
      market: {
        quote: null,
        fundamentals: {
          source: 'test',
          earningsHistory: [
            { period: '2024-12-31', epsDifference: a },
            { period: '2024-09-30', epsDifference: b },
            { period: '2024-06-30', epsDifference: b },
            { period: '2024-03-31', epsDifference: b },
          ],
        },
      },
    } as unknown as Entity;
  }

  it('METRIC_THRESHOLD (SUE) fires when value exceeds threshold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-sue',
        triggers: [
          {
            type: 'METRIC_THRESHOLD',
            description: 'SUE above 2.0',
            params: { metric: 'SUE', threshold: 2.0, direction: 'above' },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot(
        [
          { symbol: 'HIGH', currentPrice: 100, marketValue: 1000 },
          { symbol: 'LOW', currentPrice: 100, marketValue: 1000 },
          { symbol: 'MISSING', currentPrice: 100, marketValue: 1000 },
        ],
        3000,
      );
      const entities = [
        makeEntityWithSUE('HIGH', 3),
        makeEntityWithSUE('LOW', 1.5),
        makeEntityWithSUE('MISSING', null),
      ];
      const ctx = buildPortfolioContext(snapshot, [], entities);

      expect(ctx.metrics['HIGH'].SUE).toBeCloseTo(3, 5);
      expect(ctx.metrics['LOW'].SUE).toBeCloseTo(1.5, 5);
      expect(ctx.metrics['MISSING']).toBeUndefined();

      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluate(ctx);

      // Only HIGH (SUE=3) exceeds threshold 2.0
      expect(results).toHaveLength(1);
      expect(results[0].context['ticker']).toBe('HIGH');
      expect(results[0].context['metric']).toBe('SUE');
      expect(results[0].triggerType).toBe('METRIC_THRESHOLD');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // SIGNAL_PRESENT
  // -------------------------------------------------------------------------

  function makeNewsSignal(ticker: string, opts: { id: string; hoursAgo: number; sentimentScore?: number }): Signal {
    const publishedAt = new Date(Date.now() - opts.hoursAgo * 3_600_000).toISOString();
    return {
      id: opts.id,
      type: 'NEWS',
      title: `${ticker} news ${opts.id}`,
      sources: [{ id: 'src', name: 'Test', type: 'API', reliability: 0.8 }],
      assets: [{ ticker, linkType: 'DIRECT' }],
      publishedAt,
      ingestedAt: publishedAt,
      contentHash: opts.id,
      confidence: 0.8,
      ...(opts.sentimentScore != null ? { sentimentScore: opts.sentimentScore } : {}),
    } as unknown as Signal;
  }

  it('SIGNAL_PRESENT fires on matching type + sentiment threshold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-signal-present',
        triggers: [
          {
            type: 'SIGNAL_PRESENT',
            description: 'Recent bullish news',
            params: { signal_types: ['NEWS'], min_sentiment: 0.3, lookback_hours: 24 },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 1500 }], 1500);
      const signalsByTicker = {
        AAPL: [makeNewsSignal('AAPL', { id: 's1', hoursAgo: 2, sentimentScore: 0.5 })],
      };
      const ctx = buildPortfolioContext(snapshot, [], [], undefined, signalsByTicker);

      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluate(ctx);

      expect(results).toHaveLength(1);
      expect(results[0].context['ticker']).toBe('AAPL');
      expect(results[0].context['signalId']).toBe('s1');
      expect(results[0].triggerType).toBe('SIGNAL_PRESENT');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('SIGNAL_PRESENT does not fire when sentimentScore is below threshold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-signal-low',
        triggers: [
          {
            type: 'SIGNAL_PRESENT',
            description: 'Recent bullish news',
            params: { signal_types: ['NEWS'], min_sentiment: 0.3 },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 1500 }], 1500);
      const signalsByTicker = {
        AAPL: [makeNewsSignal('AAPL', { id: 's1', hoursAgo: 2, sentimentScore: 0.1 })],
      };
      const ctx = buildPortfolioContext(snapshot, [], [], undefined, signalsByTicker);

      const evaluator = new StrategyEvaluator(store);
      expect(evaluator.evaluate(ctx)).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('SIGNAL_PRESENT does not fire when sentiment is missing and a threshold is required', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-signal-nosent',
        triggers: [
          {
            type: 'SIGNAL_PRESENT',
            description: 'Recent bullish news',
            params: { signal_types: ['NEWS'], min_sentiment: 0.3 },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 1500 }], 1500);
      const signalsByTicker = {
        AAPL: [makeNewsSignal('AAPL', { id: 's1', hoursAgo: 2 })], // no sentimentScore
      };
      const ctx = buildPortfolioContext(snapshot, [], [], undefined, signalsByTicker);

      const evaluator = new StrategyEvaluator(store);
      expect(evaluator.evaluate(ctx)).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('SIGNAL_PRESENT honors the 24h lookback cap (48h request is clamped)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-signal-cap',
        triggers: [
          {
            type: 'SIGNAL_PRESENT',
            description: 'Any recent news',
            params: { signal_types: ['NEWS'], lookback_hours: 48 }, // request 48h, should clamp to 24h
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 1500 }], 1500);
      const signalsByTicker = {
        // 30h ago — inside requested 48h, outside hard-capped 24h
        AAPL: [makeNewsSignal('AAPL', { id: 'old', hoursAgo: 30 })],
      };
      const ctx = buildPortfolioContext(snapshot, [], [], undefined, signalsByTicker);

      const evaluator = new StrategyEvaluator(store);
      // Should NOT fire because 30h > 24h cap
      expect(evaluator.evaluate(ctx)).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// evaluateForTickers — per-asset micro flow evaluation
// ---------------------------------------------------------------------------

describe('evaluateForTickers', () => {
  it('only evaluates specified tickers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-rsi',
        triggers: [
          {
            type: 'INDICATOR_THRESHOLD',
            description: 'RSI below 30',
            params: { indicator: 'RSI', threshold: 30, direction: 'below' },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      // Both AAPL and GOOG have low RSI, but we only evaluate AAPL
      const snapshot = makeSnapshot(
        [
          { symbol: 'AAPL', currentPrice: 150, marketValue: 5000 },
          { symbol: 'GOOG', currentPrice: 100, marketValue: 5000 },
        ],
        10000,
      );
      const entities = [makeEntity('AAPL', { rsi: 25 }), makeEntity('GOOG', { rsi: 20 })];
      const ctx = buildPortfolioContext(snapshot, [], entities);

      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluateForTickers(ctx, ['AAPL']);

      expect(results).toHaveLength(1);
      expect(results[0].context['ticker']).toBe('AAPL');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('skips CONCENTRATION_DRIFT triggers (macro-only)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-conc',
        triggers: [
          {
            type: 'CONCENTRATION_DRIFT',
            description: 'Position exceeds 12%',
            params: { maxWeight: 0.12 },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 10000 }], 10000);
      const ctx = buildPortfolioContext(snapshot, [], []);
      // AAPL is 100% weight, far above 12% — but should NOT fire in micro
      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluateForTickers(ctx, ['AAPL']);

      expect(results).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('skips CUSTOM triggers (macro-only)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-custom',
        triggers: [
          {
            type: 'CUSTOM',
            description: 'Custom condition',
            params: {},
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 5000 }], 5000);
      const ctx = buildPortfolioContext(snapshot, [], []);

      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluateForTickers(ctx, ['AAPL']);
      expect(results).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('skips PRICE_MOVE with lookback_months (needs price history)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-price-lookback',
        triggers: [
          {
            type: 'PRICE_MOVE',
            description: '6-month return above 10%',
            params: { threshold: 0.1, lookback_months: 6 },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const now = new Date();
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const priceHistories = [
        {
          ticker: 'AAPL',
          history: [
            { date: sixMonthsAgo.toISOString().slice(0, 10), open: 100, high: 100, low: 100, close: 100, volume: 1000 },
            { date: now.toISOString().slice(0, 10), open: 150, high: 150, low: 150, close: 150, volume: 1000 },
          ],
        },
      ];
      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 7500 }], 7500);
      const ctx = buildPortfolioContext(snapshot, [], [], priceHistories);

      // Verify the period return IS there (would fire in macro)
      expect(ctx.periodReturns?.['AAPL:6']).toBeCloseTo(0.5, 1);

      const evaluator = new StrategyEvaluator(store);
      // But evaluateForTickers skips it
      const results = evaluator.evaluateForTickers(ctx, ['AAPL']);
      expect(results).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('allows daily PRICE_MOVE (no lookback_months) in micro', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-price-daily',
        triggers: [
          {
            type: 'PRICE_MOVE',
            description: 'Daily drop > 5%',
            params: { threshold: -0.05 },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 142, marketValue: 7100 }], 7100);
      const entities = [makeEntity('AAPL')];
      const quotes = [
        {
          ticker: 'AAPL',
          price: 142,
          change: -8,
          changePercent: -5.3,
          volume: 1_000_000,
          timestamp: new Date().toISOString(),
          source: 'test',
        },
      ];
      const ctx = buildPortfolioContext(snapshot, quotes, entities);

      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluateForTickers(ctx, ['AAPL']);

      expect(results).toHaveLength(1);
      expect(results[0].context['ticker']).toBe('AAPL');
      expect(results[0].triggerType).toBe('PRICE_MOVE');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('only evaluates strategies whose tickers overlap with specified tickers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategyAAPL = makeStrategy({
        id: 'test-aapl-only',
        tickers: ['AAPL'],
        triggers: [
          {
            type: 'INDICATOR_THRESHOLD',
            description: 'RSI below 30',
            params: { indicator: 'RSI', threshold: 30, direction: 'below' },
          },
        ],
      });
      const strategyGOOG = makeStrategy({
        id: 'test-goog-only',
        tickers: ['GOOG'],
        triggers: [
          {
            type: 'INDICATOR_THRESHOLD',
            description: 'RSI below 30',
            params: { indicator: 'RSI', threshold: 30, direction: 'below' },
          },
        ],
      });
      await writeFile(join(dir, `${strategyAAPL.id}.json`), JSON.stringify(strategyAAPL));
      await writeFile(join(dir, `${strategyGOOG.id}.json`), JSON.stringify(strategyGOOG));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot(
        [
          { symbol: 'AAPL', currentPrice: 150, marketValue: 5000 },
          { symbol: 'GOOG', currentPrice: 100, marketValue: 5000 },
        ],
        10000,
      );
      const entities = [makeEntity('AAPL', { rsi: 25 }), makeEntity('GOOG', { rsi: 20 })];
      const ctx = buildPortfolioContext(snapshot, [], entities);

      const evaluator = new StrategyEvaluator(store);
      // Only evaluate AAPL — GOOG-only strategy should be skipped
      const results = evaluator.evaluateForTickers(ctx, ['AAPL']);

      expect(results).toHaveLength(1);
      expect(results[0].strategyId).toBe('test-aapl-only');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('generates correct triggerId format', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-trigger-id',
        triggers: [
          {
            type: 'INDICATOR_THRESHOLD',
            description: 'RSI below 30',
            params: { indicator: 'RSI', threshold: 30, direction: 'below' },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 5000 }], 5000);
      const entities = [makeEntity('AAPL', { rsi: 25 })];
      const ctx = buildPortfolioContext(snapshot, [], entities);

      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluateForTickers(ctx, ['AAPL']);

      expect(results).toHaveLength(1);
      expect(results[0].triggerId).toBe('test-trigger-id-group0-AAPL');
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Trigger groups (AND/OR)
// ---------------------------------------------------------------------------

describe('trigger groups (AND/OR)', () => {
  it('AND group: fires only when ALL conditions in a group are true', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-and-group',
        triggerGroups: [
          {
            label: 'Entry',
            conditions: [
              {
                type: 'INDICATOR_THRESHOLD',
                description: 'RSI below 30',
                params: { indicator: 'RSI', threshold: 30, direction: 'below' },
              },
              { type: 'DRAWDOWN', description: 'Drawdown > 15%', params: { threshold: -0.15 } },
            ],
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot(
        [
          { symbol: 'AAPL', currentPrice: 80, marketValue: 4000 },
          { symbol: 'GOOG', currentPrice: 95, marketValue: 4750 },
        ],
        8750,
      );
      const entities = [
        makeEntity('AAPL', { rsi: 25, fiftyTwoWeekHigh: 100 }),
        makeEntity('GOOG', { rsi: 25, fiftyTwoWeekHigh: 100 }),
      ];
      const ctx = buildPortfolioContext(snapshot, [], entities);

      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluate(ctx);

      // AAPL: RSI=25 (below 30) AND drawdown=-20% (below -15%) -> fires
      // GOOG: RSI=25 (below 30) AND drawdown=-5% (above -15%) -> doesn't fire
      expect(results).toHaveLength(1);
      expect(results[0].context['ticker']).toBe('AAPL');
      expect(results[0].triggerId).toBe('test-and-group-group0-AAPL');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('OR across groups: fires if ANY group fires', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-or-groups',
        triggerGroups: [
          {
            label: 'RSI signal',
            conditions: [
              {
                type: 'INDICATOR_THRESHOLD',
                description: 'RSI below 20',
                params: { indicator: 'RSI', threshold: 20, direction: 'below' },
              },
            ],
          },
          {
            label: 'Drawdown signal',
            conditions: [{ type: 'DRAWDOWN', description: 'Drawdown > 15%', params: { threshold: -0.15 } }],
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      // AAPL: RSI=55 (group 1 no), drawdown=-20% (group 2 yes)
      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 80, marketValue: 4000 }], 4000);
      const entities = [makeEntity('AAPL', { rsi: 55, fiftyTwoWeekHigh: 100 })];
      const ctx = buildPortfolioContext(snapshot, [], entities);

      const evaluator = new StrategyEvaluator(store);
      const results = evaluator.evaluate(ctx);

      expect(results).toHaveLength(1);
      expect(results[0].triggerId).toBe('test-or-groups-group1-AAPL');
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Crossover detection
// ---------------------------------------------------------------------------

describe('crossover detection', () => {
  it('crosses_below fires when indicator transitions through threshold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-crossover',
        triggerGroups: [
          {
            label: '',
            conditions: [
              {
                type: 'INDICATOR_THRESHOLD',
                description: 'RSI crosses below 30',
                params: { indicator: 'RSI', threshold: 30, direction: 'crosses_below' },
              },
            ],
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const evaluator = new StrategyEvaluator(store);
      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 5000 }], 5000);

      // Run 1: RSI=45 -- seeds cache, no crossover
      const ctx1 = buildPortfolioContext(snapshot, [], [makeEntity('AAPL', { rsi: 45 })]);
      expect(evaluator.evaluate(ctx1)).toHaveLength(0);

      // Run 2: RSI=25 -- crosses below 30
      const ctx2 = buildPortfolioContext(snapshot, [], [makeEntity('AAPL', { rsi: 25 })]);
      const results2 = evaluator.evaluate(ctx2);
      expect(results2).toHaveLength(1);
      expect(results2[0].context['ticker']).toBe('AAPL');
      expect(results2[0].context['crossover']).toBe('crosses_below');

      // Run 3: RSI=20 -- still below, no new crossover
      const ctx3 = buildPortfolioContext(snapshot, [], [makeEntity('AAPL', { rsi: 20 })]);
      expect(evaluator.evaluate(ctx3)).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('crosses_above fires on upward transition', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-cross-above',
        triggerGroups: [
          {
            label: '',
            conditions: [
              {
                type: 'INDICATOR_THRESHOLD',
                description: 'RSI crosses above 70',
                params: { indicator: 'RSI', threshold: 70, direction: 'crosses_above' },
              },
            ],
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const evaluator = new StrategyEvaluator(store);
      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 5000 }], 5000);

      // Run 1: RSI=65 -- seeds cache
      const ctx1 = buildPortfolioContext(snapshot, [], [makeEntity('AAPL', { rsi: 65 })]);
      expect(evaluator.evaluate(ctx1)).toHaveLength(0);

      // Run 2: RSI=75 -- crosses above 70
      const ctx2 = buildPortfolioContext(snapshot, [], [makeEntity('AAPL', { rsi: 75 })]);
      const results2 = evaluator.evaluate(ctx2);
      expect(results2).toHaveLength(1);
      expect(results2[0].context['crossover']).toBe('crosses_above');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('cold start: first evaluation seeds cache, does not fire crossover', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-eval-'));
    try {
      const strategy = makeStrategy({
        id: 'test-cold-start',
        triggerGroups: [
          {
            label: '',
            conditions: [
              {
                type: 'INDICATOR_THRESHOLD',
                description: 'RSI crosses below 30',
                params: { indicator: 'RSI', threshold: 30, direction: 'crosses_below' },
              },
            ],
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));
      const store = new StrategyStore({ dir });
      await store.initialize();

      const evaluator = new StrategyEvaluator(store);
      const snapshot = makeSnapshot([{ symbol: 'AAPL', currentPrice: 150, marketValue: 5000 }], 5000);

      // RSI already below 30 but no previous value -> no fire
      const ctx = buildPortfolioContext(snapshot, [], [makeEntity('AAPL', { rsi: 25 })]);
      expect(evaluator.evaluate(ctx)).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
