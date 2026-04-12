import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DreamRunner } from '../../src/dream/dream-runner.js';
import { DreamStore } from '../../src/dream/dream-store.js';
import { InsightStore } from '../../src/insights/insight-store.js';
import { PortfolioSnapshotStore } from '../../src/portfolio/snapshot-store.js';
import { TickerProfileStore } from '../../src/profiles/profile-store.js';
import { SignalArchive } from '../../src/signals/archive.js';
import { AssessmentStore } from '../../src/signals/curation/assessment-store.js';
import { SnapStore } from '../../src/snap/snap-store.js';

describe('DreamRunner', () => {
  let dir: string;
  let runner: DreamRunner;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yojin-dream-runner-'));

    const signalArchive = new SignalArchive({ dir: join(dir, 'signals') });
    const assessmentStore = new AssessmentStore(dir);
    const insightStore = new InsightStore(dir);
    const snapStore = new SnapStore(dir);
    const profileStore = new TickerProfileStore({ dataDir: join(dir, 'profiles') });
    await profileStore.initialize();
    const snapshotStore = new PortfolioSnapshotStore(dir);

    runner = new DreamRunner(dir, {
      signalArchive,
      assessmentStore,
      insightStore,
      snapStore,
      profileStore,
      snapshotStore,
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('should run on first invocation (no prior run)', async () => {
    const shouldRun = await runner.shouldRun();
    expect(shouldRun).toBe(true);
  });

  it('should not run immediately after a completed dream', async () => {
    await runner.run();
    const shouldRun = await runner.shouldRun();
    expect(shouldRun).toBe(false);
  });

  it('produces a valid dream log', async () => {
    const log = await runner.run();

    expect(log.id).toMatch(/^dream-/);
    expect(log.startedAt).toBeTruthy();
    expect(log.completedAt).toBeTruthy();
    expect(log.durationMs).toBeGreaterThanOrEqual(0);
    expect(log.signalCleanup).toBeDefined();
    expect(log.insightFreshness).toBeDefined();
    expect(log.relevanceRerank).toBeDefined();
  });

  it('persists dream logs and retrieves them', async () => {
    await runner.run();
    await runner.run(); // Force a second run for testing

    const logs = await runner.getRecentLogs(5);
    expect(logs.length).toBe(2);
    // Newest first
    expect(new Date(logs[0].completedAt).getTime()).toBeGreaterThanOrEqual(new Date(logs[1].completedAt).getTime());
  });
});

describe('DreamStore', () => {
  let dir: string;
  let store: DreamStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yojin-dream-store-'));
    store = new DreamStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns 0 for lastRunAt when never run', async () => {
    const lastRunAt = await store.getLastRunAt();
    expect(lastRunAt).toBe(0);
  });

  it('returns empty array for recent logs when none exist', async () => {
    const logs = await store.getRecent(5);
    expect(logs).toEqual([]);
  });

  it('saves and retrieves a dream log', async () => {
    const log = {
      id: 'dream-test',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 100,
      signalCleanup: { dismissed: 5, duplicatesMarked: 2, learnedPatterns: [] },
      insightFreshness: { staleTheses: [], expiredActionItems: 0, profileEntriesCreated: 0 },
      relevanceRerank: { convergenceBoosts: 0, signalsRescored: 0, snapRegenerated: false },
    };

    await store.save(log);
    const retrieved = await store.getRecent(1);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].id).toBe('dream-test');
  });

  it('updates lastRunAt after save', async () => {
    const before = await store.getLastRunAt();
    expect(before).toBe(0);

    await store.save({
      id: 'dream-test',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 100,
      signalCleanup: { dismissed: 0, duplicatesMarked: 0, learnedPatterns: [] },
      insightFreshness: { staleTheses: [], expiredActionItems: 0, profileEntriesCreated: 0 },
      relevanceRerank: { convergenceBoosts: 0, signalsRescored: 0, snapRegenerated: false },
    });

    const after = await store.getLastRunAt();
    expect(after).toBeGreaterThan(0);
  });
});
