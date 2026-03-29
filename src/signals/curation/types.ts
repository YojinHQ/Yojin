/**
 * Signal Curation types — schemas for the deterministic signal curation pipeline.
 *
 * CuratedSignal wraps a raw Signal with portfolio relevance scores.
 * The pipeline filters, scores, and ranks signals against the user's portfolio,
 * producing a curated set for downstream consumers (Insights, UI).
 */

import { z } from 'zod';

import { PortfolioRelevanceScoreSchema, SignalSchema } from '../types.js';

// ---------------------------------------------------------------------------
// CuratedSignal — a signal with portfolio relevance scores
// ---------------------------------------------------------------------------

export const CuratedSignalSchema = z.object({
  signal: SignalSchema,
  scores: z.array(PortfolioRelevanceScoreSchema).min(1),
  curatedAt: z.string().datetime(),
});
export type CuratedSignal = z.infer<typeof CuratedSignalSchema>;

// ---------------------------------------------------------------------------
// Watermark — tracks pipeline progress for incremental processing
// ---------------------------------------------------------------------------

export const CurationWatermarkSchema = z.object({
  lastRunAt: z.string().datetime(),
  lastSignalIngestedAt: z.string().datetime(),
  signalsProcessed: z.number().int().min(0),
  signalsCurated: z.number().int().min(0),
});
export type CurationWatermark = z.infer<typeof CurationWatermarkSchema>;

// ---------------------------------------------------------------------------
// Pipeline run result
// ---------------------------------------------------------------------------

export const CurationRunResultSchema = z.object({
  signalsProcessed: z.number().int().min(0),
  signalsCurated: z.number().int().min(0),
  signalsDropped: z.number().int().min(0),
  durationMs: z.number().min(0),
});
export type CurationRunResult = z.infer<typeof CurationRunResultSchema>;

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
    ]),
  /** Scoring weights (must sum to ~1.0). */
  weights: CurationWeightsSchema.default({}),
});
export type CurationConfig = z.infer<typeof CurationConfigSchema>;
