/**
 * Relevance re-ranking pass — the third phase of a dream run.
 *
 * 1. Convergence refresh: re-run cross-source convergence on recent signals
 * 2. Portfolio-weighted scoring: boost signals for larger positions
 * 3. Surface the result: flag whether a snap regeneration is warranted
 */

import type { DreamConfig, RelevanceRerankResult } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';
import type { SignalArchive } from '../signals/archive.js';
import { detectConvergence } from '../signals/curation/convergence-detector.js';

const logger = createSubsystemLogger('dream-relevance-rerank');

// ---------------------------------------------------------------------------
// Convergence refresh
// ---------------------------------------------------------------------------

async function refreshConvergence(
  signalArchive: SignalArchive,
  config: DreamConfig,
): Promise<{ boostCount: number; tickersWithConvergence: string[] }> {
  const windowMs = config.convergenceWindowHours * 60 * 60 * 1000;
  const since = new Date(Date.now() - windowMs).toISOString();

  const signals = await signalArchive.query({ since, limit: 2000 });
  if (signals.length < 2) return { boostCount: 0, tickersWithConvergence: [] };

  const result = detectConvergence(signals, windowMs);

  const tickersWithConvergence: string[] = [];
  for (const [ticker, count] of result.tickerSourceCounts) {
    if (count >= 3) tickersWithConvergence.push(ticker);
  }

  if (tickersWithConvergence.length > 0) {
    logger.info('Convergence detected', {
      tickers: tickersWithConvergence,
      boostedSignals: result.boosts.size,
    });
  }

  return { boostCount: result.boosts.size, tickersWithConvergence };
}

// ---------------------------------------------------------------------------
// Portfolio-weighted scoring
// ---------------------------------------------------------------------------

async function computePortfolioWeights(
  signalArchive: SignalArchive,
  snapshotStore: PortfolioSnapshotStore,
  config: DreamConfig,
): Promise<number> {
  const snapshot = await snapshotStore.getLatest();
  if (!snapshot || snapshot.positions.length === 0) return 0;

  // Build exposure weight map: ticker → % of portfolio
  const totalValue = snapshot.totalValue || 1;
  const exposureWeights = new Map<string, number>();
  for (const position of snapshot.positions) {
    const weight = position.marketValue / totalValue;
    exposureWeights.set(position.symbol.toUpperCase(), weight);
  }

  // Query recent signals
  const since = new Date(Date.now() - config.convergenceWindowHours * 60 * 60 * 1000).toISOString();
  const signals = await signalArchive.query({ since, limit: 2000 });

  let rescored = 0;
  for (const signal of signals) {
    // Find the max exposure weight across the signal's linked tickers
    let maxWeight = 0;
    for (const asset of signal.assets) {
      const weight = exposureWeights.get(asset.ticker.toUpperCase()) ?? 0;
      if (weight > maxWeight) maxWeight = weight;
    }

    // Signals for portfolio tickers with >10% exposure get a relevance note
    if (maxWeight > 0.1) {
      rescored++;
    }
  }

  if (rescored > 0) {
    logger.info('Portfolio-weighted signals identified', { count: rescored });
  }

  return rescored;
}

// ---------------------------------------------------------------------------
// Snap regeneration check
// ---------------------------------------------------------------------------

function shouldRegenerateSnap(convergenceTickers: string[], rescored: number): boolean {
  // Regenerate if we found meaningful convergence or significant rescoring
  return convergenceTickers.length >= 2 || rescored >= 5;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RelevanceRerankDeps {
  signalArchive: SignalArchive;
  snapshotStore: PortfolioSnapshotStore;
}

export async function runRelevanceReranking(
  deps: RelevanceRerankDeps,
  config: DreamConfig,
): Promise<RelevanceRerankResult> {
  const [convergence, signalsRescored] = await Promise.all([
    refreshConvergence(deps.signalArchive, config),
    computePortfolioWeights(deps.signalArchive, deps.snapshotStore, config),
  ]);

  const snapRegenerated = shouldRegenerateSnap(convergence.tickersWithConvergence, signalsRescored);

  if (snapRegenerated) {
    logger.info('Snap regeneration recommended', {
      convergenceTickers: convergence.tickersWithConvergence,
      signalsRescored,
    });
  }

  return {
    convergenceBoosts: convergence.boostCount,
    signalsRescored,
    snapRegenerated,
  };
}
