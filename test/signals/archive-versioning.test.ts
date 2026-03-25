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
    outputType: 'INSIGHT',
    version: 1,
    ...overrides,
  };
}

describe('SignalArchive — versioning', () => {
  let dir: string;
  let archive: SignalArchive;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yojin-archive-versioning-'));
    archive = new SignalArchive({ dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('appendUpdate', () => {
    it('writes the updated signal so getById returns the latest version', async () => {
      const v1 = makeSignal({ id: 'sig-a', version: 1, title: 'Original title' });
      const v2 = makeSignal({ id: 'sig-a', version: 2, title: 'Updated title' });

      await archive.append(v1);
      await archive.appendUpdate(v2);

      const result = await archive.getById('sig-a');
      expect(result).not.toBeNull();
      expect(result!.version).toBe(2);
      expect(result!.title).toBe('Updated title');
    });

    it('works for a fresh signal (no prior append)', async () => {
      const signal = makeSignal({ id: 'sig-b', version: 1 });
      await archive.appendUpdate(signal);

      const result = await archive.getById('sig-b');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('sig-b');
    });
  });

  describe('query — deduplication by version', () => {
    it('returns only the highest-versioned entry when same ID appears multiple times', async () => {
      await archive.append(makeSignal({ id: 'sig-x', version: 1, title: 'v1' }));
      await archive.appendUpdate(makeSignal({ id: 'sig-x', version: 2, title: 'v2' }));
      await archive.appendUpdate(makeSignal({ id: 'sig-x', version: 3, title: 'v3' }));

      const results = await archive.query({});
      const sigX = results.filter((s) => s.id === 'sig-x');
      expect(sigX).toHaveLength(1);
      expect(sigX[0].version).toBe(3);
      expect(sigX[0].title).toBe('v3');
    });

    it('handles multiple distinct IDs each with multiple versions correctly', async () => {
      await archive.appendBatch([
        makeSignal({ id: 'a', contentHash: 'ha1', version: 1 }),
        makeSignal({ id: 'b', contentHash: 'hb1', version: 1 }),
      ]);
      await archive.appendUpdate(makeSignal({ id: 'a', contentHash: 'ha2', version: 2 }));
      await archive.appendUpdate(makeSignal({ id: 'b', contentHash: 'hb2', version: 2 }));

      const results = await archive.query({});
      expect(results).toHaveLength(2);
      const byId = Object.fromEntries(results.map((s) => [s.id, s]));
      expect(byId['a'].version).toBe(2);
      expect(byId['b'].version).toBe(2);
    });

    it('returns signals without version field as version 1 (Zod default)', async () => {
      // Simulate a signal stored without a version field (legacy data)
      const { version: _omit, ...withoutVersion } = makeSignal({ id: 'legacy' });
      void _omit;
      // Write raw JSON without version so Zod default kicks in on parse
      const { appendFile, mkdir } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, '2026-03-21.jsonl'), JSON.stringify(withoutVersion) + '\n');

      const v2 = makeSignal({ id: 'legacy', version: 2, title: 'Updated' });
      await archive.appendUpdate(v2);

      const results = await archive.query({});
      const legacy = results.find((s) => s.id === 'legacy');
      expect(legacy).toBeDefined();
      expect(legacy!.version).toBe(2);
    });
  });

  describe('loadContentHashes — uses deduplicated signals', () => {
    it('returns only content hashes from the highest-versioned entries', async () => {
      // v1 has hash-old; v2 replaces it with hash-new
      await archive.append(makeSignal({ id: 'sig-y', contentHash: 'hash-old', version: 1 }));
      await archive.appendUpdate(makeSignal({ id: 'sig-y', contentHash: 'hash-new', version: 2 }));

      const hashes = await archive.loadContentHashes();
      expect(hashes.has('hash-new')).toBe(true);
      // hash-old should NOT appear because v1 was superseded by v2
      expect(hashes.has('hash-old')).toBe(false);
    });

    it('includes hashes from all distinct IDs at their latest versions', async () => {
      await archive.appendBatch([
        makeSignal({ id: 'p', contentHash: 'hp1', version: 1 }),
        makeSignal({ id: 'q', contentHash: 'hq1', version: 1 }),
      ]);
      await archive.appendUpdate(makeSignal({ id: 'p', contentHash: 'hp2', version: 2 }));

      const hashes = await archive.loadContentHashes();
      expect(hashes.has('hp2')).toBe(true);
      expect(hashes.has('hq1')).toBe(true);
      expect(hashes.has('hp1')).toBe(false);
    });
  });

  describe('multiple versions of same ID in same file', () => {
    it('returns only the latest version when all entries are in a single JSONL file', async () => {
      // All three writes land in the same date partition file
      const publishedAt = '2026-03-21T10:00:00.000Z';
      await archive.append(makeSignal({ id: 'same-file', version: 1, publishedAt, title: 'v1' }));
      await archive.appendUpdate(makeSignal({ id: 'same-file', version: 2, publishedAt, title: 'v2' }));
      await archive.appendUpdate(makeSignal({ id: 'same-file', version: 3, publishedAt, title: 'v3' }));

      const dates = await archive.listDates();
      expect(dates).toHaveLength(1); // sanity check: only one file

      const results = await archive.query({});
      expect(results.filter((s) => s.id === 'same-file')).toHaveLength(1);
      expect(results[0].version).toBe(3);
      expect(results[0].title).toBe('v3');
    });

    it('handles out-of-order version writes by always keeping the highest version', async () => {
      const publishedAt = '2026-03-21T12:00:00.000Z';
      // Write v3 first, then v1 (simulate out-of-order append)
      await archive.append(makeSignal({ id: 'ooo', version: 3, publishedAt, title: 'v3' }));
      await archive.appendUpdate(makeSignal({ id: 'ooo', version: 1, publishedAt, title: 'v1' }));

      const results = await archive.query({});
      const ooo = results.find((s) => s.id === 'ooo');
      expect(ooo).toBeDefined();
      expect(ooo!.version).toBe(3);
      expect(ooo!.title).toBe('v3');
    });
  });
});
