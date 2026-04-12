import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runInsightFreshness } from '../../src/dream/insight-freshness.js';
import { DEFAULT_DREAM_CONFIG } from '../../src/dream/types.js';
import { InsightStore } from '../../src/insights/insight-store.js';
import type { InsightReport } from '../../src/insights/types.js';
import { TickerProfileStore } from '../../src/profiles/profile-store.js';
import { SignalArchive } from '../../src/signals/archive.js';
import { SnapStore } from '../../src/snap/snap-store.js';

function makeInsightReport(overrides: Partial<InsightReport> = {}): InsightReport {
  return {
    id: `rpt-${Math.random().toString(36).slice(2, 8)}`,
    snapshotId: 'snap-001',
    positions: [
      {
        symbol: 'AAPL',
        name: 'Apple Inc',
        rating: 'BULLISH',
        conviction: 0.8,
        thesis: 'Strong iPhone sales driving growth',
        keySignals: [
          {
            signalId: 'sig-001',
            type: 'NEWS',
            title: 'Apple revenue beats',
            impact: 'POSITIVE',
            confidence: 0.9,
          },
        ],
        allSignalIds: ['sig-001'],
        risks: ['Competition'],
        opportunities: ['AI expansion'],
        memoryContext: null,
        priceTarget: 200,
      },
    ],
    portfolio: {
      overallHealth: 'HEALTHY',
      summary: 'Portfolio performing well',
      intelSummary: '',
      sectorThemes: ['Technology'],
      macroContext: 'Stable rates',
      topRisks: [{ text: 'Market volatility', signalIds: [] }],
      topOpportunities: [{ text: 'AI growth', signalIds: [] }],
      actionItems: [{ text: 'Review tech allocation', signalIds: [] }],
    },
    agentOutputs: {
      researchAnalyst: 'analysis',
      riskManager: 'risk report',
      strategist: 'strategy',
    },
    emotionState: { confidence: 0.7, riskAppetite: 0.5, reason: 'Stable' },
    createdAt: new Date().toISOString(),
    durationMs: 5000,
    ...overrides,
  };
}

describe('insight-freshness', () => {
  let dir: string;
  let insightStore: InsightStore;
  let signalArchive: SignalArchive;
  let snapStore: SnapStore;
  let profileStore: TickerProfileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yojin-dream-insight-'));
    insightStore = new InsightStore(dir);
    signalArchive = new SignalArchive({ dir: join(dir, 'signals') });
    snapStore = new SnapStore(dir);
    profileStore = new TickerProfileStore({ dataDir: join(dir, 'profiles') });
    await profileStore.initialize();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty results with no insights', async () => {
    const result = await runInsightFreshness(
      { insightStore, signalArchive, snapStore, profileStore },
      DEFAULT_DREAM_CONFIG,
    );
    expect(result.staleTheses).toEqual([]);
    expect(result.expiredActionItems).toBe(0);
    expect(result.profileEntriesCreated).toBe(0);
  });

  it('detects stale insight reports', async () => {
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await insightStore.save(makeInsightReport({ createdAt: staleDate }));

    const result = await runInsightFreshness(
      { insightStore, signalArchive, snapStore, profileStore },
      DEFAULT_DREAM_CONFIG,
    );
    expect(result.staleTheses.length).toBeGreaterThan(0);
    expect(result.staleTheses[0].symbol).toBe('AAPL');
  });

  it('does not flag fresh insight reports as stale', async () => {
    // Save a report and also add a recent signal for the ticker
    await insightStore.save(makeInsightReport());
    await signalArchive.append({
      id: 'sig-001',
      contentHash: 'h1',
      type: 'NEWS',
      title: 'Fresh signal',
      assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }],
      sources: [{ id: 'test', name: 'Test', type: 'API', reliability: 0.9 }],
      publishedAt: new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
      confidence: 0.85,
    });

    const result = await runInsightFreshness(
      { insightStore, signalArchive, snapStore, profileStore },
      DEFAULT_DREAM_CONFIG,
    );
    expect(result.staleTheses).toEqual([]);
  });

  it('expires old snap action items', async () => {
    const staleDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    await snapStore.save({
      id: 'snap-old',
      generatedAt: staleDate,
      actionItems: [
        { text: 'Review AAPL position', signalIds: ['sig-001'] },
        { text: 'Check sector exposure', signalIds: [] },
      ],
      assetSnaps: [],
    });

    const result = await runInsightFreshness(
      { insightStore, signalArchive, snapStore, profileStore },
      DEFAULT_DREAM_CONFIG,
    );
    expect(result.expiredActionItems).toBe(2);

    // Verify snap was updated
    const updatedSnap = await snapStore.getLatest();
    expect(updatedSnap?.actionItems).toEqual([]);
  });
});
