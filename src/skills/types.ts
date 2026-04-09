/**
 * Skill types — Markdown-defined trading strategies that guide the Strategist.
 *
 * A Skill is a set of conditions + reasoning + actions encoded in Markdown.
 * When conditions are met, the Strategist proposes an ACTION in the Intel Feed.
 */

import { z } from 'zod';

import { DataCapabilitySchema } from './capabilities.js';
import type { DataCapability } from './capabilities.js';
import { DateTimeField, IdField } from '../types/base.js';

// ---------------------------------------------------------------------------
// Skill category — aligned with strategic decision domains
// ---------------------------------------------------------------------------

export const SkillCategorySchema = z.enum(['RISK', 'PORTFOLIO', 'MARKET', 'RESEARCH']);
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

// ---------------------------------------------------------------------------
// Skill trigger condition
// ---------------------------------------------------------------------------

export const TriggerTypeSchema = z.enum([
  'PRICE_MOVE', // Absolute or % price change
  'INDICATOR_THRESHOLD', // Technical indicator (RSI, MACD, ...) crosses a value
  'CONCENTRATION_DRIFT', // Position weight exceeds limit
  'DRAWDOWN', // Portfolio or position drawdown
  'EARNINGS_PROXIMITY', // Days until earnings report
  'METRIC_THRESHOLD', // Numeric metric (SUE, sentiment momentum, P/B, ...) crosses a value
  'SIGNAL_PRESENT', // A recent Signal of given types/sentiment exists for the ticker
  'CUSTOM', // User-defined expression
]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const SkillTriggerSchema = z.object({
  type: TriggerTypeSchema,
  description: z.string().min(1),
  /** Structured condition params (e.g. { ticker: 'AAPL', threshold: -0.10 }) */
  params: z.record(z.string(), z.unknown()).optional(),
});
export type SkillTrigger = z.infer<typeof SkillTriggerSchema>;

// ---------------------------------------------------------------------------
// Skill — the core entity
// ---------------------------------------------------------------------------

export const SkillSchema = z.object({
  id: IdField,
  name: z.string().min(1),
  description: z.string().min(1),
  category: SkillCategorySchema,
  active: z.boolean().default(false),
  source: z.enum(['built-in', 'custom', 'community']),
  style: z.string().min(1).default('general'),
  requires: z.array(DataCapabilitySchema).default([]),
  createdBy: z.string().min(1),
  createdAt: DateTimeField,
  /** The Markdown strategy content — what the Strategist reads. */
  content: z.string().min(1),
  triggers: z.array(SkillTriggerSchema).min(1),
  /** Max position size as fraction of portfolio (0-1). Guard enforced. */
  maxPositionSize: z.number().min(0).max(1).optional(),
  /** Tickers this skill applies to. Empty = all portfolio tickers. */
  tickers: z.array(IdField).default([]),
});
export type Skill = z.infer<typeof SkillSchema>;

// ---------------------------------------------------------------------------
// Skill evaluation result — when a trigger fires
// ---------------------------------------------------------------------------

export const SkillEvaluationSchema = z.object({
  skillId: IdField,
  skillName: z.string().min(1),
  triggerId: IdField,
  triggerType: TriggerTypeSchema,
  /** Context data that caused the trigger to fire. */
  context: z.record(z.string(), z.unknown()),
  /** The Markdown content to inject into the Strategist prompt. */
  skillContent: z.string().min(1),
  evaluatedAt: DateTimeField,
});
export type SkillEvaluation = z.infer<typeof SkillEvaluationSchema>;

export { DataCapabilitySchema };
export type { DataCapability };
