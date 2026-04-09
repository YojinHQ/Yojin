/**
 * Micro action severity — the ranking signal used to decide whether a micro
 * observation should be promoted into an Action (and supersede older pending
 * ones for the same ticker).
 *
 * Severity acts as priority: 1 = critical, 0 = noise. Source of truth is the
 * LLM-emitted `severity` field on MicroInsight (the analyzer prompt walks the
 * model through a 0–1 calibration ladder). For back-compat with insights
 * written before that field existed, we fall back to a derived formula
 * (conviction × rating multiplier) — same heuristic we used pre-PR.
 */

import type { InsightRating } from '../insights/types.js';

/**
 * Fallback multiplier per rating, used only when a MicroInsight lacks an
 * LLM-emitted severity (older JSONL files). Extremes (VERY_*) dominate,
 * directional takes a modest bump, NEUTRAL is damped — neutral 90% conviction
 * shouldn't outrank a BEARISH 70% conviction on the same ticker.
 */
const RATING_MULTIPLIER: Record<InsightRating, number> = {
  VERY_BULLISH: 1.0,
  VERY_BEARISH: 1.0,
  BULLISH: 0.7,
  BEARISH: 0.7,
  NEUTRAL: 0.4,
};

export interface SeverityInput {
  rating: InsightRating;
  conviction: number;
  severity?: number;
}

/**
 * Score a micro insight on 0–1. Prefers the LLM-emitted `severity` field;
 * falls back to `conviction × rating multiplier` when absent.
 */
export function computeMicroActionSeverity(insight: SeverityInput): number {
  if (typeof insight.severity === 'number') {
    return clamp01(insight.severity);
  }
  const multiplier = RATING_MULTIPLIER[insight.rating] ?? 0.4;
  return clamp01(insight.conviction * multiplier);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Canonical `source` field value for an action emitted by the micro runner. */
export function microActionSource(ticker: string): string {
  return `micro-observation: ${ticker.toUpperCase()}`;
}
