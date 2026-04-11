/**
 * Pure transform from an InsightReport to the Summary records the macro flow
 * should persist. Extracted from the scheduler so the placement contract
 * (which field goes under which ticker) can be unit-tested without spinning
 * up the full workflow.
 *
 * Placement rules:
 *  - `positions[].thesis` → Summary under the real ticker, severity = conviction.
 *  - `positions[].risks[]` / `opportunities[]` → Summaries under the real ticker,
 *    severity = null (they sort below the headline thesis).
 *  - `portfolio.topRisks[]` / `topOpportunities[]` / `actionItems[]` → Summaries
 *    under the PORTFOLIO_TICKER sentinel. These MUST be cross-cutting or
 *    portfolio-wide only — single-ticker content belongs on the position.
 *    The workflow prompt asks the LLM to honour this; the display layer
 *    strips the sentinel bucket as a final backstop.
 */

import type { InsightReport, PositionInsight } from './types.js';
import { PORTFOLIO_TICKER, type Summary, computeSummaryContentHash } from '../summaries/types.js';

/** Summary record minus the randomly-generated id, which is assigned by the caller. */
export type MacroSummaryInput = Omit<Summary, 'id'>;

/**
 * Extract the first sentence from a multi-sentence thesis, capped at a
 * reasonable display length. Used when flattening a position thesis into a
 * one-line Summary observation.
 */
export function firstSentence(text: string, maxLen = 240): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^[^.!?]*[.!?]/);
  const candidate = match ? match[0].trim() : trimmed;
  return candidate.length <= maxLen ? candidate : candidate.slice(0, maxLen - 1) + '…';
}

function buildPositionSummaries(position: PositionInsight, createdAt: string): MacroSummaryInput[] {
  const ticker = position.symbol.toUpperCase();
  const sourceSignalIds = [...new Set(position.keySignals.map((s) => s.signalId).concat(position.allSignalIds))];
  const out: MacroSummaryInput[] = [];

  // Headline thesis — one Summary, severity = conviction so it sorts to the
  // top of the per-ticker bucket in the Intel Feed.
  const thesis = firstSentence(position.thesis);
  if (thesis) {
    out.push({
      ticker,
      what: thesis,
      flow: 'MACRO',
      severity: position.conviction,
      sourceSignalIds,
      contentHash: computeSummaryContentHash(ticker, 'MACRO', thesis),
      createdAt,
    });
  }

  // Ticker-specific risks/opportunities flow to the Summaries feed under
  // the real ticker (not the PORTFOLIO sentinel). Severity is left unset so
  // they rank below the headline thesis within the bucket — the user sees
  // the thesis first and the supporting observations on expand.
  for (const risk of position.risks) {
    const what = risk.trim();
    if (!what) continue;
    out.push({
      ticker,
      what,
      flow: 'MACRO',
      sourceSignalIds,
      contentHash: computeSummaryContentHash(ticker, 'MACRO', what),
      createdAt,
    });
  }
  for (const opportunity of position.opportunities) {
    const what = opportunity.trim();
    if (!what) continue;
    out.push({
      ticker,
      what,
      flow: 'MACRO',
      sourceSignalIds,
      contentHash: computeSummaryContentHash(ticker, 'MACRO', what),
      createdAt,
    });
  }

  return out;
}

/**
 * Produce every Summary record that `persistMacroSummaries` should write for a
 * given InsightReport. Deterministic and side-effect-free — the caller is
 * responsible for assigning ids and calling `summaryStore.create`.
 */
export function buildMacroSummaryInputs(report: InsightReport): MacroSummaryInput[] {
  const createdAt = report.createdAt;
  const out: MacroSummaryInput[] = [];

  for (const position of report.positions) {
    out.push(...buildPositionSummaries(position, createdAt));
  }

  // Portfolio-level items: cross-cutting risks/opportunities/actions. Filed
  // under the PORTFOLIO_TICKER sentinel so they can be routed to a separate
  // "portfolio-wide" surface later without colliding with real tickers.
  const portfolioItems = [
    ...report.portfolio.topRisks,
    ...report.portfolio.topOpportunities,
    ...report.portfolio.actionItems,
  ];
  for (const item of portfolioItems) {
    const what = item.text.trim();
    if (!what) continue;
    out.push({
      ticker: PORTFOLIO_TICKER,
      what,
      flow: 'MACRO',
      sourceSignalIds: item.signalIds ?? [],
      contentHash: computeSummaryContentHash(PORTFOLIO_TICKER, 'MACRO', what),
      createdAt,
    });
  }

  return out;
}
