/**
 * StrategyEvaluator — checks active strategies against current portfolio state
 * and produces StrategyEvaluation records when triggers fire.
 *
 * The evaluator is called periodically (e.g. after portfolio enrichment)
 * and returns evaluations that should be routed to the Strategist.
 */

import { SUPPORTED_LOOKBACK_MONTHS } from './portfolio-context-builder.js';
import type { StrategyStore } from './strategy-store.js';
import type { StrategyEvaluation, StrategyTrigger, TriggerType } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import { SignalTypeSchema } from '../signals/types.js';
import type { Signal, SignalType } from '../signals/types.js';

/** Triggers that require the full portfolio context and can only run during macro flow. */
const MACRO_ONLY_TRIGGERS: ReadonlySet<TriggerType> = new Set(['CONCENTRATION_DRIFT', 'ALLOCATION_DRIFT', 'CUSTOM']);

const logger = createSubsystemLogger('strategy-evaluator');

/** Portfolio context passed to the evaluator for condition checking. */
export interface PortfolioContext {
  /** Position weights by ticker (0-1). */
  weights: Record<string, number>;
  /** Current prices by ticker. */
  prices: Record<string, number>;
  /** Price changes (%) over the evaluation window (daily). */
  priceChanges: Record<string, number>;
  /** Multi-period returns by ticker, keyed as "TICKER:months" → return fraction. */
  periodReturns?: Record<string, number>;
  /** Technical indicators by ticker. */
  indicators: Record<string, Record<string, number>>;
  /** Days until next earnings by ticker. */
  earningsDays: Record<string, number>;
  /** Total portfolio drawdown (%). */
  portfolioDrawdown: number;
  /** Per-position drawdown (%). */
  positionDrawdowns: Record<string, number>;
  /** Numeric metrics per ticker (SUE, sentiment_momentum_24h, priceToBook, bookValue, ...). */
  metrics: Record<string, Record<string, number>>;
  /** Recent signals per ticker, pre-fetched and grouped (24h lookback). */
  signals: Record<string, Signal[]>;
  /** Per-strategy allocation info: strategyId → { target, actual, tickers }. Computed by scheduler. */
  strategyAllocations?: Record<string, { target: number; actual: number; tickers: string[] }>;
}

export class StrategyEvaluator {
  private readonly strategyStore: StrategyStore;

  constructor(strategyStore: StrategyStore) {
    this.strategyStore = strategyStore;
  }

  /** Expose active strategies for callers that need to compute allocation context. */
  getActiveStrategies() {
    return this.strategyStore.getActive();
  }

  /** Evaluate all active strategies against current portfolio context. */
  evaluate(ctx: PortfolioContext): StrategyEvaluation[] {
    const activeStrategies = this.strategyStore.getActive();
    const evaluations: StrategyEvaluation[] = [];

    for (const strategy of activeStrategies) {
      const applicableTickers = strategy.tickers.length > 0 ? strategy.tickers : Object.keys(ctx.weights);
      const alloc = ctx.strategyAllocations?.[strategy.id];

      for (const trigger of strategy.triggers) {
        // ALLOCATION_DRIFT is strategy-level, not per-ticker — evaluate once
        if (trigger.type === 'ALLOCATION_DRIFT') {
          const fired = this.checkTrigger(trigger, '', ctx, strategy.id);
          if (fired) {
            const allocTickers = alloc?.tickers ?? applicableTickers;
            evaluations.push({
              strategyId: strategy.id,
              strategyName: strategy.name,
              triggerId: `${strategy.id}-ALLOCATION_DRIFT-portfolio`,
              triggerType: trigger.type,
              triggerDescription: trigger.description,
              context: { ticker: allocTickers.join(','), ...fired, ...this.allocationContext(alloc) },
              strategyContent: strategy.content,
              evaluatedAt: new Date().toISOString(),
            });
            logger.info(`Strategy trigger fired: ${strategy.name} [ALLOCATION_DRIFT]`);
          }
          continue;
        }

        for (const ticker of applicableTickers) {
          const fired = this.checkTrigger(trigger, ticker, ctx, strategy.id);
          if (fired) {
            evaluations.push({
              strategyId: strategy.id,
              strategyName: strategy.name,
              triggerId: `${strategy.id}-${trigger.type}-${ticker}`,
              triggerType: trigger.type,
              triggerDescription: trigger.description,
              context: { ticker, ...fired, ...this.allocationContext(alloc) },
              strategyContent: strategy.content,
              evaluatedAt: new Date().toISOString(),
            });
            logger.info(`Strategy trigger fired: ${strategy.name} [${trigger.type}] for ${ticker}`);
          }
        }
      }
    }

    return evaluations;
  }

