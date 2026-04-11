/**
 * Summary data model — neutral intel observations produced by the insight
 * pipelines (macro + micro). Summaries are NOT opinionated — they do not
 * contain BUY/SELL recommendations and have no approval lifecycle. They are
 * the Intel Feed content layer.
 *
 * Summaries NEVER come from Strategies — strategy-triggered records are
 * Actions and live in src/actions/. If a producer mentions strategyId, it's
 * writing to the wrong store.
 *
 * Storage: append-only JSONL in data/summaries/ (date-partitioned).
 * GraphQL: Summary type in schema.ts.
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { DateTimeField, IdField, ScoreRange } from '../types/base.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Which flow produced this summary. */
export const SummaryFlowSchema = z.enum(['MACRO', 'MICRO']);
export type SummaryFlow = z.infer<typeof SummaryFlowSchema>;

/**
 * Sentinel ticker used for portfolio-wide summaries (cross-cutting risks,
 * opportunities, action items that span multiple positions or macro themes).
 * Producers must only use this for genuinely cross-cutting observations;
 * single-ticker content belongs under that ticker. The display layer strips
 * this bucket to avoid rendering the sentinel as a fake tradeable symbol.
 */
export const PORTFOLIO_TICKER = 'PORTFOLIO';

// ---------------------------------------------------------------------------
// Summary — the core entity
// ---------------------------------------------------------------------------

export const SummarySchema = z.object({
  id: IdField,
  /** Ticker this observation is about. Portfolio-wide summaries use 'PORTFOLIO'. */
  ticker: z.string().min(1),
  /** One-line neutral observation: "Truist cuts AAPL PT to $323". */
  what: z.string().min(1),
  /** Which pipeline emitted this summary. */
  flow: SummaryFlowSchema,
  /** Optional 0–1 priority score — used for ranking in the Intel Feed. */
  severity: ScoreRange.optional(),
  /** Signals this observation was derived from (for traceability). */
  sourceSignalIds: z.array(IdField).default([]),
  /**
   * Stable dedup hash: sha256(`${ticker}|${flow}|${normalizedWhat}`).
   * Two summaries with the same contentHash within the dedup window are
   * treated as duplicates — the newer one wins, the older one is skipped.
   */
  contentHash: z.string().min(1),
  createdAt: DateTimeField,
});
export type Summary = z.infer<typeof SummarySchema>;

/**
 * Compute the stable content hash for a summary. Used for dedup so the same
 * observation arriving from micro and then macro doesn't double-fire in the
 * Intel Feed.
 */
export function computeSummaryContentHash(ticker: string, flow: SummaryFlow, what: string): string {
  const normalized = what.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(`${ticker.toUpperCase()}|${flow}|${normalized}`).digest('hex');
}
