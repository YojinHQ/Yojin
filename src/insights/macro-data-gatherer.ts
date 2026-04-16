/**
 * Macro Data Gatherer — reads micro research outputs for portfolio-wide synthesis.
 *
 * When micro insights exist, the macro workflow reads pre-computed per-asset
 * analysis instead of raw data. This reduces LLM cost and latency since
 * micro already did the heavy per-asset analysis.
 *
 * Falls back to the existing data-gatherer flow when micro insights aren't available.
 */

import type { DataBrief, DataGathererOptions } from './data-gatherer.js';
import { formatBriefsForContext, formatRiskMetrics, gatherDataBriefs } from './data-gatherer.js';
import type { MicroInsightStore } from './micro-insight-store.js';
import type { MicroInsight } from './micro-types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';

const logger = createSubsystemLogger('macro-data-gatherer');

export interface MacroGathererOptions {
  microInsightStore: MicroInsightStore;
  snapshotStore: PortfolioSnapshotStore;
  /** Fallback to raw data gathering when micro insights are unavailable. */
  fallbackGathererOptions?: DataGathererOptions;
}

export interface MacroGathererResult {
  /** Formatted micro insight summaries for LLM context. */
  microSummaries: string;
  /** Pre-computed portfolio-level risk metrics. */
  riskMetrics: string;
  /** Snapshot ID for the insight report. */
  snapshotId: string;
  /** Number of positions with micro insights. */
  microCoverage: number;
  /** Total positions in portfolio. */
  totalPositions: number;
  /** Duration of the gather step in ms. */
  gatherDurationMs: number;
  /** Whether we fell back to raw data gathering. */
  usedFallback: boolean;
  /** Raw briefs (only present when using fallback). */
  briefs?: DataBrief[];
  /** Portfolio ticker symbols — used for boundary enforcement in LLM prompts. */
  portfolioTickers: string[];
}

/**
 * Gather macro data by reading micro research outputs.
 * Falls back to full data gathering if micro coverage is insufficient.
 */
