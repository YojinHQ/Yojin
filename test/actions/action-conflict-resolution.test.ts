/**
 * Conflict resolution tests — effective score + cross-strategy ticker conflicts.
 *
 * When two strategies fire for the same ticker with different verdicts, the one
 * with the higher effective score wins. Defensive verdicts (TRIM, SELL) receive
 * a +0.3 boost, implementing a "risk-first" bias.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActionStore } from '../../src/actions/action-store.js';
import type { Action } from '../../src/actions/types.js';
import { effectiveScore, parseConfidenceFromResponse } from '../../src/actions/types.js';

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
    confidence: 0.5,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now,
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// effectiveScore
// ---------------------------------------------------------------------------

describe('effectiveScore', () => {
  it('returns confidence unchanged for offensive verdicts', () => {
    expect(effectiveScore(0.7, 'BUY')).toBe(0.7);
    expect(effectiveScore(0.8, 'HOLD')).toBe(0.8);
    expect(effectiveScore(0.5, 'REVIEW')).toBe(0.5);
  });

  it('adds 0.3 risk boost for defensive verdicts', () => {
    expect(effectiveScore(0.6, 'TRIM')).toBeCloseTo(0.9);
    expect(effectiveScore(0.6, 'SELL')).toBeCloseTo(0.9);
  });

  it('high-confidence BUY (0.95) beats low-confidence TRIM (0.3 + 0.3 = 0.6)', () => {
    expect(effectiveScore(0.95, 'BUY')).toBeGreaterThan(effectiveScore(0.3, 'TRIM'));
  });

  it('normal BUY (0.7) loses to normal TRIM (0.6 + 0.3 = 0.9)', () => {
    expect(effectiveScore(0.7, 'BUY')).toBeLessThan(effectiveScore(0.6, 'TRIM'));
  });
});

// ---------------------------------------------------------------------------
// parseConfidenceFromResponse
// ---------------------------------------------------------------------------

describe('parseConfidenceFromResponse', () => {
  it('parses confidence from LLM response', () => {
    expect(parseConfidenceFromResponse('ACTION: BUY AAPL — reason\nCONFIDENCE: 0.85\nAnalysis...')).toBe(0.85);
  });

  it('returns 0.5 when confidence line is missing', () => {
    expect(parseConfidenceFromResponse('ACTION: BUY AAPL — reason\nAnalysis...')).toBe(0.5);
  });

  it('clamps values above 1', () => {
    expect(parseConfidenceFromResponse('CONFIDENCE: 1.2')).toBe(1.0);
  });

  it('clamps values below 0', () => {
    expect(parseConfidenceFromResponse('CONFIDENCE: -0.3')).toBe(0.0);
  });

  it('returns 0.5 for NaN', () => {
    expect(parseConfidenceFromResponse('CONFIDENCE: very high')).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// ActionStore conflict resolution
// ---------------------------------------------------------------------------

describe('ActionStore conflict resolution', () => {
  let dir: string;
  let store: ActionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'action-conflict-'));
    store = new ActionStore({ dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('new action with higher effective score expires existing same-ticker action', async () => {
    const buyAction = makeAction({
      id: randomUUID(),
      strategyId: 'strat-momentum',
      strategyName: 'Momentum Breakout',
      triggerId: 'strat-momentum-PRICE_MOVE-AAPL',
      verdict: 'BUY',
      confidence: 0.7,
      ticker: 'AAPL',
    });
    const trimAction = makeAction({
      id: randomUUID(),
      strategyId: 'strat-risk',
      strategyName: 'Risk Rebalance',
      triggerId: 'strat-risk-CONCENTRATION-AAPL',
      verdict: 'TRIM',
      confidence: 0.6,
      ticker: 'AAPL',
    });

    await store.create(buyAction);
    await store.create(trimAction);

    const pending = await store.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(trimAction.id);
    expect(pending[0].verdict).toBe('TRIM');

    const expiredBuy = await store.getById(buyAction.id);
    expect(expiredBuy?.status).toBe('EXPIRED');
    expect(expiredBuy?.resolvedBy).toBe('conflict');
  });

  it('new action with lower effective score is immediately expired', async () => {
    const trimAction = makeAction({
      id: randomUUID(),
      strategyId: 'strat-risk',
      strategyName: 'Risk Rebalance',
      triggerId: 'strat-risk-CONCENTRATION-AAPL',
      verdict: 'TRIM',
      confidence: 0.6,
      ticker: 'AAPL',
    });
    const buyAction = makeAction({
      id: randomUUID(),
      strategyId: 'strat-momentum',
      strategyName: 'Momentum Breakout',
      triggerId: 'strat-momentum-PRICE_MOVE-AAPL',
      verdict: 'BUY',
      confidence: 0.7,
      ticker: 'AAPL',
    });

    await store.create(trimAction);
    await store.create(buyAction);

    const pending = await store.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(trimAction.id);
    expect(pending[0].verdict).toBe('TRIM');

    const expiredBuy = await store.getById(buyAction.id);
    expect(expiredBuy?.status).toBe('EXPIRED');
    expect(expiredBuy?.resolvedBy).toBe('conflict');
  });

  it('does not conflict-resolve actions for different tickers', async () => {
    const buyAAPL = makeAction({
      id: randomUUID(),
      strategyId: 'strat-momentum',
      triggerId: 'strat-momentum-PRICE_MOVE-AAPL',
      verdict: 'BUY',
      confidence: 0.7,
      ticker: 'AAPL',
    });
    const trimGOOG = makeAction({
      id: randomUUID(),
      strategyId: 'strat-risk',
      triggerId: 'strat-risk-CONCENTRATION-GOOG',
      verdict: 'TRIM',
      confidence: 0.6,
      ticker: 'GOOG',
    });

    await store.create(buyAAPL);
    await store.create(trimGOOG);

    const pending = await store.getPending();
    expect(pending).toHaveLength(2);
    const ids = new Set(pending.map((a) => a.id));
    expect(ids).toContain(buyAAPL.id);
    expect(ids).toContain(trimGOOG.id);
  });

  it('triggerId supersede still works alongside ticker conflict resolution', async () => {
    const triggerId = 'strat-momentum-PRICE_MOVE-AAPL';
    const oldAction = makeAction({
      id: randomUUID(),
      strategyId: 'strat-momentum',
      strategyName: 'Momentum Breakout',
      triggerId,
      verdict: 'BUY',
      confidence: 0.7,
      ticker: 'AAPL',
    });
    const freshAction = makeAction({
      id: randomUUID(),
      strategyId: 'strat-momentum',
      strategyName: 'Momentum Breakout',
      triggerId,
      verdict: 'BUY',
      confidence: 0.7,
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
