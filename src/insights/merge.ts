/**
 * Merge — combines hot/warm insights from LLM with carried-forward cold positions.
 *
 * After the Strategist saves an InsightReport (covering hot + warm positions),
 * this module merges in cold positions from the previous report, marking them
 * with `carriedForward: true`. Cold positions with no previous insight get a
 * minimal baseline so every portfolio position always has an AI Analysis entry.
 */

import type { InsightStore } from './insight-store.js';
import type { ColdPosition } from './triage.js';
import type { InsightReport, PositionInsight } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('insight-merge');

/** Build a minimal baseline insight for a cold position with no history. */
function buildBaselineInsight(cold: ColdPosition): PositionInsight {
  const { brief } = cold;
  return {
    symbol: brief.symbol,
    name: brief.name,
    rating: 'NEUTRAL',
    conviction: 0.3,
    thesis: 'Awaiting deeper analysis — low recent activity.',
    keySignals: [],
    allSignalIds: [],
    risks: [],
    opportunities: [],
    memoryContext: null,
    priceTarget: null,
    carriedForward: true,
  };
}

/**
 * Merge cold positions into the latest InsightReport.
 *
 * - Reads the latest report (just saved by Strategist's save_insight_report call).
 * - For each cold position with a previous insight, adds it with `carriedForward: true`.
 * - For cold positions with NO previous insight, adds a minimal baseline insight.
 * - Skips cold positions already present in the report (the Strategist may have included some).
 * - Saves the merged report as a new entry (append-only).
 *
 * Returns the merged report, or null if no report was found.
 */
export async function mergeColdPositions(
  insightStore: InsightStore,
  coldPositions: ColdPosition[],
): Promise<InsightReport | null> {
  if (coldPositions.length === 0) return null;

  const report = await insightStore.getLatest();
  if (!report) {
    logger.warn('No report found to merge cold positions into');
    return null;
  }

  // Index existing positions by symbol
  const existingSymbols = new Set(report.positions.map((p) => p.symbol));

  // Build carried-forward insights (with baseline for positions that have no history)
  const carriedForward: PositionInsight[] = [];
  for (const cold of coldPositions) {
    if (existingSymbols.has(cold.brief.symbol)) continue;

    if (cold.previousInsight) {
      carriedForward.push({
        ...cold.previousInsight,
        carriedForward: true,
      });
    } else {
      carriedForward.push(buildBaselineInsight(cold));
    }
  }

  if (carriedForward.length === 0) {
    logger.info('No cold positions to merge — all already in report or missing previous insights');
    return report;
  }

  // Merge: existing positions + carried-forward cold positions
  const mergedReport: InsightReport = {
    ...report,
    id: `${report.id}-merged`,
    positions: [...report.positions, ...carriedForward],
  };

  await insightStore.save(mergedReport);
  logger.info('Merged cold positions into report', {
    originalPositions: report.positions.length,
    carriedForward: carriedForward.length,
    totalPositions: mergedReport.positions.length,
  });

  return mergedReport;
}
