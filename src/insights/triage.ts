/**
 * Triage — deterministic position scoring and classification.
 *
 * Scores each position by activity level and classifies into tiers:
 * - Hot:  full multi-agent deep analysis (top 25% or all if ≤ 15 positions)
 * - Warm: quick single-pass LLM rating (middle 50%)
 * - Cold: carry forward previous rating (bottom 25%, analyzed within last 3 runs)
 *
 * No LLM involved — pure code scoring.
 */

import type { DataBrief } from './data-gatherer.js';
import type { InsightReport, PositionInsight } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriageResult {
  hot: DataBrief[];
  warm: DataBrief[];
  cold: ColdPosition[];
}

export interface ColdPosition {
  brief: DataBrief;
  /** Carried-forward insight from previous report, if available. */
  previousInsight: PositionInsight | null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface ScoredBrief {
  brief: DataBrief;
  score: number;
}

function scorePosition(brief: DataBrief, previousReport: InsightReport | null): number {
  let score = 0;

  // 1. Price movement magnitude (bigger moves = more attention)
  const absChange = Math.abs(brief.changePercent ?? 0);
  if (absChange >= 5) score += 30;
  else if (absChange >= 2) score += 15;
  else if (absChange >= 1) score += 5;

  // 2. Signal count in last 7 days
  if (brief.signalCount >= 5) score += 25;
  else if (brief.signalCount >= 2) score += 15;
  else if (brief.signalCount >= 1) score += 5;

  // 3. Sentiment divergence from previous rating
  if (previousReport) {
    const prev = previousReport.positions.find((p) => p.symbol === brief.symbol);
    if (prev) {
      const prevBullish = prev.rating === 'STRONG_BUY' || prev.rating === 'BUY';
      const nowBearish = brief.sentimentDirection === 'BEARISH';
      const prevBearish = prev.rating === 'STRONG_SELL' || prev.rating === 'SELL';
      const nowBullish = brief.sentimentDirection === 'BULLISH';

      if ((prevBullish && nowBearish) || (prevBearish && nowBullish)) {
        score += 20; // Sentiment flip — needs re-evaluation
      }
    } else {
      score += 10; // New position, not in previous report
    }
  } else {
    score += 10; // No previous report — everything gets a baseline boost
  }

  // 4. Risk signals
  if (brief.riskSignals.length > 0) {
    score += Math.min(brief.riskSignals.length * 5, 15);
  }

  // 5. Mixed sentiment (conflicting signals need analysis)
  if (brief.sentimentDirection === 'MIXED') {
    score += 10;
  }

  // 6. P&L extremes
  const absPnl = Math.abs(brief.unrealizedPnlPercent);
  if (absPnl >= 20) score += 10;

  return score;
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

export function triagePositions(briefs: DataBrief[], previousReport: InsightReport | null): TriageResult {
  // Small portfolios: analyze everything
  if (briefs.length <= 15) {
    return { hot: briefs, warm: [], cold: [] };
  }

  // Score all positions
  const scored: ScoredBrief[] = briefs
    .map((brief) => ({ brief, score: scorePosition(brief, previousReport) }))
    .sort((a, b) => b.score - a.score);

  // Split by percentile
  const hotCount = Math.max(Math.ceil(briefs.length * 0.25), 5); // at least 5
  const coldCount = Math.max(Math.floor(briefs.length * 0.25), 0);
  const warmCount = briefs.length - hotCount - coldCount;

  const hot = scored.slice(0, hotCount).map((s) => s.brief);
  const warm = scored.slice(hotCount, hotCount + warmCount).map((s) => s.brief);
  const coldBriefs = scored.slice(hotCount + warmCount).map((s) => s.brief);

  // Build cold positions with carried-forward insights
  const prevBySymbol = new Map<string, PositionInsight>();
  if (previousReport) {
    for (const p of previousReport.positions) {
      prevBySymbol.set(p.symbol, p);
    }
  }

  const cold: ColdPosition[] = coldBriefs.map((brief) => ({
    brief,
    previousInsight: prevBySymbol.get(brief.symbol) ?? null,
  }));

  return { hot, warm, cold };
}
