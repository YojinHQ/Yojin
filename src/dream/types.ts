/**
 * Dream types — data model for background data consolidation.
 *
 * A dream is a periodic background pass that cleans signal data,
 * detects stale insights, and re-ranks relevance so the user only
 * sees what actually matters right now.
 */

import { z } from 'zod';

import { DateTimeField, IdField } from '../types/base.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const DreamConfigSchema = z.object({
  /** Minimum hours between dream runs. */
  minIntervalHours: z.number().min(1).default(12),
  /** Maximum signal age in days before auto-dismiss. */
  staleSignalDays: z.number().int().min(1).default(7),
  /** Maximum insight report age in days before marking thesis stale. */
  staleInsightDays: z.number().int().min(1).default(5),
  /** Maximum snap action-item age in days before auto-expiry. */
  staleActionItemDays: z.number().int().min(1).default(3),
  /** Minimum NOISE classifications before adding to learned patterns. */
  noisePatternThreshold: z.number().int().min(2).default(5),
  /** Time window for convergence detection refresh (hours). */
  convergenceWindowHours: z.number().min(1).default(48),
});
export type DreamConfig = z.infer<typeof DreamConfigSchema>;

export const DEFAULT_DREAM_CONFIG: DreamConfig = DreamConfigSchema.parse({});

// ---------------------------------------------------------------------------
// Pass results
// ---------------------------------------------------------------------------

export const SignalCleanupResultSchema = z.object({
  dismissed: z.number().int().min(0),
  duplicatesMarked: z.number().int().min(0),
  learnedPatterns: z.array(z.string()),
});
export type SignalCleanupResult = z.infer<typeof SignalCleanupResultSchema>;

export const InsightFreshnessResultSchema = z.object({
  staleTheses: z.array(
    z.object({
      symbol: z.string(),
      reportId: z.string(),
      reason: z.string(),
    }),
  ),
  expiredActionItems: z.number().int().min(0),
  profileEntriesCreated: z.number().int().min(0),
});
export type InsightFreshnessResult = z.infer<typeof InsightFreshnessResultSchema>;

export const RelevanceRerankResultSchema = z.object({
  convergenceBoosts: z.number().int().min(0),
  signalsRescored: z.number().int().min(0),
  snapRegenerated: z.boolean(),
});
export type RelevanceRerankResult = z.infer<typeof RelevanceRerankResultSchema>;

// ---------------------------------------------------------------------------
// Dream log — persisted after each run
// ---------------------------------------------------------------------------

export const DreamLogSchema = z.object({
  id: IdField,
  startedAt: DateTimeField,
  completedAt: DateTimeField,
  durationMs: z.number().int().min(0),
  signalCleanup: SignalCleanupResultSchema,
  insightFreshness: InsightFreshnessResultSchema,
  relevanceRerank: RelevanceRerankResultSchema,
});
export type DreamLog = z.infer<typeof DreamLogSchema>;
