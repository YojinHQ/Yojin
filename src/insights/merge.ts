/**
 * Merge — combines hot/warm insights from LLM with carried-forward cold positions.
 *
 * After the Strategist saves an InsightReport (covering hot + warm positions),
 * this module merges in cold positions from the previous report, marking them
 * with `carriedForward: true`. The merged report is saved as the final output.
 */

import type { InsightStore } from './insight-store.js';
import type { ColdPosition } from './triage.js';
import type { InsightReport, PositionInsight } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('insight-merge');

/**
 * Merge cold positions into the latest InsightReport.
 *
 * - Reads the latest report (just saved by Strategist's save_insight_report call).
 * - For each cold position with a previous insight, adds it with `carriedForward: true`.
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

  // Build carried-forward insights
  const carriedForward: PositionInsight[] = [];
  for (const cold of coldPositions) {
    if (existingSymbols.has(cold.brief.symbol)) continue;
    if (!cold.previousInsight) continue;

    carriedForward.push({
      ...cold.previousInsight,
      carriedForward: true,
    });
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
