/**
 * Action data model — first-class output type for the signal/intel pipeline.
 *
 * An Action represents an observation or proposed step (e.g. "Review AAPL position")
 * that requires human approval before execution. Actions flow through
 * PENDING -> APPROVED | REJECTED | EXPIRED.
 *
 * Storage: file-driven JSONL in data/actions/ (date-partitioned, append-only).
 * GraphQL: Action, ActionStatus types in schema.ts.
 *
 * All types are Zod schemas — the single source of truth for validation and inference.
 */

import { z } from 'zod';

import { DateTimeField, IdField } from '../types/base.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ActionStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

// ---------------------------------------------------------------------------
// Action — the core entity
// ---------------------------------------------------------------------------

export const ActionSchema = z.object({
  id: IdField,
  signalId: z.string().optional(), // originating signal, if any
  skillId: z.string().optional(), // originating skill, if any
  what: z.string().min(1), // plain English: "Review AAPL — bearish divergence detected"
  why: z.string().min(1), // reasoning trace
  source: z.string().min(1), // skill name or "rule: ..." or "agent: strategist"
  riskContext: z.string().optional(), // guard checks summary
  // 0–1 severity score — acts as priority. Used to rank actions and to gate
  // low-impact micro updates. Producers that don't score actions can omit this
  // (absent = 0 for comparison purposes).
  severity: z.number().min(0).max(1).optional(),
  status: ActionStatusSchema.default('PENDING'),
  expiresAt: DateTimeField, // auto-reject after this
  createdAt: DateTimeField,
  resolvedAt: DateTimeField.optional(),
  resolvedBy: z.string().optional(), // 'user' | 'timeout' | 'superseded'
});
export type Action = z.infer<typeof ActionSchema>;
