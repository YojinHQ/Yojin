import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { StrategyEvaluator } from '../../src/strategies/strategy-evaluator.js';
import { StrategyStore } from '../../src/strategies/strategy-store.js';
import type { StrategyTraceReport } from '../../src/strategies/trace-types.js';
import type { Strategy } from '../../src/strategies/types.js';

// ---------------------------------------------------------------------------
// Helpers (mirrors the pattern from strategy-evaluation-integration.test.ts)
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

function makePortfolioContext(
  tickers: string[],
  indicators: Record<string, Record<string, number>>,
): import('../../src/strategies/strategy-evaluator.js').PortfolioContext {
  const weights: Record<string, number> = {};
  const prices: Record<string, number> = {};
  const priceChanges: Record<string, number> = {};
  for (const t of tickers) {
    weights[t] = 1 / tickers.length;
    prices[t] = 100;
    priceChanges[t] = 0;
  }
  return {
    weights,
    prices,
    priceChanges,
    indicators,
    earningsDays: {},
    portfolioDrawdown: 0,
    positionDrawdowns: {},
    metrics: {},
    signals: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StrategyEvaluator trace mode', () => {
  it('returns a StrategyTraceReport with both PASS and FAIL conditions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-trace-'));
    try {
      const strategy = makeStrategy({
        id: 'test-rsi-oversold',
        name: 'RSI Oversold',
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

      const ctx = makePortfolioContext(['AAPL', 'GOOG'], {
        AAPL: { RSI: 25 },
        GOOG: { RSI: 55 },
      });

      const evaluator = new StrategyEvaluator(store);
      const report: StrategyTraceReport = evaluator.evaluate(ctx, { trace: true });

      expect(report.strategies).toHaveLength(1);
      const strat = report.strategies[0];
      expect(strat.strategyId).toBe('test-rsi-oversold');
      expect(strat.groups).toHaveLength(1);

      const group = strat.groups[0];
      expect(group.tickers).toHaveLength(2);

      // Find AAPL and GOOG traces
      const aaplTrace = group.tickers.find((t) => t.ticker === 'AAPL');
      const googTrace = group.tickers.find((t) => t.ticker === 'GOOG');

      expect(aaplTrace).toBeDefined();
      expect(aaplTrace!.groupResult).toBe('PASS');
      expect(aaplTrace!.conditions).toHaveLength(1);
      expect(aaplTrace!.conditions[0].result).toBe('PASS');
      expect(aaplTrace!.conditions[0].actualValue).toBe(25);

      expect(googTrace).toBeDefined();
      expect(googTrace!.groupResult).toBe('FAIL');
      expect(googTrace!.conditions).toHaveLength(1);
      expect(googTrace!.conditions[0].result).toBe('FAIL');
      expect(googTrace!.conditions[0].actualValue).toBe(55);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('reports NO_DATA when indicator is missing for a ticker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-trace-'));
    try {
      const strategy = makeStrategy({
        id: 'test-rsi-nodata',
        name: 'RSI No Data',
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

      // Empty indicators — no RSI data for any ticker
      const ctx = makePortfolioContext(['AAPL'], {});

      const evaluator = new StrategyEvaluator(store);
      const report: StrategyTraceReport = evaluator.evaluate(ctx, { trace: true });

      expect(report.strategies).toHaveLength(1);
      const group = report.strategies[0].groups[0];
      expect(group.tickers).toHaveLength(1);

      const aaplTrace = group.tickers[0];
      expect(aaplTrace.ticker).toBe('AAPL');
      expect(aaplTrace.conditions[0].result).toBe('NO_DATA');
      expect(aaplTrace.conditions[0].actualValue).toBeNull();
      expect(aaplTrace.conditions[0].failReason).toMatch(/undefined|missing|null|RSI/i);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('summary counts match trace details', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-trace-'));
    try {
      const strategy = makeStrategy({
        id: 'test-summary',
        name: 'Summary Test',
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

      const ctx = makePortfolioContext(['AAPL', 'GOOG'], {
        AAPL: { RSI: 25 }, // fires
        GOOG: { RSI: 55 }, // does not fire
      });

      const evaluator = new StrategyEvaluator(store);
      const report: StrategyTraceReport = evaluator.evaluate(ctx, { trace: true });

      const { summary } = report;

      // Strategy fired (AAPL passed)
      expect(summary.fired).toBe(1);
      expect(summary.noMatch).toBe(0);

      // firedList should contain AAPL
      expect(summary.firedList).toHaveLength(1);
      expect(summary.firedList[0].ticker).toBe('AAPL');
      expect(summary.firedList[0].strategy).toBe('Summary Test');
      expect(summary.firedList[0].strength).toBeDefined();

      // tickersEvaluated contains both tickers
      expect(summary.tickersEvaluated).toContain('AAPL');
      expect(summary.tickersEvaluated).toContain('GOOG');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('handles multi-group OR: picks the strongest group per ticker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-trace-'));
    try {
      const strategy = makeStrategy({
        id: 'test-multigroup-or',
        name: 'Multi-Group OR',
        triggerGroups: [
          {
            label: 'Group A',
            conditions: [
              {
                type: 'INDICATOR_THRESHOLD',
                description: 'RSI below 30',
                params: { indicator: 'RSI', threshold: 30, direction: 'below' },
              },
            ],
          },
          {
            label: 'Group B',
            conditions: [
              {
                type: 'DRAWDOWN',
                description: 'Drawdown below -5%',
                params: { threshold: -0.05 },
              },
            ],
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));

      const store = new StrategyStore({ dir });
      await store.initialize();

      // AAPL: RSI=25 passes Group A, drawdown=-0.08 passes Group B
      // GOOG: no RSI data (Group A fails with NO_DATA), drawdown=-0.06 passes Group B
      const ctx = makePortfolioContext(['AAPL', 'GOOG'], {
        AAPL: { RSI: 25 },
        // GOOG has no RSI data
      });
      ctx.positionDrawdowns['AAPL'] = -0.08;
      ctx.positionDrawdowns['GOOG'] = -0.06;

      const evaluator = new StrategyEvaluator(store);
      const report: StrategyTraceReport = evaluator.evaluate(ctx, { trace: true });

      expect(report.strategies).toHaveLength(1);
      const strat = report.strategies[0];

      // Strategy fired because at least one ticker passed at least one group
      expect(strat.result).toBe('FIRED');

      // Two groups present
      expect(strat.groups).toHaveLength(2);

      // GOOG passes Group B (drawdown below -0.05)
      const groupB = strat.groups[1];
      expect(groupB.label).toBe('Group B');
      const googGroupB = groupB.tickers.find((t) => t.ticker === 'GOOG');
      expect(googGroupB).toBeDefined();
      expect(googGroupB!.groupResult).toBe('PASS');

      // AAPL passes Group A (RSI below 30)
      const groupA = strat.groups[0];
      const aaplGroupA = groupA.tickers.find((t) => t.ticker === 'AAPL');
      expect(aaplGroupA).toBeDefined();
      expect(aaplGroupA!.groupResult).toBe('PASS');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('handles asset class filtering in trace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-trace-'));
    try {
      const strategy = makeStrategy({
        id: 'test-asset-class-filter',
        name: 'Equity Only',
        assetClasses: ['EQUITY'],
        triggers: [
          {
            type: 'DRAWDOWN',
            description: 'Drawdown below -10%',
            params: { threshold: -0.1 },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));

      const store = new StrategyStore({ dir });
      await store.initialize();

      // AAPL = EQUITY, GOOG = CRYPTO
      const ctx = makePortfolioContext(['AAPL', 'GOOG'], {});
      ctx.assetClasses = { AAPL: 'EQUITY', GOOG: 'CRYPTO' };

      const evaluator = new StrategyEvaluator(store);
      const report: StrategyTraceReport = evaluator.evaluate(ctx, { trace: true });

      expect(report.strategies).toHaveLength(1);
      const strat = report.strategies[0];

      // Only AAPL (EQUITY) should be in scopedTickers
      expect(strat.scopedTickers).toContain('AAPL');
      expect(strat.scopedTickers).not.toContain('GOOG');

      // GOOG should appear in filteredOutTickers with a reason
      expect(strat.filteredOutTickers).toHaveLength(1);
      expect(strat.filteredOutTickers[0].ticker).toBe('GOOG');
      expect(strat.filteredOutTickers[0].reason).toMatch(/CRYPTO/);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('trace mode results are consistent with normal mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-trace-'));
    try {
      const strategy = makeStrategy({
        id: 'test-consistency',
        name: 'Consistency Test',
        triggers: [
          {
            type: 'INDICATOR_THRESHOLD',
            description: 'RSI below 30',
            params: { indicator: 'RSI', threshold: 30, direction: 'below' },
          },
        ],
      });
      await writeFile(join(dir, `${strategy.id}.json`), JSON.stringify(strategy));

      const ctx = makePortfolioContext(['AAPL', 'GOOG', 'TSLA'], {
        AAPL: { RSI: 20 }, // fires
        GOOG: { RSI: 60 }, // does not fire
        TSLA: { RSI: 28 }, // fires
      });

      // Use separate store instances to avoid shared previousValues state
      const store1 = new StrategyStore({ dir });
      await store1.initialize();
      const normalEvaluator = new StrategyEvaluator(store1);
      const normalResults = normalEvaluator.evaluate(ctx);

      const store2 = new StrategyStore({ dir });
      await store2.initialize();
      const traceEvaluator = new StrategyEvaluator(store2);
      const report: StrategyTraceReport = traceEvaluator.evaluate(ctx, { trace: true });

      // Normal mode should fire for AAPL and TSLA
      const normalFiredTickers = new Set(normalResults.map((r) => r.context['ticker'] as string));

      // Trace mode summary firedList should match
      const traceFiredTickers = new Set(report.summary.firedList.map((f) => f.ticker));

      expect(traceFiredTickers).toEqual(normalFiredTickers);

      // Both modes should agree on AAPL firing
      expect(normalFiredTickers.has('AAPL')).toBe(true);
      expect(traceFiredTickers.has('AAPL')).toBe(true);

      // Both modes should agree on GOOG NOT firing
      expect(normalFiredTickers.has('GOOG')).toBe(false);
      expect(traceFiredTickers.has('GOOG')).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
