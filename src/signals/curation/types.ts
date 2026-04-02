/**
 * Signal Curation types — configuration and routing for the signal scoring pipeline.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// FeedTarget — routes scored signals to portfolio or watchlist feed
// ---------------------------------------------------------------------------

export const FeedTargetSchema = z.enum(['PORTFOLIO', 'WATCHLIST']);
export type FeedTarget = z.infer<typeof FeedTargetSchema>;

// ---------------------------------------------------------------------------
// Configuration — loaded from data/config/curation.json
// ---------------------------------------------------------------------------

export const CurationWeightsSchema = z.object({
  exposure: z.number().min(0).max(1).default(0.25),
  typeRelevance: z.number().min(0).max(1).default(0.2),
  recency: z.number().min(0).max(1).default(0.2),
  sourceReliability: z.number().min(0).max(1).default(0.15),
  contentQuality: z.number().min(0).max(1).default(0.2),
});
export type CurationWeights = z.infer<typeof CurationWeightsSchema>;

export const CurationConfigSchema = z.object({
  /** Minimum signal confidence to pass filter (0–1). */
  minConfidence: z.number().min(0).max(1).default(0.3),
  /** Minimum LLM quality score (0–100) to pass filter. Signals below this are noise. */
  minQualityScore: z.number().int().min(0).max(100).default(40),
  /** Maximum curated signals per portfolio position. */
  topNPerPosition: z.number().int().min(1).default(20),
  /** Pipeline run interval in minutes. */
  intervalMinutes: z.number().int().min(1).default(15),
  /** Regex patterns for spam title filtering (case-insensitive). */
  spamPatterns: z
    .array(z.string())
    .default([
      'sponsored',
      'press release',
      'advertisement',
      'partner content',
      'stock price, news, quote',
      'check out .+ stock price',
      'stock (?:price|chart) .+ tradingview',
      'stock chart .+ tradingview',
      'in real time$',
      'no actionable.+(?:signal|market|data)',
      'no (?:substantive|meaningful) .+(?:news|content|data)',
      '^\\d+ (?:best|top) stocks? to (?:buy|sell|watch)',
      'stocks? everyone is (?:buying|talking)',
      '^is .+ (?:a buy|a sell|still a buy)\\??$',
    ]),
  /** Scoring weights (must sum to ~1.0). */
  weights: CurationWeightsSchema.default({}),
});
export type CurationConfig = z.infer<typeof CurationConfigSchema>;
