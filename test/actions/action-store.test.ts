/**
 * ActionStore tests — the opinionated BUY/SELL lifecycle store fed by
 * Strategies/Strategies.
 *
 * Focus areas:
 * - PENDING -> APPROVED/REJECTED/EXPIRED transitions
 * - Supersede-on-triggerId: a fresh evaluation with the same triggerId must
 *   mark any existing PENDING record as EXPIRED with resolvedBy='superseded'.
 * - Dismiss (soft-hide) semantics
 * - Auto-expiry on read when expiresAt has passed
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActionStore } from '../../src/actions/action-store.js';
import type { Action } from '../../src/actions/types.js';

interface MakeActionOverrides {
  id?: string;
  strategyId?: string;
  triggerId?: string;
  ticker?: string;
  verdict?: Action['verdict'];
  expiresAt?: string;
  createdAt?: string;
}

function makeAction(overrides: MakeActionOverrides = {}): Action {
  const now = new Date().toISOString();
  const ticker = overrides.ticker ?? 'AAPL';
  return {
    id: overrides.id ?? `a-${Math.random().toString(36).slice(2, 10)}`,
    strategyId: overrides.strategyId ?? 'rsi-oversold',
    strategyName: 'RSI Oversold',
    triggerId: overrides.triggerId ?? `rsi-oversold-PRICE_MOVE-${ticker}`,
    triggerType: 'PRICE_MOVE',
    verdict: overrides.verdict ?? 'BUY',
    what: `BUY ${ticker} — oversold bounce setup`,
    why: 'RSI 24 + bullish divergence + support retest',
    tickers: [ticker],
    status: 'PENDING',
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: overrides.createdAt ?? now,
  };
}

describe('ActionStore.create', () => {
  let dir: string;
  let store: ActionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'action-store-create-'));
    store = new ActionStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists a valid action as PENDING', async () => {
    const action = makeAction();
    const res = await store.create(action);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.id).toBe(action.id);
    expect(res.data.status).toBe('PENDING');

    const found = await store.getById(action.id);
    expect(found?.id).toBe(action.id);
  });

  it('rejects an invalid action (missing strategyId)', async () => {
    const bad = { ...makeAction(), strategyId: '' } as Action;
    const res = await store.create(bad);
    expect(res.success).toBe(false);
  });

  it('supersedes an existing PENDING action with the same triggerId', async () => {
    const first = makeAction({ id: 'a-old', triggerId: 't-1' });
    const second = makeAction({ id: 'a-new', triggerId: 't-1' });

    await store.create(first);
    await store.create(second);

    const old = await store.getById('a-old');
    expect(old).not.toBeNull();
    expect(old?.status).toBe('EXPIRED');
    expect(old?.resolvedBy).toBe('superseded');
    expect(old?.resolvedAt).toBeDefined();

    const fresh = await store.getById('a-new');
    expect(fresh?.status).toBe('PENDING');

    const pending = await store.getPending();
    expect(pending.map((a) => a.id)).toEqual(['a-new']);
  });

  it('does not supersede actions with a different triggerId', async () => {
    await store.create(makeAction({ id: 'a-1', triggerId: 't-AAPL', ticker: 'AAPL' }));
    await store.create(makeAction({ id: 'a-2', triggerId: 't-NVDA', ticker: 'NVDA' }));

    const pending = await store.getPending();
    expect(new Set(pending.map((a) => a.id))).toEqual(new Set(['a-1', 'a-2']));
  });

  it('does not supersede already-resolved actions with the same triggerId', async () => {
    await store.create(makeAction({ id: 'a-1', triggerId: 't-1' }));
    await store.approve('a-1');
    await store.create(makeAction({ id: 'a-2', triggerId: 't-1' }));

    const approved = await store.getById('a-1');
    expect(approved?.status).toBe('APPROVED');
    expect(approved?.resolvedBy).toBe('user');

    const fresh = await store.getById('a-2');
    expect(fresh?.status).toBe('PENDING');
  });
});

describe('ActionStore.approve / reject', () => {
  let dir: string;
  let store: ActionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'action-store-resolve-'));
    store = new ActionStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('approves a pending action', async () => {
    await store.create(makeAction({ id: 'a-1' }));
    const res = await store.approve('a-1');
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.status).toBe('APPROVED');
    expect(res.data.resolvedBy).toBe('user');
    expect(res.data.resolvedAt).toBeDefined();
  });

  it('rejects a pending action', async () => {
    await store.create(makeAction({ id: 'a-1' }));
    const res = await store.reject('a-1');
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.status).toBe('REJECTED');
    expect(res.data.resolvedBy).toBe('user');
  });

  it('refuses to approve an already-approved action', async () => {
    await store.create(makeAction({ id: 'a-1' }));
    await store.approve('a-1');
    const res = await store.approve('a-1');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain('APPROVED');
  });

  it('refuses to approve a non-existent action', async () => {
    const res = await store.approve('does-not-exist');
    expect(res.success).toBe(false);
  });

  it('auto-expires on approve if expiresAt has passed', async () => {
    await store.create(
      makeAction({
        id: 'a-1',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );
    const res = await store.approve('a-1');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain('expired');

    const found = await store.getById('a-1');
    expect(found?.status).toBe('EXPIRED');
    expect(found?.resolvedBy).toBe('timeout');
  });
});

describe('ActionStore.dismiss', () => {
  let dir: string;
  let store: ActionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'action-store-dismiss-'));
    store = new ActionStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('sets dismissedAt on a pending action', async () => {
    await store.create(makeAction({ id: 'a-1' }));
    const res = await store.dismiss('a-1');
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.dismissedAt).toBeDefined();
    expect(res.data.status).toBe('PENDING'); // dismiss is soft-hide, not resolve
  });

  it('refuses to dismiss an already-dismissed action', async () => {
    await store.create(makeAction({ id: 'a-1' }));
    await store.dismiss('a-1');
    const res = await store.dismiss('a-1');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain('already dismissed');
  });

  it('excludes dismissed actions from getPending', async () => {
    await store.create(makeAction({ id: 'a-1' }));
    await store.create(makeAction({ id: 'a-2', triggerId: 't-2' }));
    await store.dismiss('a-1');

    const pending = await store.getPending();
    expect(pending.map((a) => a.id)).toEqual(['a-2']);
  });

  it('includes dismissed actions when query({ dismissed: true })', async () => {
    await store.create(makeAction({ id: 'a-1' }));
    await store.dismiss('a-1');

    const dismissed = await store.query({ dismissed: true });
    expect(dismissed.map((a) => a.id)).toEqual(['a-1']);
  });
});

describe('ActionStore.getPending', () => {
  let dir: string;
  let store: ActionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'action-store-pending-'));
    store = new ActionStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns only PENDING, non-dismissed, non-expired actions', async () => {
    await store.create(makeAction({ id: 'a-pending', triggerId: 't-1', ticker: 'AAPL' }));
    await store.create(makeAction({ id: 'a-approved', triggerId: 't-2', ticker: 'NVDA' }));
    await store.approve('a-approved');
    await store.create(
      makeAction({
        id: 'a-expired',
        triggerId: 't-3',
        ticker: 'GOOG',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    const pending = await store.getPending();
    expect(pending.map((a) => a.id)).toEqual(['a-pending']);
  });
});

describe('ActionStore.query', () => {
  let dir: string;
  let store: ActionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'action-store-query-'));
    store = new ActionStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('filters by status', async () => {
    await store.create(makeAction({ id: 'a-1', triggerId: 't-1', ticker: 'AAPL' }));
    await store.create(makeAction({ id: 'a-2', triggerId: 't-2', ticker: 'NVDA' }));
    await store.approve('a-2');

    const pending = await store.query({ status: 'PENDING' });
    expect(pending.map((a) => a.id)).toEqual(['a-1']);

    const approved = await store.query({ status: 'APPROVED' });
    expect(approved.map((a) => a.id)).toEqual(['a-2']);
  });

  it('honours limit', async () => {
    for (let i = 0; i < 5; i++) {
      await store.create(makeAction({ id: `a-${i}`, triggerId: `t-${i}` }));
    }
    const results = await store.query({ limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('reports actions past expiresAt as EXPIRED without mutating the source record', async () => {
    await store.create(
      makeAction({
        id: 'a-1',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    const expired = await store.query({ status: 'EXPIRED' });
    expect(expired.map((a) => a.id)).toEqual(['a-1']);
    expect(expired[0].status).toBe('EXPIRED');
  });
});
