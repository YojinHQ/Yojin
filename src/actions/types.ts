/**
 * Action data model — first-class output type for the signal/intel pipeline.
 *
 * An Action represents an actionable recommendation (e.g. "BUY 10 AAPL")
 * that requires human approval before execution. Actions flow through
 * PENDING -> APPROVED | REJECTED | EXPIRED.
 *
 * Storage: file-driven JSONL in data/actions/ (date-partitioned, append-only).
 * GraphQL: Action, ActionStatus types in schema.ts.
 *
 * All types are Zod schemas — the single source of truth for validation and inference.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ActionStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

// ---------------------------------------------------------------------------
// Action — the core entity
// ---------------------------------------------------------------------------

export const ActionSchema = z.object({
  id: z.string().min(1),
  signalId: z.string().optional(), // originating signal, if any
  skillId: z.string().optional(), // originating skill, if any
  what: z.string().min(1), // plain English: "BUY 10 AAPL @ $187.50 on Alpaca"
  why: z.string().min(1), // reasoning trace
  source: z.string().min(1), // skill name or "rule: ..." or "agent: strategist"
  riskContext: z.string().optional(), // guard checks summary
  status: ActionStatusSchema.default('PENDING'),
  expiresAt: z.string().datetime(), // auto-reject after this
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  resolvedBy: z.string().optional(), // 'user' | 'timeout'
});
export type Action = z.infer<typeof ActionSchema>;
