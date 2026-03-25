import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SignalArchive } from '../../src/signals/archive.js';
import { SignalIngestor } from '../../src/signals/ingestor.js';
import type { RawSignalInput } from '../../src/signals/ingestor.js';

function makeInput(overrides: Partial<RawSignalInput> = {}): RawSignalInput {
  return {
    sourceId: 'source-a',
    sourceName: 'Source A',
    sourceType: 'API',
    reliability: 0.8,
    title: 'Apple reports record quarterly earnings',
    publishedAt: '2026-03-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('SignalIngestor — source merge on duplicate content hash', () => {
  let dir: string;
  let archive: SignalArchive;
  let ingestor: SignalIngestor;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yojin-ingestor-merge-'));
    archive = new SignalArchive({ dir });
    ingestor = new SignalIngestor({ archive });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('same title+date from different sources produces one signal with both sources', async () => {
    await ingestor.ingest([makeInput({ sourceId: 'source-a', sourceName: 'Source A' })]);
    await ingestor.ingest([makeInput({ sourceId: 'source-b', sourceName: 'Source B' })]);

    const signals = await archive.query({});
    expect(signals).toHaveLength(1);
    expect(signals[0].sources).toHaveLength(2);
    const sourceIds = signals[0].sources.map((s) => s.id);
    expect(sourceIds).toContain('source-a');
    expect(sourceIds).toContain('source-b');
  });

  it('ingesting the same source twice does not create a duplicate source entry', async () => {
    await ingestor.ingest([makeInput({ sourceId: 'source-a' })]);
    await ingestor.ingest([makeInput({ sourceId: 'source-a' })]);

    const signals = await archive.query({});
    expect(signals).toHaveLength(1);
    expect(signals[0].sources).toHaveLength(1);
    expect(signals[0].sources[0].id).toBe('source-a');
  });

  it('different titles produce separate signals', async () => {
    await ingestor.ingest([
      makeInput({ title: 'Apple reports record quarterly earnings' }),
      makeInput({ title: 'Tesla cuts prices globally amid weak demand' }),
    ]);

    const signals = await archive.query({});
    expect(signals).toHaveLength(2);
  });

  it('hash is case-insensitive — mixed-case title deduplicates against lowercase', async () => {
    await ingestor.ingest([makeInput({ title: 'Apple Reports Record Quarterly Earnings' })]);
    // Same text, different casing
    await ingestor.ingest([makeInput({ sourceId: 'source-b', title: 'apple reports record quarterly earnings' })]);

    const signals = await archive.query({});
    expect(signals).toHaveLength(1);
    expect(signals[0].sources).toHaveLength(2);
  });

  it('merged signal has version bumped by 1', async () => {
    await ingestor.ingest([makeInput({ sourceId: 'source-a' })]);

    // Get original version
    const before = await archive.query({});
    expect(before[0].version).toBe(1);

    // Ingest from a second source — triggers merge
    const ingestor2 = new SignalIngestor({ archive });
    await ingestor2.ingest([makeInput({ sourceId: 'source-b', sourceName: 'Source B' })]);

    const after = await archive.query({});
    expect(after).toHaveLength(1);
    expect(after[0].version).toBe(2);
    expect(after[0].sources).toHaveLength(2);
  });

  it('same-batch duplicate from a second source merges into one signal', async () => {
    // Both items arrive in the same ingest() call
    const result = await ingestor.ingest([
      makeInput({ sourceId: 'source-a', sourceName: 'Source A' }),
      makeInput({ sourceId: 'source-b', sourceName: 'Source B' }),
    ]);

    // One ingested, one duplicate
    expect(result.ingested).toBe(1);
    expect(result.duplicates).toBe(1);

    const signals = await archive.query({});
    expect(signals).toHaveLength(1);
    expect(signals[0].sources).toHaveLength(2);
  });
});
