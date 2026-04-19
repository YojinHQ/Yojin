/**
 * BacktestRunner — orchestrates per-day replay + scoring for a single strategy.
 *
 * For each business day D in [since, until]:
 *   1. reconstructContext(strategy, D) → PortfolioContext as of D
 *   2. evaluator.evaluate(ctx)         → StrategyEvaluation[] (only our one strategy is active)
 *   3. verdictMapper.map(eval,strat)   → BUY | SELL | null
 *   4. build SimulatedAction with entryPrice = close at D
 *
 * Then ActionScorer grades every SimulatedAction against close at firedAt+horizon.
 *
 * Dedup: a strategy may fire the same trigger for the same ticker every day while
 * a condition holds (e.g. RSI < 30 for a week). We collapse to a single action per
 * (strategyId, triggerId, ticker) per firing streak — the earliest day is kept.
 */
import type { ContextReconstructor } from './context-reconstructor.js';
import type { PriceHistoryProvider } from './price-history.js';
import { shiftDays } from './price-history.js';
import type { ActionScorer } from './scorer.js';
import type { BacktestConfig, SimulatedAction, StrategyScorecard } from './types.js';
import { mapEvaluationToVerdict } from './verdict-mapper.js';
import type { Signal } from '../signals/types.js';
import type { StrategyEvaluator } from '../strategies/strategy-evaluator.js';
import type { Strategy, StrategyEvaluation } from '../strategies/types.js';

export interface BacktestRunnerDeps {
  evaluator: StrategyEvaluator;
  contextReconstructor: ContextReconstructor;
  priceHistory: PriceHistoryProvider;
  scorer: ActionScorer;
}

export class BacktestRunner {
  constructor(private readonly deps: BacktestRunnerDeps) {}

  async run(strategy: Strategy, config: BacktestConfig): Promise<StrategyScorecard> {
    const tickers = this.resolveTickers(strategy);
    if (tickers.length === 0) {
      throw new Error(
        `Strategy ${strategy.id} has no tickers and no targetWeights — backtest cannot replay without a ticker set`,
      );
    }

    const actions: SimulatedAction[] = [];
    const openKeys = new Set<string>(); // (triggerId, ticker) currently firing — dedup streaks
    const allKeys = new Set<string>(); // keys that fired today, for diffing

    const dates = enumerateDates(config.since, config.until);
    for (const date of dates) {
      allKeys.clear();
      const ctx = await this.deps.contextReconstructor.buildContext(strategy, date, tickers);
      const evaluations = this.deps.evaluator.evaluate(ctx).filter((e) => e.strategyId === strategy.id);

      for (const evaluation of evaluations) {
        const ticker = extractTicker(evaluation, tickers);
        if (!ticker) continue;

        const key = `${evaluation.triggerId}::${ticker}`;
        allKeys.add(key);
        if (openKeys.has(key)) continue; // mid-streak, already recorded entry

        const mapping = mapEvaluationToVerdict(evaluation, strategy);
        if (!mapping) continue;

        const entryPrice = await this.deps.priceHistory.closeAt(ticker, date);
        if (entryPrice === null || entryPrice <= 0) continue;

        actions.push({
          strategyId: strategy.id,
          strategyName: strategy.name,
          triggerId: evaluation.triggerId,
          triggerType: evaluation.triggerType,
          triggerStrength: evaluation.triggerStrength,
          ticker,
          verdict: mapping.verdict,
          firedAt: date,
          horizonDays: config.horizonDays,
          entryPrice,
          mappingReason: mapping.reason,
        });
        openKeys.add(key);
      }

      // Keys that stopped firing today reset so the next occurrence is a new action.
      for (const key of [...openKeys]) {
        if (!allKeys.has(key)) openKeys.delete(key);
      }
    }

    return this.deps.scorer.score(actions, {
      strategyId: strategy.id,
      strategyName: strategy.name,
      since: config.since,
      until: config.until,
      horizonDays: config.horizonDays,
    });
  }

  private resolveTickers(strategy: Strategy): string[] {
    if (strategy.tickers.length > 0) return [...strategy.tickers];
    if (strategy.targetWeights) return Object.keys(strategy.targetWeights);
    return [];
  }
}

/** StrategyEvaluator stores a trigger ID but not the ticker — extract it from context or fall back. */
function extractTicker(evaluation: StrategyEvaluation, fallbackUniverse: string[]): string | null {
  const ctxTicker = evaluation.context?.ticker;
  if (typeof ctxTicker === 'string' && ctxTicker.length > 0) return ctxTicker.toUpperCase();

  const ctxSymbol = evaluation.context?.symbol;
  if (typeof ctxSymbol === 'string' && ctxSymbol.length > 0) return ctxSymbol.toUpperCase();

  const signal = evaluation.context?.signal as { tickers?: string[] } | Signal | undefined;
  if (signal && Array.isArray((signal as { tickers?: string[] }).tickers)) {
    const first = (signal as { tickers?: string[] }).tickers?.[0];
    if (first) return first.toUpperCase();
  }

  // Some portfolio-wide triggers (drawdown, concentration) have no single ticker —
  // we skip them; verdict-mapper also returns null for those trigger types.
  if (fallbackUniverse.length === 1) return fallbackUniverse[0].toUpperCase();
  return null;
}

function enumerateDates(since: string, until: string): string[] {
  const result: string[] = [];
  let cursor = since;
  // Guard against infinite loop if since > until
  if (cursor > until) return result;
  while (cursor <= until) {
    result.push(cursor);
    cursor = shiftDays(cursor, 1);
  }
  return result;
}