  /**
   * Evaluate active strategies for specific tickers only, skipping macro-only triggers.
   * Used by the micro flow to evaluate per-asset strategy triggers immediately after
   * micro research completes (~5 min cadence instead of ~2 hour macro cadence).
   */
  evaluateForTickers(ctx: PortfolioContext, tickers: string[]): StrategyEvaluation[] {
    const tickerSet = new Set(tickers);
    const activeStrategies = this.strategyStore.getActive();
    const evaluations: StrategyEvaluation[] = [];

    for (const strategy of activeStrategies) {
      // Only evaluate strategies that apply to at least one of the specified tickers
      const applicableTickers =
        strategy.tickers.length > 0 ? strategy.tickers.filter((t) => tickerSet.has(t)) : tickers; // empty strategy.tickers = applies to all

      if (applicableTickers.length === 0) continue;

      for (const trigger of strategy.triggers) {
        // Skip triggers that need full portfolio context
        if (MACRO_ONLY_TRIGGERS.has(trigger.type)) continue;
        // Skip PRICE_MOVE with lookback_months (needs 1-year price history)
        if (trigger.type === 'PRICE_MOVE' && trigger.params?.['lookback_months'] != null) continue;

        const alloc = ctx.strategyAllocations?.[strategy.id];
        for (const ticker of applicableTickers) {
          const fired = this.checkTrigger(trigger, ticker, ctx, strategy.id);
          if (fired) {
            evaluations.push({
              strategyId: strategy.id,
              strategyName: strategy.name,
              triggerId: `${strategy.id}-${trigger.type}-${ticker}`,
              triggerType: trigger.type,
              triggerDescription: trigger.description,
              context: { ticker, ...fired, ...this.allocationContext(alloc) },
              strategyContent: strategy.content,
              evaluatedAt: new Date().toISOString(),
            });
            logger.info(`Micro strategy trigger fired: ${strategy.name} [${trigger.type}] for ${ticker}`);
          }
        }
      }
    }

    return evaluations;
  }

  /** Build a Strategist prompt section from fired strategy evaluations. */
  formatForStrategist(evaluations: StrategyEvaluation[]): string {
    if (evaluations.length === 0) return '';

    const sections = evaluations.map((ev) => {
      const ctx = Object.entries(ev.context)
        .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
        .join('\n');

      return `## Strategy: ${ev.strategyName}
Trigger: ${ev.triggerType}
Context:
${ctx}

### Strategy Instructions
${ev.strategyContent}`;
    });

    return `# Active Strategy Triggers

The following strategies have fired and require your evaluation.
For each, assess whether the conditions warrant proposing an ACTION.

${sections.join('\n\n---\n\n')}`;
  }

  // ---------------------------------------------------------------------------
  // Private trigger checks
  // ---------------------------------------------------------------------------

  /** Build allocation context fields for injection into evaluation context. */
  private allocationContext(
    alloc: { target: number; actual: number; tickers: string[] } | undefined,
  ): Record<string, unknown> {
    if (!alloc) return {};
    return {
      targetAllocation: alloc.target,
      actualAllocation: alloc.actual,
      allocationRemaining: Math.max(0, alloc.target - alloc.actual),
    };
  }

