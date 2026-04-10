/**
 * Summary data model — first-class output type for the signal/intel pipeline.
 *
 * A Summary represents an observation or proposed step (e.g. "Review AAPL position")
 * that requires human approval before execution. Summaries flow through
 * PENDING -> APPROVED | REJECTED | EXPIRED.
 *
 * Storage: file-driven JSONL in data/summaries/ (date-partitioned, append-only).
 * GraphQL: Summary, SummaryStatus types in schema.ts.
 *
 * All types are Zod schemas — the single source of truth for validation and inference.
 */

import { z } from 'zod';

import { DateTimeField, IdField } from '../types/base.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SummaryStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']);
export type SummaryStatus = z.infer<typeof SummaryStatusSchema>;

// ---------------------------------------------------------------------------
// Summary — the core entity
// ---------------------------------------------------------------------------

export const SummarySchema = z.object({
  id: IdField,
  signalId: z.string().optional(), // originating signal, if any
  skillId: z.string().optional(), // originating skill, if any
  triggerId: z.string().optional(), // dedup key: "${skillId}-${triggerType}-${ticker}"
  what: z.string().min(1), // plain English: "Review AAPL — bearish divergence detected"
  why: z.string().min(1), // reasoning trace
  tickers: z.array(z.string()).default([]), // related ticker symbols
  source: z.string().min(1), // skill name or "rule: ..." or "agent: strategist"
  riskContext: z.string().optional(), // guard checks summary
  // 0–1 severity score — acts as priority. Used to rank summaries and to gate
  // low-impact micro updates. Producers that don't score summaries can omit this
  // (absent = 0 for comparison purposes).
  severity: z.number().min(0).max(1).optional(),
  status: SummaryStatusSchema.default('PENDING'),
  expiresAt: DateTimeField, // auto-reject after this
  createdAt: DateTimeField,
  resolvedAt: DateTimeField.optional(),
  resolvedBy: z.string().optional(), // 'user' | 'timeout' | 'superseded'
  dismissedAt: DateTimeField.optional(),
});
export type Summary = z.infer<typeof SummarySchema>;
