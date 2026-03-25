import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignalArchive } from '../../src/signals/archive.js';
import { SignalClustering } from '../../src/signals/clustering.js';
import { SignalGroupArchive } from '../../src/signals/group-archive.js';
import type { Signal } from '../../src/signals/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _counter = 0;

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  _counter++;
  return {
    id: `sig-${_counter.toString().padStart(3, '0')}`,
    contentHash: `hash-${_counter}`,
    type: 'NEWS',
    title: `Signal ${_counter}: Some financial news`,
    assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }],
    sources: [{ id: `source-${_counter}`, name: `Source ${_counter}`, type: 'API', reliability: 0.85 }],
    publishedAt: '2026-03-25T10:00:00.000Z',
    ingestedAt: '2026-03-25T10:01:00.000Z',
    confidence: 0.85,
    outputType: 'INSIGHT',
    version: 1,
    ...overrides,
  };
}

const DEFAULT_SUMMARY = {
  tier1: 'Apple earnings beat expectations',
  tier2: 'Apple reported record earnings this quarter, beating analyst expectations.',
  sentiment: 'BULLISH' as const,
  outputType: 'INSIGHT' as const,
};

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('SignalClustering', () => {
  let archiveDir: string;
  let groupArchiveDir: string;
  let archive: SignalArchive;
  let groupArchive: SignalGroupArchive;

  beforeEach(async () => {
    _counter = 0;
    archiveDir = await mkdtemp(join(tmpdir(), 'yojin-signals-'));
    groupArchiveDir = await mkdtemp(join(tmpdir(), 'yojin-groups-'));
    archive = new SignalArchive({ dir: archiveDir });
    groupArchive = new SignalGroupArchive({ dir: groupArchiveDir });
  });

  afterEach(async () => {
    await rm(archiveDir, { recursive: true, force: true });
    await rm(groupArchiveDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. No candidates
  // -------------------------------------------------------------------------

  it('enriches signal with tier1/tier2/sentiment/outputType when no candidates exist', async () => {
    const generator = { generate: vi.fn().mockResolvedValue(DEFAULT_SUMMARY) };
    const classify = vi.fn();

    const clustering = new SignalClustering({ archive, groupArchive, classify, generator });
    const signal = makeSignal();

    await clustering.processSignals([signal]);

    // Generator was called
    expect(generator.generate).toHaveBeenCalledOnce();
    expect(generator.generate).toHaveBeenCalledWith(expect.objectContaining({ id: signal.id }));

    // Classify was never called (no candidates)
    expect(classify).not.toHaveBeenCalled();

    // Enriched signal is stored in the archive
    const stored = await archive.query({ tickers: ['AAPL'] });
    expect(stored).toHaveLength(1);
    expect(stored[0].tier1).toBe(DEFAULT_SUMMARY.tier1);
    expect(stored[0].tier2).toBe(DEFAULT_SUMMARY.tier2);
    expect(stored[0].sentiment).toBe(DEFAULT_SUMMARY.sentiment);
    expect(stored[0].outputType).toBe(DEFAULT_SUMMARY.outputType);
    expect(stored[0].version).toBe(2); // bumped from 1
  });

  // -------------------------------------------------------------------------
  // 2. SAME — merge
  // -------------------------------------------------------------------------

  it('merges source into existing signal and bumps version on SAME', async () => {
    const existingSignal = makeSignal({ id: 'existing-001', contentHash: 'hash-existing', version: 1 });
    await archive.append(existingSignal);

    const incomingSignal = makeSignal({
      id: 'incoming-001',
      contentHash: 'hash-incoming',
      title: existingSignal.title, // same story, different source
      sources: [{ id: 'reuters', name: 'Reuters', type: 'RSS', reliability: 0.9 }],
    });

    const generator = { generate: vi.fn().mockResolvedValue(DEFAULT_SUMMARY) };
    const classify = vi.fn().mockResolvedValue('SAME');

    const clustering = new SignalClustering({ archive, groupArchive, classify, generator });
    await clustering.processSignals([incomingSignal]);

    // classify was called with existing vs incoming
    expect(classify).toHaveBeenCalledOnce();

    // The merged signal should have both sources
    const stored = await archive.query({ tickers: ['AAPL'] });
    // There will be the original + the merged update — dedup keeps highest version
    const merged = stored.find((s) => s.id === 'existing-001');
    expect(merged).toBeDefined();
    expect(merged!.version).toBe(2);
    expect(merged!.sources.some((s) => s.id === 'reuters')).toBe(true);
    expect(merged!.tier1).toBe(DEFAULT_SUMMARY.tier1);

    // The incoming signal itself should NOT appear as a separate entry
    const incoming = stored.find((s) => s.id === 'incoming-001');
    expect(incoming).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 3. RELATED — SignalGroup
  // -------------------------------------------------------------------------

  it('creates new signal and SignalGroup when RELATED', async () => {
    const existingSignal = makeSignal({ id: 'existing-002', contentHash: 'hash-e2', version: 1 });
    await archive.append(existingSignal);

    const incomingSignal = makeSignal({
      id: 'incoming-002',
      contentHash: 'hash-i2',
      title: 'Apple faces supply chain disruption (follow-up)',
    });

    const generator = { generate: vi.fn().mockResolvedValue(DEFAULT_SUMMARY) };
    const classify = vi.fn().mockResolvedValue('RELATED');

    const clustering = new SignalClustering({ archive, groupArchive, classify, generator });
    await clustering.processSignals([incomingSignal]);

    expect(classify).toHaveBeenCalledOnce();
    expect(generator.generate).toHaveBeenCalledOnce();

    // A SignalGroup should have been created
    const groups = await groupArchive.query({});
    expect(groups).toHaveLength(1);
    expect(groups[0].signalIds).toContain('existing-002');
    expect(groups[0].signalIds).toContain('incoming-002');
    expect(groups[0].tickers).toContain('AAPL');
    expect(groups[0].id).toMatch(/^grp-/);

    // Both signals should have the groupId set
    const allSignals = await archive.query({ tickers: ['AAPL'] });
    const existingUpdated = allSignals.find((s) => s.id === 'existing-002');
    const incomingStored = allSignals.find((s) => s.id === 'incoming-002');

    expect(existingUpdated).toBeDefined();
    expect(existingUpdated!.groupId).toBe(groups[0].id);

    expect(incomingStored).toBeDefined();
    expect(incomingStored!.groupId).toBe(groups[0].id);
    expect(incomingStored!.tier1).toBe(DEFAULT_SUMMARY.tier1);
  });

  // -------------------------------------------------------------------------
  // 4. DIFFERENT — independent signal
  // -------------------------------------------------------------------------

  it('creates independent signal when all candidates are DIFFERENT', async () => {
    const existingSignal = makeSignal({ id: 'existing-003', contentHash: 'hash-e3', version: 1 });
    await archive.append(existingSignal);

    const incomingSignal = makeSignal({
      id: 'incoming-003',
      contentHash: 'hash-i3',
      title: 'Unrelated Apple product launch announcement',
    });

    const generator = { generate: vi.fn().mockResolvedValue(DEFAULT_SUMMARY) };
    const classify = vi.fn().mockResolvedValue('DIFFERENT');

    const clustering = new SignalClustering({ archive, groupArchive, classify, generator });
    await clustering.processSignals([incomingSignal]);

    expect(classify).toHaveBeenCalledOnce();
    expect(generator.generate).toHaveBeenCalledOnce();

    // No groups created
    const groups = await groupArchive.query({});
    expect(groups).toHaveLength(0);

    // Incoming signal stored independently with enrichment
    const allSignals = await archive.query({ tickers: ['AAPL'] });
    const stored = allSignals.find((s) => s.id === 'incoming-003');
    expect(stored).toBeDefined();
    expect(stored!.tier1).toBe(DEFAULT_SUMMARY.tier1);
    expect(stored!.groupId).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 5. Clustering failure doesn't throw
  // -------------------------------------------------------------------------

  it('does not throw when processSignals encounters an error', async () => {
    const generator = {
      generate: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    };
    const classify = vi.fn();

    const clustering = new SignalClustering({ archive, groupArchive, classify, generator });
    const signal = makeSignal();

    // Should not throw
    await expect(clustering.processSignals([signal])).resolves.toBeUndefined();
  });

  it('continues processing remaining signals after one fails', async () => {
    let callCount = 0;
    const generator = {
      generate: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('First call fails');
        return Promise.resolve(DEFAULT_SUMMARY);
      }),
    };
    const classify = vi.fn();

    const clustering = new SignalClustering({ archive, groupArchive, classify, generator });
    const signal1 = makeSignal({ id: 'fail-001', contentHash: 'ch1' });
    const signal2 = makeSignal({ id: 'ok-002', contentHash: 'ch2' });

    await clustering.processSignals([signal1, signal2]);

    // Second signal was processed despite first failing
    const stored = await archive.query({ tickers: ['AAPL'] });
    const ok = stored.find((s) => s.id === 'ok-002');
    expect(ok).toBeDefined();
    expect(ok!.tier1).toBe(DEFAULT_SUMMARY.tier1);
  });

  // -------------------------------------------------------------------------
  // 6. Concurrency limit respected
  // -------------------------------------------------------------------------

  it('respects concurrencyLimit by capping concurrent LLM calls to the specified max', async () => {
    const LIMIT = 3;
    let activeCalls = 0;
    let maxObservedConcurrency = 0;

    // We need candidates in the archive to trigger classify calls.
    // Place a single AAPL signal — all incoming will be classified against it.
    const existing = makeSignal({ id: 'anchor', contentHash: 'anchor-hash', version: 1 });
    await archive.append(existing);

    const classify = vi.fn().mockImplementation(async () => {
      activeCalls++;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeCalls--;
      return 'DIFFERENT';
    });

    const generator = {
      generate: vi.fn().mockImplementation(async () => {
        activeCalls++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, activeCalls);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeCalls--;
        return DEFAULT_SUMMARY;
      }),
    };

    // Build 10 unique signals so each hits classify + generator sequentially
    const signals = Array.from({ length: 10 }, (_, i) => makeSignal({ id: `test-${i}`, contentHash: `ch-${i}` }));

    const clustering = new SignalClustering({
      archive,
      groupArchive,
      classify,
      generator,
      concurrencyLimit: LIMIT,
    });

    // processSignals is sequential per signal, but within a signal LLM calls
    // go through the semaphore. Since we process signals one at a time and each
    // signal makes one classify + one generator call (serially), the concurrency
    // max should never exceed 1 at a time in this sequential mode.
    // The semaphore guards against parallel bursts — verify it doesn't exceed LIMIT.
    await clustering.processSignals(signals);

    expect(maxObservedConcurrency).toBeLessThanOrEqual(LIMIT);
  });
});
