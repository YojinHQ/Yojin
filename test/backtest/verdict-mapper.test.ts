import { describe, expect, it } from 'vitest';

import { mapEvaluationToVerdict } from '../../src/backtest/verdict-mapper.js';
import type { Strategy, StrategyEvaluation } from '../../src/strategies/types.js';

function makeStrategy(style: Strategy['style']): Strategy {
  return {
    id: 's1',
    name: 'Test',
    description: 'x',
    category: 'MARKET',
    active: true,
    source: 'custom',
    style,
    requires: [],
    createdBy: 'test',
    createdAt: new Date().toISOString(),
    content: '#',
    triggerGroups: [{ label: '', conditions: [{ type: 'CUSTOM', description: 'x' }] }],
    tickers: ['AAPL'],
    assetClasses: [],
  };
}

function makeEvaluation(
  triggerType: StrategyEvaluation['triggerType'],
  context: Record<string, unknown>,
): StrategyEvaluation {
  return {
    strategyId: 's1',
    strategyName: 'Test',
    triggerId: 't1',
    triggerType,
    triggerDescription: 'x',
    context,
    strategyContent: '#',
    evaluatedAt: new Date().toISOString(),
    triggerStrength: 'MODERATE',
  };
}

describe('verdict-mapper', () => {
  it('uses explicit expectedDirection=UP → BUY', () => {
    const r = mapEvaluationToVerdict(makeEvaluation('CUSTOM', { expectedDirection: 'UP' }), makeStrategy('momentum'));
    expect(r?.verdict).toBe('BUY');
  });

  it('uses explicit expectedDirection=DOWN → SELL', () => {
    const r = mapEvaluationToVerdict(
      makeEvaluation('PRICE_MOVE', { expectedDirection: 'DOWN' }),
      makeStrategy('defensive'),
    );
    expect(r?.verdict).toBe('SELL');
  });

  it('mean_reversion + RSI below threshold → BUY', () => {
    const r = mapEvaluationToVerdict(
      makeEvaluation('INDICATOR_THRESHOLD', { direction: 'below', threshold: 30 }),
      makeStrategy('mean_reversion'),
    );
    expect(r?.verdict).toBe('BUY');
  });

  it('mean_reversion + RSI above threshold → SELL', () => {
    const r = mapEvaluationToVerdict(
      makeEvaluation('INDICATOR_THRESHOLD', { direction: 'above', threshold: 70 }),
      makeStrategy('mean_reversion'),
    );
    expect(r?.verdict).toBe('SELL');
  });

  it('momentum + price up → BUY', () => {
    const r = mapEvaluationToVerdict(makeEvaluation('PRICE_MOVE', { direction: 'up' }), makeStrategy('momentum'));
    expect(r?.verdict).toBe('BUY');
  });

  it('trend_following + price down → SELL', () => {
    const r = mapEvaluationToVerdict(
      makeEvaluation('PRICE_MOVE', { direction: 'down' }),
      makeStrategy('trend_following'),
    );
    expect(r?.verdict).toBe('SELL');
  });

  it('DRAWDOWN returns null (excluded from hit rate)', () => {
    const r = mapEvaluationToVerdict(makeEvaluation('DRAWDOWN', {}), makeStrategy('risk'));
    expect(r).toBeNull();
  });

  it('CONCENTRATION_DRIFT returns null', () => {
    const r = mapEvaluationToVerdict(makeEvaluation('CONCENTRATION_DRIFT', {}), makeStrategy('risk'));
    expect(r).toBeNull();
  });

  it('SIGNAL_PRESENT with bullish sentiment → BUY', () => {
    const r = mapEvaluationToVerdict(
      makeEvaluation('SIGNAL_PRESENT', { sentiment: 'bullish' }),
      makeStrategy('sentiment'),
    );
    expect(r?.verdict).toBe('BUY');
  });

  it('SIGNAL_PRESENT with bearish sentiment → SELL', () => {
    const r = mapEvaluationToVerdict(
      makeEvaluation('SIGNAL_PRESENT', { sentiment: 'bearish' }),
      makeStrategy('sentiment'),
    );
    expect(r?.verdict).toBe('SELL');
  });

  it('ambiguous combination returns null', () => {
    const r = mapEvaluationToVerdict(
      makeEvaluation('INDICATOR_THRESHOLD', { direction: 'above' }),
      makeStrategy('general'),
    );
    expect(r).toBeNull();
  });
});
