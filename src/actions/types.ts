/**
 * Action data model — BUY/SELL/REVIEW outcomes produced by Strategies/Strategies.
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

import { DateTimeField, IdField } from '../types/base.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Concrete recommendation emitted by the Strategist LLM. */
export const ActionVerdictSchema = z.enum(['BUY', 'SELL', 'TRIM', 'HOLD', 'REVIEW']);
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
  /** Concrete verdict parsed from LLM headline (BUY/SELL/TRIM/HOLD/REVIEW). */
  verdict: ActionVerdictSchema,
  /** Headline, e.g. "BUY AAPL — golden cross + expanding volume". */
  what: z.string().min(1),
  /** Reasoning trace from the LLM (why this action, risks, sizing). */
  why: z.string().min(1),
  /** Related tickers — typically one for per-asset evaluations. */
  tickers: z.array(z.string().min(1)).default([]),
  /** Formatted trigger context (key=value lines) for audit/debug. */
  riskContext: z.string().optional(),
  /** Optional 0–1 severity; higher = higher priority in the ranker. */
  severity: z.number().min(0).max(1).optional(),
  /** 0–1 confidence in the verdict; used for conflict resolution when multiple strategies fire on the same ticker. */
  confidence: z.number().min(0).max(1).default(0.5),
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
 *   "REVIEW portfolio — concentration drift"
 * Falls back to REVIEW when no verdict keyword is present.
 */
export function parseVerdictFromHeadline(headline: string): ActionVerdict {
  const head = headline.trim().toUpperCase();
  // Check word-boundary so "BUYBACK" doesn't match BUY
  const match = head.match(/^(BUY|SELL|TRIM|HOLD|REVIEW)\b/);
  if (match) {
    return match[1] as ActionVerdict;
  }
  return 'REVIEW';
}

/** Parse confidence score from LLM response text. Clamps to 0-1, defaults to 0.5. */
export function parseConfidenceFromResponse(text: string): number {
  const match = text.match(/CONFIDENCE:\s*(-?[\d.]+)/i);
  if (!match) return 0.5;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

// ---------------------------------------------------------------------------
// Effective score — conflict resolution between competing actions
// ---------------------------------------------------------------------------

const DEFENSIVE_VERDICTS: ReadonlySet<ActionVerdict> = new Set(['TRIM', 'SELL']);
const RISK_BOOST = 0.3;

/** Compute effective score for conflict resolution. Defensive verdicts get a risk boost.
 *  Tie-break: when scores are equal, the newer action wins (latest-wins semantics). */
export function effectiveScore(confidence: number, verdict: ActionVerdict): number {
  return confidence + (DEFENSIVE_VERDICTS.has(verdict) ? RISK_BOOST : 0);
}
