/**
 * Signal Curation Pipeline — deterministic filtering, scoring, and ranking
 * of raw signals against the user's portfolio.
 *
 * Runs frequently (default every 15 min) with no LLM calls.
 * Reads raw signals incrementally via watermark, writes curated output
 * to CuratedSignalStore for downstream consumption (Insights, UI).
 */

import type { AssetClass } from '../../api/graphql/types.js';
import { createSubsystemLogger } from '../../logging/logger.js';
import type { PortfolioSnapshotStore } from '../../portfolio/snapshot-store.js';
import type { SignalArchive } from '../archive.js';
import type { PortfolioRelevanceScore, Signal, SignalType } from '../types.js';
import type { CuratedSignalStore } from './curated-signal-store.js';
import type { CuratedSignal, CurationConfig, CurationRunResult } from './types.js';

const logger = createSubsystemLogger('signal-curation');

// ---------------------------------------------------------------------------
// Type relevance lookup — (signalType, assetClass) → relevance score
// ---------------------------------------------------------------------------

const TYPE_RELEVANCE: Record<SignalType, Record<AssetClass, number>> = {
  NEWS: { EQUITY: 0.7, CRYPTO: 0.6, BOND: 0.5, COMMODITY: 0.5, CURRENCY: 0.5, OTHER: 0.5 },
  FUNDAMENTAL: { EQUITY: 0.9, CRYPTO: 0.3, BOND: 0.7, COMMODITY: 0.4, CURRENCY: 0.3, OTHER: 0.4 },
  SENTIMENT: { EQUITY: 0.5, CRYPTO: 0.8, BOND: 0.3, COMMODITY: 0.5, CURRENCY: 0.4, OTHER: 0.4 },
  TECHNICAL: { EQUITY: 0.6, CRYPTO: 0.7, BOND: 0.4, COMMODITY: 0.6, CURRENCY: 0.6, OTHER: 0.4 },
  MACRO: { EQUITY: 0.8, CRYPTO: 0.6, BOND: 0.9, COMMODITY: 0.8, CURRENCY: 0.9, OTHER: 0.6 },
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pipeline options
// ---------------------------------------------------------------------------

export interface CurationPipelineOptions {
  signalArchive: SignalArchive;
  curatedStore: CuratedSignalStore;
  snapshotStore: PortfolioSnapshotStore;
  config: CurationConfig;
}

// ---------------------------------------------------------------------------
// Scoring helpers (exported for testing)
// ---------------------------------------------------------------------------

export function computeExposureWeight(positionMarketValue: number, totalPortfolioValue: number): number {
  if (totalPortfolioValue <= 0) return 0;
  return Math.min(positionMarketValue / totalPortfolioValue, 1);
}

export function computeTypeRelevance(signalType: SignalType, assetClass: AssetClass): number {
  return TYPE_RELEVANCE[signalType]?.[assetClass] ?? 0.5;
}

export function computeRecencyFactor(publishedAt: string, now: number): number {
  const ageMs = now - new Date(publishedAt).getTime();
  if (ageMs <= 0) return 1;
  // Exponential decay with 7-day half-life: exp(-age / (7 days))
  return Math.exp(-ageMs / SEVEN_DAYS_MS);
}

export function computeSourceReliability(signal: Signal): number {
  if (signal.sources.length === 0) return 0.5;
  const sum = signal.sources.reduce((acc, s) => acc + s.reliability, 0);
  return sum / signal.sources.length;
}

export function computeCompositeScore(
  exposureWeight: number,
  typeRelevance: number,
  recencyFactor: number,
  sourceReliability: number,
  weights: CurationConfig['weights'],
): number {
  const raw =
    weights.exposure * exposureWeight +
    weights.typeRelevance * typeRelevance +
    weights.recency * recencyFactor +
    weights.sourceReliability * sourceReliability;
  return Math.max(0, Math.min(1, raw));
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runCurationPipeline(options: CurationPipelineOptions): Promise<CurationRunResult> {
  const start = Date.now();
  const { signalArchive, curatedStore, snapshotStore, config } = options;

  // 0. Get current portfolio
  const snapshot = await snapshotStore.getLatest();
  if (!snapshot || snapshot.positions.length === 0) {
    logger.info('No portfolio — skipping curation');
    return { signalsProcessed: 0, signalsCurated: 0, signalsDropped: 0, durationMs: Date.now() - start };
  }

  const portfolioTickers = new Set(snapshot.positions.map((p) => p.symbol));
  const positionByTicker = new Map(snapshot.positions.map((p) => [p.symbol, p]));

  // 1. LOAD — incremental via watermark
  const watermark = await curatedStore.getLatestWatermark();
  const since = watermark
    ? watermark.lastSignalIngestedAt.slice(0, 10)
    : new Date(Date.now() - SEVEN_DAYS_MS).toISOString().slice(0, 10);

  const rawSignals = await signalArchive.query({ tickers: [...portfolioTickers], since });

  if (rawSignals.length === 0) {
    logger.info('No new signals to curate');
    return { signalsProcessed: 0, signalsCurated: 0, signalsDropped: 0, durationMs: Date.now() - start };
  }

  // 2. FILTER — confidence, spam, portfolio match
  const spamRegexes = config.spamPatterns.map((p) => new RegExp(p, 'i'));

  const filtered = rawSignals.filter((signal) => {
    // Confidence threshold
    if (signal.confidence < config.minConfidence) return false;

    // Spam title patterns
    if (spamRegexes.some((rx) => rx.test(signal.title))) return false;

    // Must have at least one portfolio ticker
    return signal.assets.some((a) => portfolioTickers.has(a.ticker));
  });

  // 3. SCORE — compute PortfolioRelevanceScore per (signal, position)
  const now = Date.now();
  const curatedSignals: CuratedSignal[] = [];

  // Group scores by ticker for rank/trim
  const scoresByTicker = new Map<string, Array<{ signal: Signal; score: PortfolioRelevanceScore }>>();

  for (const signal of filtered) {
    const scores: PortfolioRelevanceScore[] = [];
    const reliability = computeSourceReliability(signal);
    const recency = computeRecencyFactor(signal.publishedAt, now);

    for (const asset of signal.assets) {
      const position = positionByTicker.get(asset.ticker);
      if (!position) continue;

      const exposure = computeExposureWeight(position.marketValue, snapshot.totalValue);
      const typeRel = computeTypeRelevance(signal.type, position.assetClass);
      const composite = computeCompositeScore(exposure, typeRel, recency, reliability, config.weights);

      const relevanceScore: PortfolioRelevanceScore = {
        signalId: signal.id,
        ticker: asset.ticker,
        exposureWeight: Number(exposure.toFixed(4)),
        typeRelevance: Number(typeRel.toFixed(4)),
        compositeScore: Number(composite.toFixed(4)),
      };

      scores.push(relevanceScore);

      // Track per-ticker for ranking
      const tickerGroup = scoresByTicker.get(asset.ticker);
      if (tickerGroup) {
        tickerGroup.push({ signal, score: relevanceScore });
      } else {
        scoresByTicker.set(asset.ticker, [{ signal, score: relevanceScore }]);
      }
    }

    if (scores.length > 0) {
      curatedSignals.push({
        signal,
        scores,
        curatedAt: new Date().toISOString(),
      });
    }
  }

  // 4. RANK & TRIM — top N per position, then deduplicate
  const keptSignalIds = new Set<string>();

  for (const [, entries] of scoresByTicker) {
    // Sort by composite score descending (stable sort)
    entries.sort((a, b) => b.score.compositeScore - a.score.compositeScore);

    // Keep top N
    const topN = entries.slice(0, config.topNPerPosition);
    for (const entry of topN) {
      keptSignalIds.add(entry.signal.id);
    }
  }

  const finalCurated = curatedSignals.filter((cs) => keptSignalIds.has(cs.signal.id));

  // 5. STORE — write curated signals + update watermark
  await curatedStore.writeBatch(finalCurated);

  // Find the latest ingestedAt for watermark
  const latestIngestedAt = rawSignals.reduce(
    (latest, s) => (s.ingestedAt > latest ? s.ingestedAt : latest),
    watermark?.lastSignalIngestedAt ?? rawSignals[0].ingestedAt,
  );

  await curatedStore.saveWatermark({
    lastRunAt: new Date().toISOString(),
    lastSignalIngestedAt: latestIngestedAt,
    signalsProcessed: rawSignals.length,
    signalsCurated: finalCurated.length,
  });

  const result: CurationRunResult = {
    signalsProcessed: rawSignals.length,
    signalsCurated: finalCurated.length,
    signalsDropped: rawSignals.length - finalCurated.length,
    durationMs: Date.now() - start,
  };

  logger.info('Curation pipeline complete', result);
  return result;
}
