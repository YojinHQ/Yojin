import { beforeEach, describe, expect, it } from 'vitest';

import type { ActionStore } from '../../../../src/actions/action-store.js';
import type { Action } from '../../../../src/actions/types.js';
import { actionsResolver, setActionStore } from '../../../../src/api/graphql/resolvers/actions.js';

function makeAction(overrides: Partial<Action> = {}): Action {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? `a-${Math.random().toString(36).slice(2, 10)}`,
    strategyId: 'rsi-oversold',
    strategyName: 'RSI Oversold',
    triggerId: 'rsi-oversold-PRICE_MOVE-AAPL',
    triggerType: 'PRICE_MOVE',
    verdict: 'BUY',
    what: 'BUY AAPL — oversold bounce setup',
    why: 'RSI 24 + bullish divergence + support retest',
    tickers: ['AAPL'],
    triggerStrength: 'MODERATE',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now,
    ...overrides,
  };
}

function mockStore(actions: Action[]): ActionStore {
  return {
    query: async () => actions,
  } as unknown as ActionStore;
}

describe('actionsResolver low-signal filter', () => {
  beforeEach(() => {
    setActionStore(mockStore([]));
  });

  it('hides REVIEW verdicts by default', async () => {
    setActionStore(
      mockStore([
        makeAction({ id: 'buy', verdict: 'BUY', conviction: 'HIGH' }),
        makeAction({ id: 'rev', verdict: 'REVIEW', conviction: 'HIGH' }),
      ]),
    );
    const result = await actionsResolver(null, {});
    expect(result.map((a) => a.id)).toEqual(['buy']);
  });

  it('hides LOW conviction BUY/SELL by default', async () => {
    setActionStore(
      mockStore([
        makeAction({ id: 'high', verdict: 'BUY', conviction: 'HIGH' }),
        makeAction({ id: 'med', verdict: 'SELL', conviction: 'MEDIUM' }),
        makeAction({ id: 'low', verdict: 'BUY', conviction: 'LOW' }),
      ]),
    );
    const result = await actionsResolver(null, {});
    expect(result.map((a) => a.id).sort()).toEqual(['high', 'med']);
  });

  it('hides actions with severity below HIGH label threshold', async () => {
    setActionStore(
      mockStore([
        makeAction({ id: 'crit', verdict: 'BUY', severity: 0.8 }),
        makeAction({ id: 'high', verdict: 'BUY', severity: 0.4 }),
        makeAction({ id: 'weak', verdict: 'BUY', severity: 0.2 }),
      ]),
    );
    const result = await actionsResolver(null, {});
    expect(result.map((a) => a.id).sort()).toEqual(['crit', 'high']);
  });

  it('keeps actions with no conviction or severity set', async () => {
    setActionStore(mockStore([makeAction({ id: 'bare', verdict: 'BUY' })]));
    const result = await actionsResolver(null, {});
    expect(result.map((a) => a.id)).toEqual(['bare']);
  });

  it('returns all actions when includeLowSignal is true', async () => {
    setActionStore(
      mockStore([
        makeAction({ id: 'high', verdict: 'BUY', conviction: 'HIGH' }),
        makeAction({ id: 'rev', verdict: 'REVIEW' }),
        makeAction({ id: 'low', verdict: 'SELL', conviction: 'LOW' }),
        makeAction({ id: 'weak', verdict: 'BUY', severity: 0.1 }),
      ]),
    );
    const result = await actionsResolver(null, { includeLowSignal: true });
    expect(result.map((a) => a.id).sort()).toEqual(['high', 'low', 'rev', 'weak']);
  });
});
