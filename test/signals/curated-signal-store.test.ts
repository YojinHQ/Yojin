import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CuratedSignalStore } from '../../src/signals/curation/curated-signal-store.js';
import type { CuratedSignal } from '../../src/signals/curation/types.js';
import type { Signal } from '../../src/signals/types.js';

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig-001',
    contentHash: 'hash-001',
    type: 'NEWS',
    title: 'Test Signal',
    assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }],
    sources: [{ id: 'test-source', name: 'Test', type: 'API', reliability: 0.9 }],
    publishedAt: '2026-03-21T10:00:00.000Z',
    ingestedAt: '2026-03-21T10:01:00.000Z',
    confidence: 0.85,
    outputType: 'INSIGHT',
    version: 1,
    ...overrides,
  };
}

function makeCurated(overrides: Partial<CuratedSignal> = {}): CuratedSignal {
  return {
    signal: makeSignal(),
    scores: [
      {
        signalId: 'sig-001',
        ticker: 'AAPL',
        exposureWeight: 0.3,
        typeRelevance: 0.7,
        compositeScore: 0.65,
      },
    ],
    curatedAt: '2026-03-21T12:00:00.000Z',
    ...overrides,
  };
}

describe('CuratedSignalStore', () => {
  let dataRoot: string;
  let store: CuratedSignalStore;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'yojin-curated-'));
    store = new CuratedSignalStore(dataRoot);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('writes and reads curated signals', async () => {
    const cs = makeCurated();
    await store.writeBatch([cs]);

    const results = await store.queryByTickers(['AAPL']);
    expect(results).toHaveLength(1);
    expect(results[0].signal.id).toBe('sig-001');
    expect(results[0].scores[0].compositeScore).toBe(0.65);
  });

  it('handles empty batch', async () => {
    await store.writeBatch([]);
    const results = await store.queryByTickers(['AAPL']);
    expect(results).toHaveLength(0);
  });

  it('filters by ticker', async () => {
    await store.writeBatch([
      makeCurated({
        signal: makeSignal({ id: 's1', contentHash: 'h1' }),
        scores: [{ signalId: 's1', ticker: 'AAPL', exposureWeight: 0.3, typeRelevance: 0.7, compositeScore: 0.6 }],
      }),
      makeCurated({
        signal: makeSignal({
          id: 's2',
          contentHash: 'h2',
          assets: [{ ticker: 'MSFT', relevance: 0.8, linkType: 'DIRECT' }],
        }),
        scores: [{ signalId: 's2', ticker: 'MSFT', exposureWeight: 0.2, typeRelevance: 0.6, compositeScore: 0.5 }],
      }),
    ]);

    const aapl = await store.queryByTickers(['AAPL']);
    expect(aapl).toHaveLength(1);
    expect(aapl[0].signal.id).toBe('s1');

    const msft = await store.queryByTickers(['MSFT']);
    expect(msft).toHaveLength(1);
    expect(msft[0].signal.id).toBe('s2');
  });

  it('respects since filter', async () => {
    await store.writeBatch([makeCurated({ curatedAt: '2026-03-20T10:00:00.000Z' })]);

    const before = await store.queryByTickers(['AAPL'], { since: '2026-03-21' });
    expect(before).toHaveLength(0);

    const after = await store.queryByTickers(['AAPL'], { since: '2026-03-20' });
    expect(after).toHaveLength(1);
  });

  it('persists and reads watermark', async () => {
    expect(await store.getLatestWatermark()).toBeNull();

    const watermark = {
      lastRunAt: '2026-03-21T12:00:00.000Z',
      lastSignalIngestedAt: '2026-03-21T11:00:00.000Z',
      signalsProcessed: 50,
      signalsCurated: 20,
    };
    await store.saveWatermark(watermark);

    const loaded = await store.getLatestWatermark();
    expect(loaded).toEqual(watermark);
  });

  it('respects limit', async () => {
    const batch = Array.from({ length: 10 }, (_, i) =>
      makeCurated({
        signal: makeSignal({ id: `s${i}`, contentHash: `h${i}` }),
        scores: [{ signalId: `s${i}`, ticker: 'AAPL', exposureWeight: 0.1, typeRelevance: 0.5, compositeScore: 0.4 }],
      }),
    );
    await store.writeBatch(batch);

    const limited = await store.queryByTickers(['AAPL'], { limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it('returns empty for nonexistent ticker', async () => {
    await store.writeBatch([makeCurated()]);
    const results = await store.queryByTickers(['TSLA']);
    expect(results).toHaveLength(0);
  });
});
