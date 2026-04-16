/**
 * Alert data model — AI-driven alerts promoted from high-severity MicroInsights.
 *
 * An Alert is created when a MicroInsight's severity exceeds the configured
 * threshold (default >= 0.7). Alerts are born "active" — they exist because
 * something critical was detected. The user dismisses them after review.
 *
 * Storage: append-only JSONL in data/alerts/ (date-partitioned).
 */

import { z } from 'zod';

import { InsightRatingSchema } from '../insights/types.js';
import { SignalSentimentSchema } from '../signals/types.js';
import { DateTimeField, IdField } from '../types/base.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const AlertStatusSchema = z.enum(['ACTIVE', 'DISMISSED']);
export type AlertStatus = z.infer<typeof AlertStatusSchema>;

// ---------------------------------------------------------------------------
// Severity label derivation
// ---------------------------------------------------------------------------

export function severityToLabel(severity: number): 'CRITICAL' | 'HIGH' | 'MEDIUM' {
  if (severity >= 0.9) return 'CRITICAL';
  if (severity >= 0.7) return 'HIGH';
  return 'MEDIUM';
}

// ---------------------------------------------------------------------------
// Alert — the core entity
// ---------------------------------------------------------------------------

export const AlertSchema = z.object({
  id: IdField,
  /** Source MicroInsight that triggered this alert. */
  insightId: IdField,
  /** Ticker symbol. */
  symbol: z.string().min(1),
  /** 0–1 severity from the MicroInsight (resolved via computeMicroSummarySeverity). */
  severity: z.number().min(0).max(1),
  /** Derived label: CRITICAL (>= 0.9), HIGH (>= 0.7), MEDIUM (< 0.7). */
  severityLabel: z.string().min(1),
  /** What happened — from MicroInsight.thesis. */
  thesis: z.string().min(1),
  /** Supporting evidence — from MicroInsight.keyDevelopments. */
  keyDevelopments: z.array(z.string()),
  /** MicroInsight rating (VERY_BULLISH..VERY_BEARISH). */
  rating: InsightRatingSchema,
  /** MicroInsight sentiment. */
  sentiment: SignalSentimentSchema,
  status: AlertStatusSchema.default('ACTIVE'),
  dismissedAt: DateTimeField.optional(),
  createdAt: DateTimeField,
});
export type Alert = z.infer<typeof AlertSchema>;
