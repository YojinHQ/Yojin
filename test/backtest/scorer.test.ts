import { describe, expect, it } from 'vitest';

import type { PriceHistoryProvider } from '../../src/backtest/price-history.js';
import { ActionScorer } from '../../src/backtest/scorer.js';
import type { SimulatedAction } from '../../src/backtest/types.js';

function fakePriceHistory(prices: Record<string, Record<string, number>>): PriceHistoryProvider {
  return {
    async closeAt(ticker: string, date: string): Promise<number | null> {
      const byDate = prices[ticker];
      if (!byDate) return null;
      const sorted = Object.keys(byDate).sort();
      let best: string | null = null;
      for (const d of sorted) {
        if (d <= date) best = d;
        else break;
      }
      return best !== null ? byDate[best] : null;
    },
  } as unknown as PriceHistoryProvider;
}

function makeAction(
  overrides: Partial<SimulatedAction> & Pick<SimulatedAction, 'ticker' | 'verdict' | 'firedAt' | 'entryPrice'>,
): SimulatedAction {
  return {
    strategyId: 's1',
    strategyName: 'Test',
    triggerId: 't1',
    triggerType: 'CUSTOM',
    triggerStrength: 'MODERATE',
    horizonDays: 10,
    mappingReason: 'test',
    ...overrides,
  };
}

describe('ActionScorer', () => {
  it('computes positive hit for BUY when price rises', async () => {
    const ph = fakePriceHistory({ AAPL: { '2026-01-01': 100, '2026-01-11': 110 } });
    const scorer = new ActionScorer(ph);
    const card = await scorer.score(
      [makeAction({ ticker: 'AAPL', verdict: 'BUY', firedAt: '2026-01-01', entryPrice: 100 })],
      { strategyId: 's1', strategyName: 'Test', since: '2026-01-01', until: '2026-02-01', horizonDays: 10 },
    );
    expect(card.scoredCount).toBe(1);
    expect(card.actions[0].hit).toBe(true);
    expect(card.actions[0].returnPct).toBeCloseTo(10, 5);
    expect(card.hitRate).toBe(1);
    expect(card.score).toBeCloseTo(10, 5);
  });

  it('flips sign for SELL — profit when price falls', async () => {
    const ph = fakePriceHistory({ AAPL: { '2026-01-01': 100, '2026-01-11': 90 } });
    const scorer = new ActionScorer(ph);
    const card = await scorer.score(
      [makeAction({ ticker: 'AAPL', verdict: 'SELL', firedAt: '2026-01-01', entryPrice: 100 })],
      { strategyId: 's1', strategyName: 'Test', since: '2026-01-01', until: '2026-02-01', horizonDays: 10 },
    );
    expect(card.actions[0].hit).toBe(true);
    expect(card.actions[0].returnPct).toBeCloseTo(10, 5);
  });

  it('marks horizon-past-until as TRUNCATED', async () => {
    const ph = fakePriceHistory({ AAPL: { '2026-01-01': 100 } });
    const scorer = new ActionScorer(ph);
    const card = await scorer.score(
      [makeAction({ ticker: 'AAPL', verdict: 'BUY', firedAt: '2026-01-25', entryPrice: 100 })],
      { strategyId: 's1', strategyName: 'Test', since: '2026-01-01', until: '2026-01-31', horizonDays: 10 },
    );
    expect(card.actions[0].status).toBe('TRUNCATED');
    expect(card.scoredCount).toBe(0);
    expect(card.truncatedCount).toBe(1);
    expect(card.score).toBe(0);
  });

  it('marks missing exit price as NO_EXIT_DATA', async () => {
    const ph = fakePriceHistory({ AAPL: {} });
    const scorer = new ActionScorer(ph);
    const card = await scorer.score(
      [makeAction({ ticker: 'AAPL', verdict: 'BUY', firedAt: '2026-01-01', entryPrice: 100 })],
      { strategyId: 's1', strategyName: 'Test', since: '2026-01-01', until: '2026-02-01', horizonDays: 10 },
    );
    expect(card.actions[0].status).toBe('NO_EXIT_DATA');
    expect(card.noExitDataCount).toBe(1);
  });

  it('hitRate × avgReturn aggregates across actions', async () => {
    const ph = fakePriceHistory({
      AAPL: { '2026-01-01': 100, '2026-01-11': 110 },
      MSFT: { '2026-01-01': 200, '2026-01-11': 180 },
    });
    const scorer = new ActionScorer(ph);
    const card = await scorer.score(
      [
        makeAction({ ticker: 'AAPL', verdict: 'BUY', firedAt: '2026-01-01', entryPrice: 100 }),
        makeAction({ ticker: 'MSFT', verdict: 'BUY', firedAt: '2026-01-01', entryPrice: 200 }),
      ],
      { strategyId: 's1', strategyName: 'Test', since: '2026-01-01', until: '2026-02-01', horizonDays: 10 },
    );
    expect(card.scoredCount).toBe(2);
    expect(card.hitRate).toBe(0.5);
    expect(card.avgReturn).toBeCloseTo(0, 5); // +10 and -10 average to 0
    expect(card.score).toBeCloseTo(0, 5);
  });
});
