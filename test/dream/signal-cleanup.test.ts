import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runSignalCleanup } from '../../src/dream/signal-cleanup.js';
import { DEFAULT_DREAM_CONFIG } from '../../src/dream/types.js';
import { SignalArchive } from '../../src/signals/archive.js';
import { AssessmentStore } from '../../src/signals/curation/assessment-store.js';
import type { Signal } from '../../src/signals/types.js';

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: `sig-${Math.random().toString(36).slice(2, 8)}`,
    contentHash: `hash-${Math.random().toString(36).slice(2, 8)}`,
    type: 'NEWS',
    title: 'Test Signal',
    assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }],
    sources: [{ id: 'test-source', name: 'Test', type: 'API', reliability: 0.9 }],
    publishedAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    confidence: 0.85,
    ...overrides,
  };
}

describe('signal-cleanup', () => {
  let dir: string;
  let signalArchive: SignalArchive;
  let assessmentStore: AssessmentStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yojin-dream-'));
    signalArchive = new SignalArchive({ dir: join(dir, 'signals') });
    assessmentStore = new AssessmentStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns zero counts with no signals', async () => {
    const result = await runSignalCleanup({ signalArchive, assessmentStore }, DEFAULT_DREAM_CONFIG);
    expect(result.dismissed).toBe(0);
    expect(result.duplicatesMarked).toBe(0);
    expect(result.learnedPatterns).toEqual([]);
  });

  it('dismisses stale shown signals', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const old = makeSignal({
      id: 'old-1',
      publishedAt: tenDaysAgo,
    });
    await signalArchive.append(old);
    // Write shown.json directly with an old shownAt timestamp (markShown uses Date.now())
    const signalsDir = join(dir, 'signals');
    await mkdir(signalsDir, { recursive: true });
    await writeFile(join(signalsDir, 'shown.json'), JSON.stringify({ 'old-1': tenDaysAgo }));

    const result = await runSignalCleanup({ signalArchive, assessmentStore }, DEFAULT_DREAM_CONFIG);
    expect(result.dismissed).toBe(1);
  });

  it('detects cross-source duplicates with similar titles', async () => {
    const now = new Date().toISOString();
    await signalArchive.appendBatch([
      makeSignal({
        id: 'dup-1',
        title: 'Apple reports record quarterly revenue growth',
        confidence: 0.9,
        qualityScore: 80,
        publishedAt: now,
      }),
      makeSignal({
        id: 'dup-2',
        title: 'Apple reports record quarterly revenue growth surge',
        confidence: 0.7,
        qualityScore: 60,
        publishedAt: now,
      }),
    ]);

    const result = await runSignalCleanup({ signalArchive, assessmentStore }, DEFAULT_DREAM_CONFIG);
    expect(result.duplicatesMarked).toBe(1);
  });

  it('keeps dissimilar signals', async () => {
    const now = new Date().toISOString();
    await signalArchive.appendBatch([
      makeSignal({
        id: 'unique-1',
        title: 'Apple launches new iPhone model with AI features',
        publishedAt: now,
      }),
      makeSignal({
        id: 'unique-2',
        title: 'Federal Reserve raises interest rates by quarter point',
        publishedAt: now,
      }),
    ]);

    const result = await runSignalCleanup({ signalArchive, assessmentStore }, DEFAULT_DREAM_CONFIG);
    expect(result.duplicatesMarked).toBe(0);
  });
});
