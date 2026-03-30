/**
 * Derive a Snap brief from the latest InsightReport.
 *
 * The snap surfaces the action items from the insight report —
 * concrete next steps the user should consider.
 */

import { randomUUID } from 'node:crypto';

import type { Snap } from './types.js';
import type { InsightReport } from '../insights/types.js';

/** Derive a Snap from an InsightReport. */
export function snapFromInsight(report: InsightReport): Snap {
  return {
    id: `snap-${randomUUID().slice(0, 8)}`,
    generatedAt: new Date().toISOString(),
    intelSummary: report.portfolio.intelSummary ?? '',
    actionItems: report.portfolio.actionItems.map((item) => ({
      text: item.text,
      signalIds: item.signalIds,
    })),
  };
}
