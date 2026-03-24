/**
 * Insight data model — structured output from the ProcessInsights workflow.
 *
 * An InsightReport is produced when the multi-agent pipeline (Research Analyst →
 * Risk Manager → Strategist) analyzes the full portfolio against recent signals.
 * Each report contains per-position insights and portfolio-level synthesis.
 *
 * Storage: append-only JSONL at data/insights/reports.jsonl.
 * All types are Zod schemas — the single source of truth for validation and inference.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const InsightRatingSchema = z.enum(['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL']);
export type InsightRating = z.infer<typeof InsightRatingSchema>;

export const PortfolioHealthSchema = z.enum(['STRONG', 'HEALTHY', 'CAUTIOUS', 'WEAK', 'CRITICAL']);
export type PortfolioHealth = z.infer<typeof PortfolioHealthSchema>;

export const SignalImpactSchema = z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL']);
export type SignalImpact = z.infer<typeof SignalImpactSchema>;

// ---------------------------------------------------------------------------
// SignalSummary — condensed signal reference within an insight
// ---------------------------------------------------------------------------

export const SignalSummarySchema = z.object({
  signalId: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  impact: SignalImpactSchema,
  confidence: z.number().min(0).max(1),
  url: z.string().nullable().optional(),
});
export type SignalSummary = z.infer<typeof SignalSummarySchema>;

// ---------------------------------------------------------------------------
// PositionInsight — per-position analysis output
// ---------------------------------------------------------------------------

export const PositionInsightSchema = z.object({
  symbol: z.string().min(1),
  name: z.string(),
  rating: InsightRatingSchema,
  conviction: z.number().min(0).max(1),
  thesis: z.string().min(1),
  keySignals: z.array(SignalSummarySchema),
  risks: z.array(z.string().min(1)),
  opportunities: z.array(z.string().min(1)),
  memoryContext: z.string().nullable(),
  priceTarget: z.number().nullable(),
  /** True when this insight was carried forward from a previous report (cold position). */
  carriedForward: z.boolean().optional(),
});
export type PositionInsight = z.infer<typeof PositionInsightSchema>;

// ---------------------------------------------------------------------------
// PortfolioItem — structured portfolio-level item with signal references
// ---------------------------------------------------------------------------

export const PortfolioItemSchema = z.object({
  text: z.string().min(1),
  signalIds: z.array(z.string()).default([]),
});
export type PortfolioItem = z.infer<typeof PortfolioItemSchema>;

/** Parse legacy `string[]` or new `PortfolioItem[]` for backward compatibility. */
function portfolioItemArray() {
  return z
    .array(z.union([z.string(), PortfolioItemSchema]))
    .transform((items) => items.map((item) => (typeof item === 'string' ? { text: item, signalIds: [] } : item)));
}

// ---------------------------------------------------------------------------
// PortfolioInsight — portfolio-level synthesis
// ---------------------------------------------------------------------------

export const PortfolioInsightSchema = z.object({
  overallHealth: PortfolioHealthSchema,
  summary: z.string().min(1),
  sectorThemes: z.array(z.string()),
  macroContext: z.string(),
  topRisks: portfolioItemArray(),
  topOpportunities: portfolioItemArray(),
  actionItems: portfolioItemArray(),
});
export type PortfolioInsight = z.infer<typeof PortfolioInsightSchema>;

// ---------------------------------------------------------------------------
// InsightReport — full output of a ProcessInsights workflow run
// ---------------------------------------------------------------------------

export const InsightReportSchema = z.object({
  id: z.string().min(1),
  snapshotId: z.string().min(1),
  positions: z.array(PositionInsightSchema),
  portfolio: PortfolioInsightSchema,
  agentOutputs: z.object({
    researchAnalyst: z.string(),
    riskManager: z.string(),
    strategist: z.string(),
  }),
  emotionState: z.object({
    confidence: z.number().min(0).max(1),
    riskAppetite: z.number().min(0).max(1),
    reason: z.string(),
  }),
  createdAt: z.string().datetime(),
  durationMs: z.number(),
});
export type InsightReport = z.infer<typeof InsightReportSchema>;
