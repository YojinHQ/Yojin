/**
 * TickerProfile types — per-asset persistent knowledge store.
 *
 * Each TickerProfileEntry is a structured observation about a specific asset,
 * extracted deterministically from InsightReports. Entries accumulate over time,
 * giving agents deep per-asset context without needing per-asset agents.
 *
 * Storage: one JSONL file per ticker at data/profiles/{TICKER}.jsonl.
 */

import { z } from 'zod';

import { InsightRatingSchema } from '../insights/types.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ProfileEntryCategorySchema = z.enum([
  'PATTERN', // Technical/fundamental pattern observed
  'EVENT_REACTION', // How the asset reacted to a signal/event
  'LESSON', // Lesson from a graded prediction (from reflection)
  'CORRELATION', // Cross-asset correlation discovered
  'CONTEXT', // Sector/industry/macro context that proved relevant
  'SENTIMENT_SHIFT', // Shift in sentiment direction between runs
]);
export type ProfileEntryCategory = z.infer<typeof ProfileEntryCategorySchema>;

// ---------------------------------------------------------------------------
// TickerProfileEntry — a single observation about an asset
// ---------------------------------------------------------------------------

export const TickerProfileEntrySchema = z.object({
  id: z.string().min(1),
  ticker: z.string().min(1),
  category: ProfileEntryCategorySchema,
  observation: z.string().min(1),
  evidence: z.string().min(1),
  // Source provenance
  insightReportId: z.string().min(1),
  insightDate: z.string(),
  // Optional context
  rating: InsightRatingSchema.nullable().default(null),
  conviction: z.number().min(0).max(1).nullable().default(null),
  priceAtObservation: z.number().nullable().default(null),
  // For LESSON entries: grading data
  grade: z.string().nullable().default(null),
  actualReturn: z.number().nullable().default(null),
  // Timestamps
  createdAt: z.string().datetime(),
});
export type TickerProfileEntry = z.infer<typeof TickerProfileEntrySchema>;

// ---------------------------------------------------------------------------
// TickerProfileBrief — compact summary injected into DataBrief for LLM context
// ---------------------------------------------------------------------------

export const TickerProfileBriefSchema = z.object({
  entryCount: z.number(),
  recentPatterns: z.array(z.string()),
  recentLessons: z.array(z.string()),
  correlations: z.array(z.string()),
  sentimentHistory: z.array(
    z.object({
      date: z.string(),
      rating: z.string(),
      conviction: z.number(),
    }),
  ),
});
export type TickerProfileBrief = z.infer<typeof TickerProfileBriefSchema>;
