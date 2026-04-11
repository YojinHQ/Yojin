/**
 * SummaryStore tests — the neutral-intel store used by macro + micro flows.
 *
 * Summaries are read-only: no approve/reject/dismiss lifecycle, no supersede.
 * The only non-trivial behaviour is content-hash dedup within a rolling window,
 * which is what lets both pipelines write the same observation without
 * double-firing the Intel Feed.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SummaryStore } from '../../src/summaries/summary-store.js';
import { type Summary, type SummaryFlow, computeSummaryContentHash } from '../../src/summaries/types.js';

interface MakeSummaryOverrides {
  id?: string;
  ticker?: string;
  what?: string;
  flow?: SummaryFlow;
  severity?: number;
  createdAt?: string;
}

function makeSummary(overrides: MakeSummaryOverrides = {}): Summary {
  const ticker = overrides.ticker ?? 'AAPL';
  const flow = overrides.flow ?? 'MICRO';
  const what = overrides.what ?? 'Truist cuts AAPL PT to $323';
  return {
    id: overrides.id ?? `s-${Math.random().toString(36).slice(2, 10)}`,
    ticker,
    what,
    flow,
    severity: overrides.severity ?? 0.5,
    sourceSignalIds: [],
    contentHash: computeSummaryContentHash(ticker, flow, what),
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

describe('SummaryStore.create — content-hash dedup', () => {
  let dir: string;
  let store: SummaryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'summary-store-test-'));
    store = new SummaryStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists a fresh summary and returns it', async () => {
    const summary = makeSummary();
    const result = await store.create(summary);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe(summary.id);

    const all = await store.query({});
    expect(all).toHaveLength(1);
    expect(all[0].what).toBe(summary.what);
  });

  it('dedupes a second summary with the same contentHash inside the window', async () => {
    const first = makeSummary({ id: 's-1' });
    const second = makeSummary({ id: 's-2', what: first.what });

    await store.create(first);
    const dup = await store.create(second);

    expect(dup.success).toBe(true);
    if (!dup.success) return;
    // The winner is the original record, not the new one.
    expect(dup.data.id).toBe('s-1');

    const all = await store.query({});
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('s-1');
  });

  it('normalises whitespace/case when computing contentHash', async () => {
    const first = makeSummary({ id: 's-1', what: 'Truist cuts AAPL PT to $323' });
    const second = makeSummary({
      id: 's-2',
      what: '  TRUIST   cuts AAPL PT to $323  ',
    });

    await store.create(first);
    const dup = await store.create(second);

    expect(dup.success).toBe(true);
    if (!dup.success) return;
    expect(dup.data.id).toBe('s-1');
  });

  it('different flows hash differently — macro and micro can coexist', async () => {
    const micro = makeSummary({ id: 's-micro', flow: 'MICRO' });
    const macro = makeSummary({ id: 's-macro', flow: 'MACRO' });

    await store.create(micro);
    const res = await store.create(macro);

    expect(res.success).toBe(true);
    const all = await store.query({});
    expect(all).toHaveLength(2);
    expect(new Set(all.map((s) => s.flow))).toEqual(new Set(['MICRO', 'MACRO']));
  });

  it('allows the same observation once the dedup window has elapsed', async () => {
    const shortWindowStore = new SummaryStore({ dir, dedupWindowMs: 100 });
    const first = makeSummary({
      id: 's-old',
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
    await shortWindowStore.create(first);

    // New summary with the same content but created after the window closes.
    const second = makeSummary({ id: 's-new' });
    const res = await shortWindowStore.create(second);

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.id).toBe('s-new');

    const all = await shortWindowStore.query({});
    expect(all.map((s) => s.id).sort()).toEqual(['s-new', 's-old']);
  });

  it('rejects a malformed payload (invalid schema)', async () => {
    const bad = { ...makeSummary(), what: '' } as Summary;
    const res = await store.create(bad);
    expect(res.success).toBe(false);
  });
});

describe('SummaryStore.create — Strategy-layer boundary', () => {
  let dir: string;
  let store: SummaryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'summary-store-boundary-'));
    store = new SummaryStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a record carrying skillId', async () => {
    const tainted = { ...makeSummary(), skillId: 'skill-123' } as unknown as Summary;
    const res = await store.create(tainted);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain('skillId');
    expect(res.error).toContain('ActionStore');

    const all = await store.query({});
    expect(all).toHaveLength(0);
  });

  it('rejects a record carrying strategyId', async () => {
    const tainted = { ...makeSummary(), strategyId: 'strat-abc' } as unknown as Summary;
    const res = await store.create(tainted);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain('strategyId');
  });

  it('rejects a record carrying triggerId', async () => {
    const tainted = { ...makeSummary(), triggerId: 'trig-xyz' } as unknown as Summary;
    const res = await store.create(tainted);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain('triggerId');
  });

  it('accepts a clean Summary (regression guard)', async () => {
    const clean = makeSummary();
    const res = await store.create(clean);
    expect(res.success).toBe(true);
  });
});

describe('SummaryStore.query', () => {
  let dir: string;
  let store: SummaryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'summary-store-query-'));
    store = new SummaryStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('filters by ticker (case-insensitive)', async () => {
    await store.create(makeSummary({ id: 's-1', ticker: 'AAPL', what: 'AAPL beats earnings' }));
    await store.create(makeSummary({ id: 's-2', ticker: 'NVDA', what: 'NVDA datacenter demand surge' }));

    const results = await store.query({ ticker: 'aapl' });
    expect(results.map((s) => s.id)).toEqual(['s-1']);
  });

  it('filters by flow', async () => {
    await store.create(makeSummary({ id: 's-micro', flow: 'MICRO', what: 'micro note' }));
    await store.create(makeSummary({ id: 's-macro', flow: 'MACRO', what: 'macro note' }));

    const micro = await store.query({ flow: 'MICRO' });
    expect(micro.map((s) => s.id)).toEqual(['s-micro']);

    const macro = await store.query({ flow: 'MACRO' });
    expect(macro.map((s) => s.id)).toEqual(['s-macro']);
  });

  it('honours limit', async () => {
    for (let i = 0; i < 5; i++) {
      await store.create(makeSummary({ id: `s-${i}`, what: `note ${i}` }));
    }
    const results = await store.query({ limit: 3 });
    expect(results).toHaveLength(3);
  });
});

describe('SummaryStore.getById', () => {
  let dir: string;
  let store: SummaryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'summary-store-byid-'));
    store = new SummaryStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the matching summary', async () => {
    const summary = makeSummary({ id: 's-target' });
    await store.create(summary);
    const found = await store.getById('s-target');
    expect(found?.id).toBe('s-target');
  });

  it('returns null for an unknown id', async () => {
    const found = await store.getById('does-not-exist');
    expect(found).toBeNull();
  });
});
