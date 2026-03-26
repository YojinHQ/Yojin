import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PortfolioSnapshotStore } from '../../src/portfolio/snapshot-store.js';
import { SignalArchive } from '../../src/signals/archive.js';
import { CuratedSignalStore } from '../../src/signals/curation/curated-signal-store.js';
import {
  computeCompositeScore,
  computeExposureWeight,
  computeRecencyFactor,
  computeSourceReliability,
  computeTypeRelevance,
  runCurationPipeline,
} from '../../src/signals/curation/pipeline.js';
import type { CurationConfig } from '../../src/signals/curation/types.js';
import { CurationConfigSchema } from '../../src/signals/curation/types.js';
import type { Signal } from '../../src/signals/types.js';

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig-001',
    contentHash: 'hash-001',
    type: 'NEWS',
    title: 'Apple Q4 earnings beat expectations',
    assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }],
    sources: [{ id: 'reuters', name: 'Reuters', type: 'RSS', reliability: 0.8 }],
    publishedAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    confidence: 0.85,
    outputType: 'INSIGHT',
    version: 1,
    ...overrides,
  };
}

const DEFAULT_WEIGHTS: CurationConfig['weights'] = {
  exposure: 0.3,
  typeRelevance: 0.25,
  recency: 0.25,
  sourceReliability: 0.2,
};

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

