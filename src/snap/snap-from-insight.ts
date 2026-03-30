/**
 * Derive a Snap brief from the latest InsightReport.
 *
 * The snap surfaces the action items from the insight report —
 * concrete next steps the user should consider. When micro insights
 * are available, per-asset snaps are included alongside portfolio-level items.
 */

import { randomUUID } from 'node:crypto';

import type { Snap } from './types.js';
import type { MicroInsight } from '../insights/micro-types.js';
import type { InsightReport } from '../insights/types.js';

export interface SnapFromInsightOptions {
  /** Latest micro insights per ticker — used to populate assetSnaps. */
  microInsights?: Map<string, MicroInsight>;
}

/** Derive a Snap from an InsightReport + optional micro insights. */
export function snapFromInsight(report: InsightReport, options?: SnapFromInsightOptions): Snap {
  const assetSnaps = options?.microInsights
    ? [...options.microInsights.values()]
        .filter((mi) => mi.assetSnap.length > 0)
        .map((mi) => ({
          symbol: mi.symbol,
          snap: mi.assetSnap,
          rating: mi.rating,
          generatedAt: mi.generatedAt,
        }))
    : [];

  return {
    id: `snap-${randomUUID().slice(0, 8)}`,
    generatedAt: new Date().toISOString(),
    intelSummary: report.portfolio.intelSummary ?? '',
    actionItems: report.portfolio.actionItems.map((item) => ({
      text: item.text,
      signalIds: item.signalIds,
    })),
    assetSnaps,
  };
}
