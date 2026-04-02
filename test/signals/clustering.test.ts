import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignalArchive } from '../../src/signals/archive.js';
import { SignalClustering } from '../../src/signals/clustering.js';
import { SignalGroupArchive } from '../../src/signals/group-archive.js';
import type { QualityVerdict } from '../../src/signals/quality-agent.js';
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

const KEEP_VERDICT: QualityVerdict = {
  verdict: 'KEEP',
  tier1: 'Apple earnings beat expectations',
  tier2: 'Apple reported record earnings this quarter, beating analyst expectations.',
  sentiment: 'BULLISH',
  outputType: 'INSIGHT',
  qualityScore: 75,
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
  // 1. No candidates — KEEP verdict enriches and stores
  // -------------------------------------------------------------------------

  it('enriches signal with tier1/tier2/sentiment/outputType when no candidates exist', async () => {
    const qualityAgent = { evaluate: vi.fn().mockResolvedValue(KEEP_VERDICT) };

    const clustering = new SignalClustering({ archive, groupArchive, qualityAgent });
    const signal = makeSignal();

    await clustering.processSignals([signal]);

    // Quality agent was called
    expect(qualityAgent.evaluate).toHaveBeenCalledOnce();

    // Enriched signal is stored in the archive
    const stored = await archive.query({ tickers: ['AAPL'] });
    expect(stored).toHaveLength(1);
    expect(stored[0].tier1).toBe(KEEP_VERDICT.tier1);
    expect(stored[0].tier2).toBe(KEEP_VERDICT.tier2);
    expect(stored[0].sentiment).toBe(KEEP_VERDICT.sentiment);
    expect(stored[0].outputType).toBe(KEEP_VERDICT.outputType);
    expect(stored[0].version).toBe(2); // bumped from 1
  });

  // -------------------------------------------------------------------------
  // 2. Duplicate — merge sources
  // -------------------------------------------------------------------------

  it('merges source into existing signal when quality agent detects duplicate', async () => {
    const existingSignal = makeSignal({ id: 'existing-001', contentHash: 'hash-existing', version: 1 });
    await archive.append(existingSignal);

    const incomingSignal = makeSignal({
      id: 'incoming-001',
      contentHash: 'hash-incoming',
      title: existingSignal.title,
      sources: [{ id: 'reuters', name: 'Reuters', type: 'RSS', reliability: 0.9 }],
    });

    const duplicateVerdict: QualityVerdict = {
      ...KEEP_VERDICT,
      verdict: 'DROP',
      dropReason: 'duplicate',
      duplicateOfId: existingSignal.id,
    };
    const qualityAgent = { evaluate: vi.fn().mockResolvedValue(duplicateVerdict) };

    const clustering = new SignalClustering({ archive, groupArchive, qualityAgent });
    await clustering.processSignals([incomingSignal]);

    expect(qualityAgent.evaluate).toHaveBeenCalledOnce();

    // The merged signal should have both sources
    const stored = await archive.query({ tickers: ['AAPL'] });
    const merged = stored.find((s) => s.id === 'existing-001');
    expect(merged).toBeDefined();
    expect(merged!.version).toBe(2);
    expect(merged!.sources.some((s) => s.id === 'reuters')).toBe(true);

    // The incoming signal itself should NOT appear as a separate entry
    const incoming = stored.find((s) => s.id === 'incoming-001');
    expect(incoming).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 3. KEEP + relatedToId → links to existing group
  // -------------------------------------------------------------------------

  it('links signal to existing group when LLM returns relatedToId', async () => {
    const existingSignal = makeSignal({
      id: 'existing-002',
      contentHash: 'hash-e2',
      version: 1,
      groupId: 'grp-existing',
    });
    await archive.append(existingSignal);

    await groupArchive.appendUpdate({
      id: 'grp-existing',
      signalIds: ['existing-002'],
      tickers: ['AAPL'],
      summary: 'Apple earnings beat expectations',
      outputType: 'INSIGHT',
      firstEventAt: existingSignal.publishedAt,
      lastEventAt: existingSignal.publishedAt,
      version: 1,
      createdAt: existingSignal.publishedAt,
      updatedAt: existingSignal.publishedAt,
    });

    const incomingSignal = makeSignal({
      id: 'incoming-002',
      contentHash: 'hash-i2',
      title: 'Apple faces supply chain disruption (follow-up)',
    });

    const relatedVerdict: QualityVerdict = { ...KEEP_VERDICT, relatedToId: 'existing-002' };
    const qualityAgent = { evaluate: vi.fn().mockResolvedValue(relatedVerdict) };

    const clustering = new SignalClustering({ archive, groupArchive, qualityAgent });
    await clustering.processSignals([incomingSignal]);

    const allSignals = await archive.query({ tickers: ['AAPL'] });
    const incomingStored = allSignals.find((s) => s.id === 'incoming-002');
    expect(incomingStored).toBeDefined();
    expect(incomingStored!.groupId).toBe('grp-existing');
    expect(incomingStored!.tier1).toBe(KEEP_VERDICT.tier1);
  });

  // -------------------------------------------------------------------------
  // 4. KEEP + relatedToId, no existing group → creates new group
  // -------------------------------------------------------------------------

  it('creates new group when LLM returns relatedToId and no group exists', async () => {
    const existingSignal = makeSignal({
      id: 'existing-003',
      contentHash: 'hash-e3',
      version: 1,
    });
    await archive.append(existingSignal);

    const incomingSignal = makeSignal({
      id: 'incoming-003',
      contentHash: 'hash-i3',
      title: 'Apple faces supply chain disruption (follow-up)',
    });

    const relatedVerdict: QualityVerdict = { ...KEEP_VERDICT, relatedToId: 'existing-003' };
    const qualityAgent = { evaluate: vi.fn().mockResolvedValue(relatedVerdict) };

    const clustering = new SignalClustering({ archive, groupArchive, qualityAgent });
    await clustering.processSignals([incomingSignal]);

    const groups = await groupArchive.query({});
    expect(groups).toHaveLength(1);
    expect(groups[0].signalIds).toContain('existing-003');
    expect(groups[0].signalIds).toContain('incoming-003');
    expect(groups[0].tickers).toContain('AAPL');
    expect(groups[0].id).toMatch(/^grp-/);

    const allSignals = await archive.query({ tickers: ['AAPL'] });
    const existingUpdated = allSignals.find((s) => s.id === 'existing-003');
    const incomingStored = allSignals.find((s) => s.id === 'incoming-003');

    expect(existingUpdated!.groupId).toBe(groups[0].id);
    expect(incomingStored!.groupId).toBe(groups[0].id);
    expect(incomingStored!.tier1).toBe(KEEP_VERDICT.tier1);
  });

  // -------------------------------------------------------------------------
  // 4b. KEEP without relatedToId → independent signal (no spurious grouping)
  // -------------------------------------------------------------------------

  it('does not group unrelated same-day signals when LLM returns no relatedToId', async () => {
    const existingSignal = makeSignal({
      id: 'existing-004',
      contentHash: 'hash-e4',
      version: 1,
    });
    await archive.append(existingSignal);

    const incomingSignal = makeSignal({
      id: 'incoming-004',
      contentHash: 'hash-i4',
      title: 'Unrelated Apple product launch announcement',
    });

    // No relatedToId — LLM says these are unrelated
    const qualityAgent = { evaluate: vi.fn().mockResolvedValue(KEEP_VERDICT) };

    const clustering = new SignalClustering({ archive, groupArchive, qualityAgent });
    await clustering.processSignals([incomingSignal]);

    const groups = await groupArchive.query({});
    expect(groups).toHaveLength(0);

    const allSignals = await archive.query({ tickers: ['AAPL'] });
    const stored = allSignals.find((s) => s.id === 'incoming-004');
    expect(stored).toBeDefined();
    expect(stored!.tier1).toBe(KEEP_VERDICT.tier1);
    expect(stored!.groupId).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 5. DROP — irrelevant signal
  // -------------------------------------------------------------------------

  it('drops signal when quality agent returns DROP with irrelevant reason', async () => {
    const dropVerdict: QualityVerdict = {
      ...KEEP_VERDICT,
      verdict: 'DROP',
      dropReason: 'irrelevant',
      qualityScore: 15,
    };
    const qualityAgent = { evaluate: vi.fn().mockResolvedValue(dropVerdict) };

    const clustering = new SignalClustering({ archive, groupArchive, qualityAgent });
    const signal = makeSignal();

    await clustering.processSignals([signal]);

    // Signal should NOT be stored in the archive
    const stored = await archive.query({ tickers: ['AAPL'] });
    expect(stored).toHaveLength(0);
  });

  it('drops signal when quality agent returns DROP with false_match reason', async () => {
    const dropVerdict: QualityVerdict = {
      ...KEEP_VERDICT,
      verdict: 'DROP',
      dropReason: 'false_match',
      qualityScore: 10,
    };
    const qualityAgent = { evaluate: vi.fn().mockResolvedValue(dropVerdict) };

    const clustering = new SignalClustering({ archive, groupArchive, qualityAgent });
    const signal = makeSignal();

    await clustering.processSignals([signal]);

    const stored = await archive.query({ tickers: ['AAPL'] });
    expect(stored).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 6. Error handling — doesn't throw
  // -------------------------------------------------------------------------

  it('does not throw when processSignals encounters an error', async () => {
    const qualityAgent = {
      evaluate: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    };

    const clustering = new SignalClustering({ archive, groupArchive, qualityAgent });
    const signal = makeSignal();

    // Should not throw
    await expect(clustering.processSignals([signal])).resolves.toBeUndefined();
  });

  it('continues processing remaining signals after one fails', async () => {
    let callCount = 0;
    const qualityAgent = {
      evaluate: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('First call fails');
        return Promise.resolve(KEEP_VERDICT);
      }),
    };

    const clustering = new SignalClustering({ archive, groupArchive, qualityAgent });
    const signal1 = makeSignal({ id: 'fail-001', contentHash: 'ch1' });
    const signal2 = makeSignal({ id: 'ok-002', contentHash: 'ch2' });

    await clustering.processSignals([signal1, signal2]);

    // Second signal was processed despite first failing
    const stored = await archive.query({ tickers: ['AAPL'] });
    const ok = stored.find((s) => s.id === 'ok-002');
    expect(ok).toBeDefined();
    expect(ok!.tier1).toBe(KEEP_VERDICT.tier1);
  });

  // -------------------------------------------------------------------------
  // 7. Concurrency limit respected
  // -------------------------------------------------------------------------

  it('respects concurrencyLimit by capping concurrent LLM calls to the specified max', async () => {
    const LIMIT = 3;
    let activeCalls = 0;
    let maxObservedConcurrency = 0;

    const qualityAgent = {
      evaluate: vi.fn().mockImplementation(async () => {
        activeCalls++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, activeCalls);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeCalls--;
        return KEEP_VERDICT;
      }),
    };

    const signals = Array.from({ length: 10 }, (_, i) => makeSignal({ id: `test-${i}`, contentHash: `ch-${i}` }));

    const clustering = new SignalClustering({
      archive,
      groupArchive,
      qualityAgent,
      concurrencyLimit: LIMIT,
    });

    await clustering.processSignals(signals);

    expect(maxObservedConcurrency).toBeLessThanOrEqual(LIMIT);
  });
});