describe('Scoring helpers', () => {
  describe('computeExposureWeight', () => {
    it('returns correct portfolio percentage', () => {
      expect(computeExposureWeight(30_000, 100_000)).toBeCloseTo(0.3);
    });

    it('returns 0 for zero total', () => {
      expect(computeExposureWeight(1000, 0)).toBe(0);
    });

    it('clamps to 1.0', () => {
      expect(computeExposureWeight(200_000, 100_000)).toBe(1);
    });
  });

  describe('computeTypeRelevance', () => {
    it('returns correct value for FUNDAMENTAL + EQUITY', () => {
      expect(computeTypeRelevance('FUNDAMENTAL', 'EQUITY')).toBe(0.9);
    });

    it('returns correct value for SENTIMENT + CRYPTO', () => {
      expect(computeTypeRelevance('SENTIMENT', 'CRYPTO')).toBe(0.8);
    });

    it('returns correct value for MACRO + BOND', () => {
      expect(computeTypeRelevance('MACRO', 'BOND')).toBe(0.9);
    });
  });

  describe('computeRecencyFactor', () => {
    it('returns ~1.0 for signals published now', () => {
      expect(computeRecencyFactor(new Date().toISOString(), Date.now())).toBeCloseTo(1.0, 1);
    });

    it('decays for older signals', () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const factor = computeRecencyFactor(sevenDaysAgo, Date.now());
      // exp(-1) ≈ 0.368
      expect(factor).toBeCloseTo(0.368, 1);
    });

    it('decays further for very old signals', () => {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const factor = computeRecencyFactor(fourteenDaysAgo, Date.now());
      // exp(-2) ≈ 0.135
      expect(factor).toBeCloseTo(0.135, 1);
    });
  });

  describe('computeSourceReliability', () => {
    it('averages source reliability scores', () => {
      const signal = makeSignal({
        sources: [
          { id: 's1', name: 'S1', type: 'API', reliability: 0.8 },
          { id: 's2', name: 'S2', type: 'RSS', reliability: 0.6 },
        ],
      });
      expect(computeSourceReliability(signal)).toBeCloseTo(0.7);
    });

    it('returns 0.5 for empty sources', () => {
      const signal = makeSignal({ sources: [] as Signal['sources'] });
      // Override min(1) validation for testing
      expect(computeSourceReliability({ ...signal, sources: [] })).toBe(0.5);
    });
  });

  describe('computeCompositeScore', () => {
    it('combines weights correctly', () => {
      const score = computeCompositeScore(0.5, 0.8, 1.0, 0.9, DEFAULT_WEIGHTS);
      // 0.3*0.5 + 0.25*0.8 + 0.25*1.0 + 0.2*0.9 = 0.15 + 0.2 + 0.25 + 0.18 = 0.78
      expect(score).toBeCloseTo(0.78, 2);
    });

    it('clamps to [0, 1]', () => {
      expect(computeCompositeScore(1, 1, 1, 1, DEFAULT_WEIGHTS)).toBeLessThanOrEqual(1);
      expect(computeCompositeScore(0, 0, 0, 0, DEFAULT_WEIGHTS)).toBeGreaterThanOrEqual(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

describe('runCurationPipeline', () => {
  let dataRoot: string;
  let signalArchive: SignalArchive;
  let curatedStore: CuratedSignalStore;
  let snapshotStore: PortfolioSnapshotStore;
  let config: CurationConfig;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'yojin-curation-'));
    const signalDir = join(dataRoot, 'signals', 'by-date');
    await mkdir(signalDir, { recursive: true });
    signalArchive = new SignalArchive({ dir: signalDir });
    curatedStore = new CuratedSignalStore(dataRoot);
    snapshotStore = new PortfolioSnapshotStore(dataRoot);
    config = CurationConfigSchema.parse({});
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function seedPortfolio(): Promise<void> {
    await snapshotStore.save({
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          quantity: 10,
          costBasis: 1500,
          currentPrice: 180,
          marketValue: 1800,
          unrealizedPnl: 300,
          unrealizedPnlPercent: 20,
          assetClass: 'EQUITY',
          platform: 'MANUAL',
        },
        {
          symbol: 'MSFT',
          name: 'Microsoft',
          quantity: 5,
          costBasis: 1500,
          currentPrice: 400,
          marketValue: 2000,
          unrealizedPnl: 500,
          unrealizedPnlPercent: 33.3,
          assetClass: 'EQUITY',
          platform: 'MANUAL',
        },
      ],
      platform: 'MANUAL',
    });
  }

  it('returns zero when no portfolio', async () => {
    const result = await runCurationPipeline({ signalArchive, curatedStore, snapshotStore, config });
    expect(result.signalsProcessed).toBe(0);
    expect(result.signalsCurated).toBe(0);
  });

  it('returns zero when no signals', async () => {
    await seedPortfolio();
    const result = await runCurationPipeline({ signalArchive, curatedStore, snapshotStore, config });
    expect(result.signalsProcessed).toBe(0);
  });

  it('curates signals matching portfolio', async () => {
    await seedPortfolio();
    await signalArchive.appendBatch([
      makeSignal({ id: 's1', contentHash: 'h1', assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }] }),
      makeSignal({ id: 's2', contentHash: 'h2', assets: [{ ticker: 'MSFT', relevance: 0.8, linkType: 'DIRECT' }] }),
    ]);

    const result = await runCurationPipeline({ signalArchive, curatedStore, snapshotStore, config });
    expect(result.signalsProcessed).toBe(2);
    expect(result.signalsCurated).toBe(2);
    expect(result.signalsDropped).toBe(0);

    const curated = await curatedStore.queryByTickers(['AAPL']);
    expect(curated).toHaveLength(1);
    expect(curated[0].scores[0].ticker).toBe('AAPL');
    expect(curated[0].scores[0].compositeScore).toBeGreaterThan(0);
  });

  it('filters out low-confidence signals', async () => {
    await seedPortfolio();
    await signalArchive.appendBatch([
      makeSignal({ id: 's1', contentHash: 'h1', confidence: 0.1 }),
      makeSignal({ id: 's2', contentHash: 'h2', confidence: 0.8 }),
    ]);

    const result = await runCurationPipeline({ signalArchive, curatedStore, snapshotStore, config });
    expect(result.signalsCurated).toBe(1);
    expect(result.signalsDropped).toBe(1);
  });

  it('filters out spam signals', async () => {
    await seedPortfolio();
    await signalArchive.appendBatch([
      makeSignal({ id: 's1', contentHash: 'h1', title: 'SPONSORED: Buy this stock now!' }),
      makeSignal({ id: 's2', contentHash: 'h2', title: 'Apple reports record revenue' }),
    ]);

    const result = await runCurationPipeline({ signalArchive, curatedStore, snapshotStore, config });
    expect(result.signalsCurated).toBe(1);
  });

  it('filters out signals with no portfolio ticker', async () => {
    await seedPortfolio();
    await signalArchive.appendBatch([
      makeSignal({
        id: 's1',
        contentHash: 'h1',
        assets: [{ ticker: 'TSLA', relevance: 0.9, linkType: 'DIRECT' }],
      }),
    ]);

    // Query with TSLA ticker so the archive returns it, but pipeline should filter it
    // because TSLA is not in the portfolio
    const result = await runCurationPipeline({ signalArchive, curatedStore, snapshotStore, config });
    expect(result.signalsCurated).toBe(0);
  });

  it('trims to topNPerPosition', async () => {
    await seedPortfolio();
    const signals = Array.from({ length: 30 }, (_, i) =>
      makeSignal({
        id: `s${i}`,
        contentHash: `h${i}`,
        confidence: 0.5 + (i % 10) * 0.05,
        assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }],
      }),
    );
    await signalArchive.appendBatch(signals);

    const trimConfig = CurationConfigSchema.parse({ topNPerPosition: 10 });
    const result = await runCurationPipeline({ signalArchive, curatedStore, snapshotStore, config: trimConfig });
    expect(result.signalsCurated).toBe(10);
    expect(result.signalsDropped).toBe(20);
  });

  it('updates watermark after run', async () => {
    await seedPortfolio();
    await signalArchive.append(makeSignal());

    expect(await curatedStore.getLatestWatermark()).toBeNull();
    await runCurationPipeline({ signalArchive, curatedStore, snapshotStore, config });

    const watermark = await curatedStore.getLatestWatermark();
    expect(watermark).not.toBeNull();
    expect(watermark!.signalsProcessed).toBe(1);
    expect(watermark!.signalsCurated).toBe(1);
  });
});
