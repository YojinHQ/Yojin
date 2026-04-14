/**
 * Trace types — detailed evaluation diagnostics for strategy debugging.
 */

import type { PortfolioContext } from './strategy-evaluator.js';
import type { TriggerStrength } from './trigger-strength.js';
import type { TriggerType } from './types.js';

export type ConditionResult = 'PASS' | 'FAIL' | 'NO_DATA' | 'ERROR';

export interface ConditionTrace {
  type: TriggerType;
  description: string;
  params: Record<string, unknown>;
  result: ConditionResult;
  actualValue: number | string | null;
  threshold: number | string | null;
  /** Full context dict — same shape as the fire context returned by checkTrigger. */
  detail: Record<string, unknown>;
  strength?: TriggerStrength;
  /** Human-readable explanation for FAIL / NO_DATA results. */
  failReason?: string;
  /** Exception message for ERROR results. */
  error?: string;
}

export interface TickerGroupTrace {
  ticker: string;
  conditions: ConditionTrace[];
  groupResult: 'PASS' | 'FAIL';
  groupStrength?: TriggerStrength;
}

export interface TriggerGroupTrace {
  groupIndex: number;
  label: string;
  /** Non-empty when the group was skipped (e.g. "macro-only trigger in micro mode"). */
  skipped?: string;
  tickers: TickerGroupTrace[];
}

export interface StrategyTrace {
  strategyId: string;
  strategyName: string;
  active: boolean;
  scopedTickers: string[];
  filteredOutTickers: { ticker: string; reason: string }[];
  groups: TriggerGroupTrace[];
  result: 'FIRED' | 'NO_MATCH';
  winningGroup?: number;
  winningStrength?: TriggerStrength;
}

export interface ContextBuildError {
  phase: string;
  message: string;
  tickers?: string[];
}

export interface TraceSummary {
  totalStrategies: number;
  activeStrategies: number;
  fired: number;
  noMatch: number;
  tickersEvaluated: string[];
  noDataCount: number;
  errorCount: number;
  firedList: { strategy: string; ticker: string; strength: TriggerStrength }[];
}

export interface StrategyTraceReport {
  evaluatedAt: string;
  portfolioContext: PortfolioContext;
  errors: ContextBuildError[];
  strategies: StrategyTrace[];
  summary: TraceSummary;
}