export async function gatherMacroData(options: MacroGathererOptions): Promise<MacroGathererResult | null> {
  const start = Date.now();
  const { microInsightStore, snapshotStore, fallbackGathererOptions } = options;

  const snapshot = await snapshotStore.getLatest();
  if (!snapshot || snapshot.positions.length === 0) {
    logger.warn('No portfolio snapshot — cannot gather macro data');
    return null;
  }

  const snapshotId = snapshot.id;
  const totalPositions = snapshot.positions.length;
  const portfolioTickers = snapshot.positions.map((p) => p.symbol);

  // Read all latest micro insights
  const microInsights = await microInsightStore.getAllLatest();
  const microCoverage = microInsights.size;

  // If we have micro insights for at least half the portfolio, use them
  const coverageThreshold = Math.ceil(totalPositions / 2);
  if (microCoverage >= coverageThreshold) {
    logger.info('Using micro insights for macro analysis', {
      microCoverage,
      totalPositions,
      coveragePercent: Math.round((microCoverage / totalPositions) * 100),
    });

    const microSummaries = formatMicroInsightsForContext(microInsights, snapshot.positions);
    const riskMetrics = formatPortfolioRiskFromMicro(microInsights, snapshot);

    return {
      microSummaries,
      riskMetrics,
      snapshotId,
      microCoverage,
      totalPositions,
      gatherDurationMs: Date.now() - start,
      usedFallback: false,
      portfolioTickers,
    };
  }

  // Fallback: not enough micro coverage, use traditional data gathering
  if (fallbackGathererOptions) {
    logger.info('Insufficient micro coverage — falling back to raw data gathering', {
      microCoverage,
      totalPositions,
      threshold: coverageThreshold,
    });

    const result = await gatherDataBriefs(fallbackGathererOptions);
    // Derive tickers from the briefs the fallback actually analyzed — not
    // the snapshot read above, which may have changed between reads.
    const fallbackTickers = result.briefs.map((b) => b.symbol);
    return {
      microSummaries: formatBriefsForContext(result.briefs),
      riskMetrics: formatRiskMetrics(result.briefs),
      snapshotId: result.snapshotId,
      microCoverage,
      totalPositions,
      gatherDurationMs: Date.now() - start,
      usedFallback: true,
      briefs: result.briefs,
      portfolioTickers: fallbackTickers,
    };
  }

  logger.warn('Insufficient micro coverage and no fallback gatherer configured');
  return null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

interface PositionLike {
  symbol: string;
  marketValue: number;
  quantity: number;
  currentPrice: number;
}

/**
 * Format micro insights as compact markdown for the macro LLM context.
 * Groups by rating to help the Strategist spot patterns quickly.
 */
function formatMicroInsightsForContext(insights: Map<string, MicroInsight>, positions: PositionLike[]): string {
  const lines: string[] = ['## Per-Asset Micro Research (pre-computed)\n'];

  // Build a weight map from positions
  const totalValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const weightMap = new Map<string, number>();
  for (const p of positions) {
    weightMap.set(p.symbol.toUpperCase(), totalValue > 0 ? p.marketValue / totalValue : 0);
  }

  // Sort by conviction descending (most opinionated first)
  const sorted = [...insights.values()].sort((a, b) => b.conviction - a.conviction);

  for (const mi of sorted) {
    const weight = weightMap.get(mi.symbol) ?? 0;
    const weightPct = (weight * 100).toFixed(1);

    lines.push(`### ${mi.symbol} — ${mi.name}`);
    lines.push(
      `Rating: ${mi.rating} | Conviction: ${(mi.conviction * 100).toFixed(0)}% | Sentiment: ${mi.sentiment} | Weight: ${weightPct}%`,
    );
    lines.push(`Thesis: ${mi.thesis}`);

    if (mi.keyDevelopments.length > 0) {
      lines.push('Key developments:');
      for (const d of mi.keyDevelopments) lines.push(`  - ${d}`);
    }

    if (mi.risks.length > 0) {
      lines.push(`Risks: ${mi.risks.join('; ')}`);
    }
    if (mi.opportunities.length > 0) {
      lines.push(`Opportunities: ${mi.opportunities.join('; ')}`);
    }

    if (mi.assetSnap) {
      lines.push(`Notable: ${mi.assetSnap}`);
    }

    lines.push(`Signals: ${mi.signalCount} | Generated: ${mi.generatedAt}`);
    lines.push('');
  }

  // List positions without micro coverage
  const coveredSymbols = new Set(insights.keys());
  const uncovered = positions.filter((p) => !coveredSymbols.has(p.symbol.toUpperCase()));
  if (uncovered.length > 0) {
    lines.push('### Positions without micro research:');
    for (const p of uncovered) {
      lines.push(`- ${p.symbol}: no micro analysis available`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Compute portfolio-level risk metrics from micro insights + snapshot.
 */
function formatPortfolioRiskFromMicro(
  insights: Map<string, MicroInsight>,
  snapshot: { positions: PositionLike[]; totalValue: number },
): string {
  const { positions, totalValue } = snapshot;
  const lines: string[] = ['## Portfolio Risk Metrics (from micro research)\n'];

  // Rating distribution
  const ratingCounts = new Map<string, number>();
  for (const mi of insights.values()) {
    ratingCounts.set(mi.rating, (ratingCounts.get(mi.rating) ?? 0) + 1);
  }
  lines.push('Rating distribution:');
  for (const [rating, count] of ratingCounts) {
    lines.push(`  ${rating}: ${count}`);
  }

  // Weighted sentiment
  const sentimentWeights = { VERY_BULLISH: 2, BULLISH: 1, NEUTRAL: 0, BEARISH: -1, VERY_BEARISH: -2 };
  let weightedSentiment = 0;
  let totalWeight = 0;
  for (const pos of positions) {
    const mi = insights.get(pos.symbol.toUpperCase());
    if (!mi) continue;
    const weight = totalValue > 0 ? pos.marketValue / totalValue : 0;
    weightedSentiment += (sentimentWeights[mi.rating] ?? 0) * weight;
    totalWeight += weight;
  }
  if (totalWeight > 0) {
    const normalized = weightedSentiment / totalWeight;
    lines.push(`\nWeighted portfolio sentiment: ${normalized.toFixed(2)} (-2 = very bearish, +2 = very bullish)`);
  }

  // Concentration (HHI)
  const weights = positions.map((p) => (totalValue > 0 ? p.marketValue / totalValue : 0));
  const hhi = weights.reduce((sum, w) => sum + w * w, 0);
  lines.push(`\nConcentration (HHI): ${(hhi * 10000).toFixed(0)} (10000 = single position)`);

  // Average conviction
  const convictions = [...insights.values()].map((mi) => mi.conviction);
  if (convictions.length > 0) {
    const avgConviction = convictions.reduce((a, b) => a + b, 0) / convictions.length;
    lines.push(`Average micro conviction: ${(avgConviction * 100).toFixed(0)}%`);
  }

  return lines.join('\n');
}
