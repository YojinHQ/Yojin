/**
 * Action data model — BUY/SELL outcomes produced by Strategies.
 *
 * An Action is opinionated: a Strategy trigger fires, an LLM assesses it, and
 * the result is a concrete recommendation (verdict + headline + reasoning) that
 * flows through PENDING -> APPROVED | REJECTED | EXPIRED.
 *
 * Actions are ALWAYS produced by a Strategy/Strategy — never by neutral intel
 * pipelines. If a record has no strategyId, it is not an Action.
 *
 * Storage: append-only JSONL in data/actions/ (date-partitioned).
 * GraphQL: Action, ActionVerdict, ActionStatus types in schema.ts.
 */

import { z } from 'zod';

import { TriggerStrengthSchema } from '../strategies/trigger-strength.js';
import { DateTimeField, IdField } from '../types/base.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Concrete recommendation emitted by the Strategist LLM. */
export const ActionVerdictSchema = z.enum(['BUY', 'SELL', 'REVIEW']);
export type ActionVerdict = z.infer<typeof ActionVerdictSchema>;

export const ActionStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

// ---------------------------------------------------------------------------
// Action — the core entity
// ---------------------------------------------------------------------------

export const ActionSchema = z.object({
  id: IdField,
  /** Originating strategy — required. Actions without a strategy are not Actions. */
  strategyId: IdField,
  /** Human-readable strategy name, e.g. "Momentum Breakout". */
  strategyName: z.string().min(1),
  /** Dedup/supersede key: "${strategyId}-${triggerType}-${ticker}". */
  triggerId: IdField,
  triggerType: z.string().min(1),
  /** Concrete verdict parsed from LLM headline (BUY/SELL/REVIEW). */
  verdict: ActionVerdictSchema,
  /** Headline, e.g. "BUY AAPL — golden cross + expanding volume". */
  what: z.string().min(1),
  /** Reasoning trace from the LLM (why this action, risks, sizing). */
  why: z.string().min(1),
  /** One-line sizing clause from the LLM, e.g. "BUY to 5% of portfolio (now 2.1%)" or "SELL 25% of position". */
  sizeGuidance: z.string().min(1).optional(),
  /** Related tickers — typically one for per-asset evaluations. */
  tickers: z.array(z.string().min(1)).default([]),
  /** Formatted trigger context (key=value lines) for audit/debug. */
  riskContext: z.string().optional(),
  /** Optional 0–1 severity; higher = higher priority in the ranker. */
  severity: z.number().min(0).max(1).optional(),
  /** Deterministic strength derived from how far past thresholds the trigger conditions are. */
  triggerStrength: TriggerStrengthSchema.default('MODERATE'),
  /** Suggested number of shares/units — computed from strategy allocation + portfolio. */
  suggestedQuantity: z.number().int().min(0).optional(),
  /** Dollar value of the suggested trade. */
  suggestedValue: z.number().min(0).optional(),
  /** Price at time of recommendation. */
  currentPrice: z.number().positive().optional(),
  status: ActionStatusSchema.default('PENDING'),
  expiresAt: DateTimeField,
  createdAt: DateTimeField,
  resolvedAt: DateTimeField.optional(),
  resolvedBy: z.string().optional(), // 'user' | 'timeout' | 'superseded'
  dismissedAt: DateTimeField.optional(),
});
export type Action = z.infer<typeof ActionSchema>;

/**
 * Parse a verdict from an LLM headline like:
 *   "BUY AAPL — golden cross"
 *   "SELL TSLA — breakdown"
 * Falls back to BUY when no verdict keyword is present.
 */
export function parseVerdictFromHeadline(headline: string): ActionVerdict {
  const head = headline.trim().toUpperCase();
  // Check word-boundary so "BUYBACK" doesn't match BUY
  const match = head.match(/^(BUY|SELL|REVIEW)\b/);
  if (match) {
    return match[1] as ActionVerdict;
  }
  // Legacy/loose mappings: TRIM → SELL. Anything else falls back to REVIEW
  // so the UI surfaces it for manual inspection rather than silently picking a side.
  if (/^TRIM\b/.test(head)) return 'SELL';
  return 'REVIEW';
}
