import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SignalArchive } from '../../src/signals/archive.js';
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
    ...overrides,
  };
}

describe('SignalArchive', () => {
  let dir: string;
  let archive: SignalArchive;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yojin-signals-'));
    archive = new SignalArchive({ dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends and queries a single signal', async () => {
    await archive.append(makeSignal());
    const results = await archive.query({});
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('sig-001');
  });

  it('appends batch of signals', async () => {
    await archive.appendBatch([
      makeSignal({ id: 's1', contentHash: 'h1' }),
      makeSignal({ id: 's2', contentHash: 'h2' }),
      makeSignal({ id: 's3', contentHash: 'h3' }),
    ]);
    const results = await archive.query({});
    expect(results).toHaveLength(3);
  });

  it('handles empty batch gracefully', async () => {
    await archive.appendBatch([]);
    const results = await archive.query({});
    expect(results).toHaveLength(0);
  });

  it('partitions signals by date', async () => {
    await archive.appendBatch([
      makeSignal({ id: 's1', publishedAt: '2026-03-20T12:00:00.000Z' }),
      makeSignal({ id: 's2', publishedAt: '2026-03-21T12:00:00.000Z' }),
    ]);
    const dates = await archive.listDates();
    expect(dates).toEqual(['2026-03-20', '2026-03-21']);
  });

  it('filters by signal type', async () => {
    await archive.appendBatch([
      makeSignal({ id: 's1', type: 'NEWS' }),
      makeSignal({ id: 's2', type: 'MACRO' }),
      makeSignal({ id: 's3', type: 'NEWS' }),
    ]);
    const results = await archive.query({ type: 'NEWS' });
    expect(results).toHaveLength(2);
  });

  it('filters by ticker', async () => {
    await archive.appendBatch([
      makeSignal({ id: 's1', assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }] }),
      makeSignal({ id: 's2', assets: [{ ticker: 'TSLA', relevance: 0.8, linkType: 'DIRECT' }] }),
      makeSignal({
        id: 's3',
        assets: [
          { ticker: 'AAPL', relevance: 0.5, linkType: 'INDIRECT' },
          { ticker: 'MSFT', relevance: 0.7, linkType: 'DIRECT' },
        ],
      }),
    ]);
    const results = await archive.query({ ticker: 'AAPL' });
    expect(results).toHaveLength(2);
  });

  it('filters by source ID', async () => {
    await archive.appendBatch([
      makeSignal({ id: 's1', sources: [{ id: 'exa', name: 'Exa', type: 'API', reliability: 0.9 }] }),
      makeSignal({ id: 's2', sources: [{ id: 'firecrawl', name: 'Firecrawl', type: 'SCRAPER', reliability: 0.8 }] }),
    ]);
    const results = await archive.query({ sourceId: 'exa' });
    expect(results).toHaveLength(1);
    expect(results[0].sources[0].id).toBe('exa');
  });

  it('filters by date range', async () => {
    await archive.appendBatch([
      makeSignal({ id: 's1', publishedAt: '2026-03-19T12:00:00.000Z' }),
      makeSignal({ id: 's2', publishedAt: '2026-03-20T12:00:00.000Z' }),
      makeSignal({ id: 's3', publishedAt: '2026-03-21T12:00:00.000Z' }),
    ]);
    const results = await archive.query({
      since: '2026-03-20T00:00:00.000Z',
      until: '2026-03-20T23:59:59.000Z',
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('s2');
  });

  it('filters by date range with plain date strings (boundary inclusive)', async () => {
    await archive.appendBatch([
      makeSignal({ id: 's1', publishedAt: '2026-03-19T12:00:00.000Z' }),
      makeSignal({ id: 's2', publishedAt: '2026-03-20T12:00:00.000Z' }),
      makeSignal({ id: 's3', publishedAt: '2026-03-21T12:00:00.000Z' }),
    ]);
    const results = await archive.query({ since: '2026-03-20', until: '2026-03-20' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('s2');
  });

  it('finds a signal by id filter', async () => {
    await archive.appendBatch([makeSignal({ id: 's1' }), makeSignal({ id: 's2' }), makeSignal({ id: 's3' })]);
    const results = await archive.query({ id: 's2', limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('s2');
  });

  it('filters by search text (case-insensitive)', async () => {
    await archive.appendBatch([
      makeSignal({ id: 's1', title: 'Fed holds rates steady' }),
      makeSignal({ id: 's2', title: 'Apple reports record earnings' }),
    ]);
    const results = await archive.query({ search: 'apple' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('s2');
  });

  it('respects limit parameter', async () => {
    await archive.appendBatch([makeSignal({ id: 's1' }), makeSignal({ id: 's2' }), makeSignal({ id: 's3' })]);
    const results = await archive.query({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('loads all content hashes for dedup', async () => {
    await archive.appendBatch([
      makeSignal({ id: 's-hash-a', contentHash: 'hash-a' }),
      makeSignal({ id: 's-hash-b', contentHash: 'hash-b' }),
    ]);
    const hashes = await archive.loadContentHashes();
    expect(hashes.size).toBe(2);
    expect(hashes.has('hash-a')).toBe(true);
    expect(hashes.has('hash-b')).toBe(true);
  });

  it('filters by tickers array (matches any)', async () => {
    await archive.appendBatch([
      makeSignal({ id: 's1', assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }] }),
      makeSignal({ id: 's2', assets: [{ ticker: 'TSLA', relevance: 0.8, linkType: 'DIRECT' }] }),
      makeSignal({ id: 's3', assets: [{ ticker: 'MSFT', relevance: 0.7, linkType: 'DIRECT' }] }),
      makeSignal({ id: 's4', assets: [{ ticker: 'GOOG', relevance: 0.6, linkType: 'DIRECT' }] }),
    ]);
    const results = await archive.query({ tickers: ['AAPL', 'MSFT'] });
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(['s1', 's3']);
  });

  it('tickers filter takes precedence over single ticker', async () => {
    await archive.appendBatch([
      makeSignal({ id: 's1', assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }] }),
      makeSignal({ id: 's2', assets: [{ ticker: 'TSLA', relevance: 0.8, linkType: 'DIRECT' }] }),
    ]);
    // tickers should take precedence — ticker='AAPL' is ignored
    const results = await archive.query({ ticker: 'AAPL', tickers: ['TSLA'] });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('s2');
  });

  it('returns empty results for empty archive', async () => {
    expect(await archive.query({})).toHaveLength(0);
    expect(await archive.listDates()).toHaveLength(0);
    expect((await archive.loadContentHashes()).size).toBe(0);
  });
});
