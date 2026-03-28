/**
 * Derive a Snap brief from the latest InsightReport.
 *
 * The snap answers: "What deserves my attention right now?"
 * It extracts the portfolio summary, top risks, action items,
 * and position-level attention items from the insight report.
 */

import { randomUUID } from 'node:crypto';

import type { Snap, SnapAttentionItem, SnapSeverity } from './types.js';
import type { InsightReport } from '../insights/types.js';

const BEARISH_RATINGS = new Set(['BEARISH', 'VERY_BEARISH']);

/**
 * Map insight report data into attention items for the snap.
 * - Top risks → HIGH severity
 * - Action items → MEDIUM severity
 * - Bearish position ratings → MEDIUM severity
 * - Top opportunities → LOW severity
 */
function buildAttentionItems(report: InsightReport): SnapAttentionItem[] {
  const items: SnapAttentionItem[] = [];

  // Top risks are the most urgent
  for (const risk of report.portfolio.topRisks.slice(0, 3)) {
    items.push({ label: risk.text, severity: 'HIGH' as SnapSeverity });
  }

  // Action items need attention
  for (const action of report.portfolio.actionItems.slice(0, 2)) {
    items.push({ label: action.text, severity: 'MEDIUM' as SnapSeverity });
  }

  // Bearish positions need attention
  for (const pos of report.positions) {
    if (BEARISH_RATINGS.has(pos.rating)) {
      items.push({
        label: `${pos.symbol} rated ${pos.rating} (conviction ${Math.round(pos.conviction * 100)}%)`,
        severity: 'MEDIUM' as SnapSeverity,
        ticker: pos.symbol,
      });
    }
  }

  // Top opportunities are FYI
  for (const opp of report.portfolio.topOpportunities.slice(0, 2)) {
    items.push({ label: opp.text, severity: 'LOW' as SnapSeverity });
  }

  // Cap at 5 items — dashboard card has limited space.
  // HIGH-severity items come first, so the most urgent are always shown.
  return items.slice(0, 5);
}

/** Derive a Snap from an InsightReport. */
export function snapFromInsight(report: InsightReport): Snap {
  const tickers = report.positions.map((p) => p.symbol);

  return {
    id: `snap-${randomUUID().slice(0, 8)}`,
    generatedAt: new Date().toISOString(),
    summary: report.portfolio.summary,
    attentionItems: buildAttentionItems(report),
    portfolioTickers: tickers,
  };
}
