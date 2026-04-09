/**
 * MicroInsight — per-asset AI research output.
 *
 * Produced every 5 minutes per tracked asset (portfolio + watchlist).
 * Sonnet LLM call analyzes a single ticker's DataBrief
 * and produces a structured research note.
 *
 * Macro research reads these outputs instead of re-analyzing raw data.
 */

import { z } from 'zod';

import { InsightRatingSchema } from './types.js';
import { SignalSentimentSchema } from '../signals/types.js';

export const MicroInsightSourceSchema = z.enum(['portfolio', 'watchlist']);
export type MicroInsightSource = z.infer<typeof MicroInsightSourceSchema>;

export const MicroInsightSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string(),
  source: MicroInsightSourceSchema,

  // AI analysis
  rating: InsightRatingSchema,
  conviction: z.number().min(0).max(1),
  // 0–1 severity the LLM assigns to this observation — 0 = noise, 1 = critical
  // catalyst. Acts as the priority for Action promotion (see micro-severity.ts).
  // Optional for back-compat with pre-feature JSONL: older insights are scored
  // via the rating × conviction fallback at read time.
  severity: z.number().min(0).max(1).optional(),
  thesis: z.string().min(1),
  keyDevelopments: z.array(z.string()),
  risks: z.array(z.string()),
  opportunities: z.array(z.string()),
  sentiment: SignalSentimentSchema,

  // Signal references
  signalCount: z.number().int().min(0),
  topSignalIds: z.array(z.string()),

  // Micro-level outputs
  assetSnap: z.string(), // 1-sentence notable observation
  assetActions: z.array(z.string()), // per-asset observations worth paying attention to

  // Metadata
  generatedAt: z.string().min(1),
  durationMs: z.number(),
});
export type MicroInsight = z.infer<typeof MicroInsightSchema>;
