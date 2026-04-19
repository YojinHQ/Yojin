/**
 * Backtest types — data model for replaying a strategy against historical
 * signals + prices and scoring its trigger outcomes.
 *
 * Design: the backtest does NOT regenerate Strategist LLM output. Instead,
 * each fired StrategyEvaluation is mapped to a deterministic SimulatedAction
 * via verdict-mapper.ts, and scored by ActionScorer against OHLCV history.
 */

import { z } from 'zod';

import { IdField } from '../types/base.js';

export const BacktestVerdictSchema = z.enum(['BUY', 'SELL']);
export type BacktestVerdict = z.infer<typeof BacktestVerdictSchema>;

export const PriceBarSchema = z.object({
  date: z.string().min(1),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});
export type PriceBar = z.infer<typeof PriceBarSchema>;

export const SimulatedActionSchema = z.object({
  strategyId: IdField,
  strategyName: z.string().min(1),
  triggerId: IdField,
  triggerType: z.string().min(1),
  triggerStrength: z.string().min(1),
  ticker: IdField,
  verdict: BacktestVerdictSchema,
  firedAt: z.string().min(1),
  horizonDays: z.number().int().positive(),
  entryPrice: z.number().positive(),
  mappingReason: z.string().min(1),
});
export type SimulatedAction = z.infer<typeof SimulatedActionSchema>;

export const ScoredActionSchema = SimulatedActionSchema.extend({
  exitPrice: z.number().positive().nullable(),
  exitDate: z.string().nullable(),
  returnPct: z.number().nullable(),
  hit: z.boolean().nullable(),
  /** 'SCORED' — had both entry + exit price. 'TRUNCATED' — horizon past --until. 'NO_EXIT_DATA' — price missing. */
  status: z.enum(['SCORED', 'TRUNCATED', 'NO_EXIT_DATA']),
});
export type ScoredAction = z.infer<typeof ScoredActionSchema>;

export const StrategyScorecardSchema = z.object({
  strategyId: IdField,
  strategyName: z.string().min(1),
  since: z.string().min(1),
  until: z.string().min(1),
  horizonDays: z.number().int().positive(),
  actionCount: z.number().int().nonnegative(),
  scoredCount: z.number().int().nonnegative(),
  truncatedCount: z.number().int().nonnegative(),
  noExitDataCount: z.number().int().nonnegative(),
  hitRate: z.number(),
  avgReturn: z.number(),
  /** Primary scalar: hitRate * avgReturn. Zero when scoredCount === 0. */
  score: z.number(),
  actions: z.array(ScoredActionSchema),
  generatedAt: z.string().min(1),
});
export type StrategyScorecard = z.infer<typeof StrategyScorecardSchema>;

export interface BacktestConfig {
  strategyId: string;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  horizonDays: number;
}