  private checkTrigger(
    trigger: StrategyTrigger,
    ticker: string,
    ctx: PortfolioContext,
    strategyId?: string,
  ): Record<string, unknown> | null {
    const params = trigger.params ?? {};

    switch (trigger.type) {
      case 'PRICE_MOVE': {
        const threshold = Number(params['threshold'] ?? 0);
        const lookbackMonths = params['lookback_months'] != null ? Number(params['lookback_months']) : undefined;

        let change: number | undefined;
        if (lookbackMonths != null) {
          change = ctx.periodReturns?.[`${ticker}:${lookbackMonths}`];
          if (change === undefined && !(SUPPORTED_LOOKBACK_MONTHS as readonly number[]).includes(lookbackMonths)) {
            logger.warn(
              `PRICE_MOVE: unsupported lookback_months=${lookbackMonths} (supported: ${SUPPORTED_LOOKBACK_MONTHS.join(', ')}). ` +
                `Trigger will not fire for ${ticker}.`,
            );
          }
        } else {
          change = ctx.priceChanges[ticker];
        }

        if (change === undefined) return null; // no data — don't fire
        if (threshold < 0 && change <= threshold) return { change, threshold };
        if (threshold > 0 && change >= threshold) return { change, threshold };
        return null;
      }

      case 'INDICATOR_THRESHOLD': {
        const indicator = String(params['indicator'] ?? 'RSI');
        const threshold = Number(params['threshold'] ?? 0);
        const direction = String(params['direction'] ?? 'above');
        const value = ctx.indicators[ticker]?.[indicator];
        if (value === undefined) return null; // no data — don't fire
        if (direction === 'above' && value >= threshold) return { indicator, value, threshold };
        if (direction === 'below' && value <= threshold) return { indicator, value, threshold };
        return null;
      }

      case 'CONCENTRATION_DRIFT': {
        const maxWeight = Number(params['maxWeight'] ?? 0.15);
        const weight = ctx.weights[ticker] ?? 0;
        if (weight > maxWeight) return { weight, maxWeight };
        return null;
      }

      case 'DRAWDOWN': {
        const threshold = Number(params['threshold'] ?? -0.1);
        const drawdown = ctx.positionDrawdowns[ticker] ?? 0;
        if (drawdown <= threshold) return { drawdown, threshold };
        return null;
      }

      case 'EARNINGS_PROXIMITY': {
        const withinDays = Number(params['withinDays'] ?? 7);
        const days = ctx.earningsDays[ticker];
        if (days !== undefined && days <= withinDays) return { daysUntilEarnings: days, withinDays };
        return null;
      }

      case 'METRIC_THRESHOLD': {
        const metric = String(params['metric'] ?? '');
        const threshold = Number(params['threshold'] ?? 0);
        const direction = String(params['direction'] ?? 'above');
        const value = ctx.metrics[ticker]?.[metric];
        if (value == null) return null; // honest: missing data → can't evaluate
        const fired = direction === 'above' ? value >= threshold : value <= threshold;
        if (!fired) return null;
        return { metric, value, threshold, direction };
      }

      case 'SIGNAL_PRESENT': {
        const rawTypes = params['signal_types'];
        const signalTypes: SignalType[] = Array.isArray(rawTypes)
          ? rawTypes.filter((t): t is SignalType => SignalTypeSchema.safeParse(t).success)
          : [];
        if (signalTypes.length === 0) return null;
        const minSentiment = params['min_sentiment'] != null ? Number(params['min_sentiment']) : undefined;
        const requestedLookback = params['lookback_hours'] != null ? Number(params['lookback_hours']) : 24;
        // Hard-cap at 24h — the prefetch only covers 24h, honoring more would
        // produce silent false negatives.
        const lookback = Math.min(requestedLookback, 24);
        const cutoff = Date.now() - lookback * 3_600_000;
        const tickerSignals = ctx.signals[ticker] ?? [];
        const matched = tickerSignals.find(
          (s) =>
            signalTypes.includes(s.type) &&
            new Date(s.publishedAt).getTime() >= cutoff &&
            (minSentiment == null || (s.sentimentScore != null && s.sentimentScore >= minSentiment)),
        );
        if (!matched) return null;
        return {
          signalId: matched.id,
          signalType: matched.type,
          signalTitle: matched.title,
          sentimentScore: matched.sentimentScore ?? null,
        };
      }

      case 'ALLOCATION_DRIFT': {
        if (!strategyId) return null;
        const alloc = ctx.strategyAllocations?.[strategyId];
        if (!alloc) return null; // no targetAllocation set — can't evaluate
        const driftThreshold = Number(params['driftThreshold'] ?? 0.05);
        const direction = String(params['direction'] ?? 'both');
        const drift = alloc.actual - alloc.target;
        const absDrift = Math.abs(drift);
        if (absDrift < driftThreshold) return null;
        if (direction === 'over' && drift <= 0) return null;
        if (direction === 'under' && drift >= 0) return null;
        return {
          targetAllocation: alloc.target,
          actualAllocation: alloc.actual,
          drift,
          driftThreshold,
          direction,
          strategyTickers: alloc.tickers,
        };
      }

      case 'CUSTOM':
        // User-defined expression — no auto-evaluation, defer to Strategist reasoning.
        return null;

      default:
        return assertNever(trigger.type);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled trigger type: ${String(value)}`);
}
