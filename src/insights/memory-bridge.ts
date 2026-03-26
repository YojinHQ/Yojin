/**
 * Memory Bridge — converts ProcessInsights output into signal memories
 * for future reflection and feedback loops.
 *
 * After each insights run, each position's rating and thesis are stored
 * as a MemoryEntry tagged with 'insight'. After 7 days, the ReflectionEngine
 * grades these against actual price movement and generates lessons that
 * feed back into future runs via MemoryBrief.
 */

import type { InsightReport } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { SignalMemoryStore } from '../memory/memory-store.js';

const logger = createSubsystemLogger('memory-bridge');

/**
 * Store each position insight as a signal memory for future reflection.
 * Skips carried-forward positions (they were already stored in a prior run).
 */
export async function storeInsightMemories(
  report: InsightReport,
  store: SignalMemoryStore,
): Promise<{ stored: number; skipped: number }> {
  let stored = 0;
  let skipped = 0;

  for (const position of report.positions) {
    // Skip carried-forward positions — they were stored when originally analyzed
    if (position.carriedForward) {
      skipped++;
      continue;
    }

    const situation =
      `Portfolio insight for ${position.symbol}: ` +
      `${position.keySignals.length} key signals, ` +
      `sentiment ${position.keySignals.map((s) => s.impact).join('/')}.`;

    const recommendation =
      `${position.rating} (conviction: ${position.conviction.toFixed(2)}). ` + `Thesis: ${position.thesis}`;

    try {
      await store.store({
        tickers: [position.symbol],
        situation,
        recommendation,
        confidence: position.conviction,
      });
      stored++;
    } catch (err) {
      logger.warn('Failed to store insight memory', {
        symbol: position.symbol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Insight memories stored', { stored, skipped, reportId: report.id });
  return { stored, skipped };
}
