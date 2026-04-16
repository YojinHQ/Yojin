/**
 * Cross-strategy ticker tests — when two strategies fire for the same ticker,
 * both actions stay PENDING. The user decides which to act on.
 *
 * triggerId-based supersede still works: when the SAME strategy re-fires for
 * the same trigger, the old PENDING record is expired and replaced.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActionStore } from '../../src/actions/action-store.js';
import type { Action } from '../../src/actions/types.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeAction(overrides: Partial<Action> & { ticker?: string } = {}): Action {
  const now = new Date().toISOString();
  const ticker = overrides.ticker ?? overrides.tickers?.[0] ?? 'AAPL';
  const { ticker: _tick, ...rest } = overrides;
  return {
    id: randomUUID(),
    strategyId: 'strat-default',
    strategyName: 'Default Strategy',
    triggerId: `strat-default-PRICE_MOVE-${ticker}`,
    triggerType: 'PRICE_MOVE',
    verdict: 'BUY',
    what: `BUY ${ticker} — test action`,
    why: 'Test reasoning',
    tickers: [ticker],
    riskContext: 'test context',
    triggerStrength: 'MODERATE' as const,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now,
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActionStore — cross-strategy and supersede behavior', () => {
  let dir: string;
  let store: ActionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'action-dedup-'));
    store = new ActionStore({ dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('different strategies for the same ticker both stay PENDING', async () => {
    const buyAction = makeAction({
      id: randomUUID(),
      strategyId: 'strat-momentum',
      strategyName: 'Momentum Breakout',
      triggerId: 'strat-momentum-PRICE_MOVE-AAPL',
      verdict: 'BUY',
      triggerStrength: 'MODERATE' as const,
      ticker: 'AAPL',
    });
    const sellAction = makeAction({
      id: randomUUID(),
      strategyId: 'strat-risk',
      strategyName: 'Risk Rebalance',
      triggerId: 'strat-risk-CONCENTRATION-AAPL',
      verdict: 'SELL',
      triggerStrength: 'STRONG' as const,
      ticker: 'AAPL',
    });

    await store.create(buyAction);
    await store.create(sellAction);

    const pending = await store.getPending();
    expect(pending).toHaveLength(2);
    const ids = new Set(pending.map((a) => a.id));
    expect(ids).toContain(buyAction.id);
    expect(ids).toContain(sellAction.id);
  });

  it('different tickers both stay PENDING', async () => {
    const buyAAPL = makeAction({
      id: randomUUID(),
      strategyId: 'strat-momentum',
      triggerId: 'strat-momentum-PRICE_MOVE-AAPL',
      verdict: 'BUY',
      triggerStrength: 'STRONG' as const,
      ticker: 'AAPL',
    });
    const sellGOOG = makeAction({
      id: randomUUID(),
      strategyId: 'strat-risk',
      triggerId: 'strat-risk-CONCENTRATION-GOOG',
      verdict: 'SELL',
      triggerStrength: 'MODERATE' as const,
      ticker: 'GOOG',
    });

    await store.create(buyAAPL);
    await store.create(sellGOOG);

    const pending = await store.getPending();
    expect(pending).toHaveLength(2);
    const ids = new Set(pending.map((a) => a.id));
    expect(ids).toContain(buyAAPL.id);
    expect(ids).toContain(sellGOOG.id);
  });

  it('triggerId supersede replaces stale PENDING from same strategy+trigger', async () => {
    const triggerId = 'strat-momentum-PRICE_MOVE-AAPL';
    const oldAction = makeAction({
      id: randomUUID(),
      strategyId: 'strat-momentum',
      strategyName: 'Momentum Breakout',
      triggerId,
      verdict: 'BUY',
      triggerStrength: 'STRONG' as const,
      ticker: 'AAPL',
    });
    const freshAction = makeAction({
      id: randomUUID(),
      strategyId: 'strat-momentum',
      strategyName: 'Momentum Breakout',
      triggerId,
      verdict: 'BUY',
      triggerStrength: 'STRONG' as const,
      ticker: 'AAPL',
    });

    await store.create(oldAction);
    await store.create(freshAction);

    const pending = await store.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(freshAction.id);

    const old = await store.getById(oldAction.id);
    expect(old?.status).toBe('EXPIRED');
    expect(old?.resolvedBy).toBe('superseded');
  });
});
