/**
 * Strategy types — Markdown-defined trading strategies that guide the Strategist.
 *
 * A Strategy is a set of conditions + reasoning + actions encoded in Markdown.
 * When conditions are met, the Strategist proposes an ACTION in the Intel Feed.
 */

import { z } from 'zod';

import { DataCapabilitySchema } from './capabilities.js';
import type { DataCapability } from './capabilities.js';
import { DateTimeField, IdField } from '../types/base.js';

// ---------------------------------------------------------------------------
// Strategy category — aligned with strategic decision domains
// ---------------------------------------------------------------------------

export const StrategyCategorySchema = z.enum(['RISK', 'PORTFOLIO', 'MARKET', 'RESEARCH']);
export type StrategyCategory = z.infer<typeof StrategyCategorySchema>;

// ---------------------------------------------------------------------------
// Strategy style — controlled vocabulary for filtering
// ---------------------------------------------------------------------------

export const StrategyStyleSchema = z.enum([
  'momentum',
  'value',
  'mean_reversion',
  'swing',
  'trend_following',
  'income',
  'growth',
  'defensive',
  'carry',
  'event_driven',
  'quant',
  'risk',
  'sentiment',
  'statistical_arb',
  'technical',
  'general',
]);
export type StrategyStyle = z.infer<typeof StrategyStyleSchema>;

// ---------------------------------------------------------------------------
// Strategy trigger condition
// ---------------------------------------------------------------------------

export const TriggerTypeSchema = z.enum([
  'PRICE_MOVE', // Absolute or % price change
  'INDICATOR_THRESHOLD', // Technical indicator (RSI, MACD, ...) crosses a value
  'CONCENTRATION_DRIFT', // Position weight exceeds limit
  'ALLOCATION_DRIFT', // Actual weight deviates from strategy.targetWeights
  'DRAWDOWN', // Portfolio or position drawdown
  'EARNINGS_PROXIMITY', // Days until earnings report
  'METRIC_THRESHOLD', // Numeric metric (SUE, sentiment momentum, P/B, ...) crosses a value
  'SIGNAL_PRESENT', // A recent Signal of given types/sentiment exists for the ticker
  'PERSON_ACTIVITY', // A DISCLOSED_TRADE signal for a tracked person (13F, congress, insider)
  'CUSTOM', // User-defined expression
]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const StrategyTriggerSchema = z.object({
  type: TriggerTypeSchema,
  description: z.string().min(1),
  /** Structured condition params (e.g. { ticker: 'AAPL', threshold: -0.10 }) */
  params: z.record(z.string(), z.unknown()).optional(),
});
export type StrategyTrigger = z.infer<typeof StrategyTriggerSchema>;

export const TriggerGroupSchema = z.object({
  /** Optional human-readable group label (e.g. "Entry signal", "Risk exit"). */
  label: z.string().default(''),
  /** All conditions must fire (AND) for this group to fire. */
  conditions: z.array(StrategyTriggerSchema).min(1),
});
export type TriggerGroup = z.infer<typeof TriggerGroupSchema>;

// ---------------------------------------------------------------------------
// Strategy — the core entity
// ---------------------------------------------------------------------------

/** Target allocation weights — ticker → fraction of portfolio (0-1). Sum must be ≤ 1. */
export const TargetWeightsSchema = z
  .record(IdField, z.number().min(0).max(1))
  .refine((w) => Object.values(w).reduce((a, b) => a + b, 0) <= 1.0001, {
    message: 'Sum of target weights must be ≤ 1.0',
  });
export type TargetWeights = z.infer<typeof TargetWeightsSchema>;

export const StrategySchema = z.object({
  id: IdField,
  name: z.string().min(1),
  description: z.string().min(1),
  category: StrategyCategorySchema,
  active: z.boolean().default(false),
  source: z.enum(['built-in', 'custom', 'community']),
  style: StrategyStyleSchema.default('general'),
  requires: z.array(DataCapabilitySchema).default([]),
  createdBy: z.string().min(1),
  createdAt: DateTimeField,
  /** The Markdown strategy content — what the Strategist reads. */
  content: z.string().min(1),
  triggerGroups: z.array(TriggerGroupSchema).min(1),
  /** Max position size as fraction of portfolio (0-1). Guard enforced. */
  maxPositionSize: z.number().min(0).max(1).optional(),
  /** Tickers this strategy applies to. Empty = all portfolio tickers. */
  tickers: z.array(IdField).default([]),
  /** Target allocation for ETF-style strategies (ticker → weight). Read by ALLOCATION_DRIFT. */
  targetWeights: TargetWeightsSchema.optional(),
});
export type Strategy = z.infer<typeof StrategySchema>;

// ---------------------------------------------------------------------------
// Strategy evaluation result — when a trigger fires
// ---------------------------------------------------------------------------

export const StrategyEvaluationSchema = z.object({
  strategyId: IdField,
  strategyName: z.string().min(1),
  triggerId: IdField,
  triggerType: TriggerTypeSchema,
  /** Human-readable description of the trigger condition. */
  triggerDescription: z.string().min(1),
  /** Context data that caused the trigger to fire. */
  context: z.record(z.string(), z.unknown()),
  /** The Markdown content to inject into the Strategist prompt. */
  strategyContent: z.string().min(1),
  evaluatedAt: DateTimeField,
});
export type StrategyEvaluation = z.infer<typeof StrategyEvaluationSchema>;

export { DataCapabilitySchema };
export type { DataCapability };
