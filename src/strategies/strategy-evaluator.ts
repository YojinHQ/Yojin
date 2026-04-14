/**
 * StrategyEvaluator — checks active strategies against current portfolio state
 * and produces StrategyEvaluation records when trigger groups fire.
 *
 * Trigger groups use AND within a group, OR across groups:
 *   (condA AND condB) OR (condC AND condD)
 */

import { SUPPORTED_LOOKBACK_MONTHS } from './portfolio-context-builder.js';
import type { StrategyStore } from './strategy-store.js';
import type { Strategy, StrategyEvaluation, StrategyTrigger, TriggerGroup, TriggerType } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import { SignalTypeSchema } from '../signals/types.js';
import type { Signal, SignalType } from '../signals/types.js';

/** Triggers that require the full portfolio context and can only run during macro flow. */
const MACRO_ONLY_TRIGGERS: ReadonlySet<TriggerType> = new Set(['CONCENTRATION_DRIFT', 'CUSTOM']);

const logger = createSubsystemLogger('strategy-evaluator');

/** Portfolio context passed to the evaluator for condition checking. */
export interface PortfolioContext {
  weights: Record<string, number>;
  prices: Record<string, number>;
  priceChanges: Record<string, number>;
  periodReturns?: Record<string, number>;
  indicators: Record<string, Record<string, number>>;
  earningsDays: Record<string, number>;
  portfolioDrawdown: number;
  positionDrawdowns: Record<string, number>;
  metrics: Record<string, Record<string, number>>;
  signals: Record<string, Signal[]>;
}

export class StrategyEvaluator {
  private readonly strategyStore: StrategyStore;
  /** Previous indicator/metric values per ticker for crossover detection. */
  private previousValues = new Map<string, Record<string, number>>();

  constructor(strategyStore: StrategyStore) {
    this.strategyStore = strategyStore;
  }

  /** Evaluate all active strategies against current portfolio context (macro flow). */
  evaluate(ctx: PortfolioContext): StrategyEvaluation[] {
    const results = this.strategyStore
      .getActive()
      .flatMap((strategy) => this.evaluateStrategy(strategy, this.resolveTickers(strategy, ctx), ctx));
    this.snapshotCurrentValues(ctx);
    return results;
  }

  /**
   * Evaluate active strategies for specific tickers only, skipping macro-only triggers.
   * Used by micro flow (~5 min cadence).
   */
  evaluateForTickers(ctx: PortfolioContext, tickers: string[]): StrategyEvaluation[] {
    const tickerSet = new Set(tickers);
    const results = this.strategyStore.getActive().flatMap((strategy) => {
      const applicable = strategy.tickers.length > 0 ? strategy.tickers.filter((t) => tickerSet.has(t)) : tickers;
      if (applicable.length === 0) return [];
      return this.evaluateStrategy(strategy, applicable, ctx, true);
    });
    this.snapshotCurrentValues(ctx, tickers);
    return results;
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
  // Private — pipeline
  // ---------------------------------------------------------------------------

  private resolveTickers(strategy: Strategy, ctx: PortfolioContext): string[] {
    return strategy.tickers.length > 0 ? strategy.tickers : Object.keys(ctx.weights);
  }

  private evaluateStrategy(
    strategy: Strategy,
    tickers: string[],
    ctx: PortfolioContext,
    isMicro = false,
  ): StrategyEvaluation[] {
    return strategy.triggerGroups.flatMap((group, groupIndex) => {
      if (isMicro && this.groupHasMacroOnlyTrigger(group)) return [];
      if (isMicro && this.groupHasLookbackPriceMove(group)) return [];

      return tickers.flatMap((ticker) => this.evaluateGroup(strategy, group, groupIndex, ticker, ctx));
    });
  }

  private groupHasMacroOnlyTrigger(group: TriggerGroup): boolean {
    return group.conditions.some((c) => MACRO_ONLY_TRIGGERS.has(c.type));
  }

  private groupHasLookbackPriceMove(group: TriggerGroup): boolean {
    return group.conditions.some((c) => c.type === 'PRICE_MOVE' && c.params?.['lookback_months'] != null);
  }

  private evaluateGroup(
    strategy: Strategy,
    group: TriggerGroup,
    groupIndex: number,
    ticker: string,
    ctx: PortfolioContext,
  ): StrategyEvaluation[] {
    const fired = this.checkAllConditions(group.conditions, ticker, ctx);
    if (!fired) return [];

    const mergedContext: Record<string, unknown> = { ticker };
    const conditionResults: Record<string, unknown>[] = [];
    let primaryType: string | undefined;
    for (const result of fired) {
      const { _triggerType, ...rest } = result as Record<string, unknown> & { _triggerType?: string };
      if (!primaryType && _triggerType) primaryType = _triggerType;
      conditionResults.push(rest);
    }
    // For single-condition groups, flatten for backward compat
    if (conditionResults.length === 1) {
      Object.assign(mergedContext, conditionResults[0]);
    } else {
      mergedContext.conditions = conditionResults;
    }

    const evaluation: StrategyEvaluation = {
      strategyId: strategy.id,
      strategyName: strategy.name,
      triggerId: `${strategy.id}-group${groupIndex}-${ticker}`,
      triggerType: (primaryType ?? group.conditions[0].type) as TriggerType,
      triggerDescription: group.conditions.map((c) => c.description).join(' AND '),
      context: mergedContext,
      strategyContent: strategy.content,
      evaluatedAt: new Date().toISOString(),
    };

    logger.info(`Strategy trigger fired: ${strategy.name} [group${groupIndex}] for ${ticker}`);

    return [evaluation];
  }

  private checkAllConditions(
    conditions: StrategyTrigger[],
    ticker: string,
    ctx: PortfolioContext,
  ): Record<string, unknown>[] | null {
    const results: Record<string, unknown>[] = [];
    for (const condition of conditions) {
      const fired = this.checkTrigger(condition, ticker, ctx);
      if (!fired) return null;
      results.push({ ...fired, _triggerType: condition.type });
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Private — crossover cache
  // ---------------------------------------------------------------------------

  private snapshotCurrentValues(ctx: PortfolioContext, tickers?: string[]): void {
    const tickersToSnapshot = tickers ?? [...new Set([...Object.keys(ctx.indicators), ...Object.keys(ctx.metrics)])];

    // Macro flow (no ticker filter): prune stale entries for tickers no longer in context
    if (!tickers) {
      const activeSet = new Set(tickersToSnapshot);
      for (const key of this.previousValues.keys()) {
        if (!activeSet.has(key)) this.previousValues.delete(key);
      }
    }

    for (const ticker of tickersToSnapshot) {
      const values: Record<string, number> = {};
      const indicators = ctx.indicators[ticker];
      if (indicators) {
        Object.assign(values, indicators);
      }
      const metrics = ctx.metrics[ticker];
      if (metrics) {
        for (const [k, v] of Object.entries(metrics)) {
          values[`metric:${k}`] = v;
        }
      }
      if (Object.keys(values).length > 0) {
        this.previousValues.set(ticker, values);
      }
    }
  }

  private getPreviousValue(ticker: string, key: string): number | undefined {
    return this.previousValues.get(ticker)?.[key];
  }

  // ---------------------------------------------------------------------------
  // Private — individual trigger checks
  // ---------------------------------------------------------------------------

  private checkTrigger(
    trigger: StrategyTrigger,
    ticker: string,
    ctx: PortfolioContext,
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
              `PRICE_MOVE: unsupported lookback_months=${lookbackMonths} ` +
                `(supported: ${SUPPORTED_LOOKBACK_MONTHS.join(', ')}). ` +
                `Trigger will not fire for ${ticker}.`,
            );
          }
        } else {
          change = ctx.priceChanges[ticker];
        }

        const direction = params['direction'] as string | undefined;
        if (change === undefined) return null;
        if (direction === 'drop') {
          const mag = Math.abs(threshold);
          if (change <= -mag) return { change, threshold: -mag, direction };
          return null;
        }
        if (direction === 'rise') {
          const mag = Math.abs(threshold);
          if (change >= mag) return { change, threshold: mag, direction };
          return null;
        }
        // Fallback: infer from sign of threshold (backward compat)
        if (threshold < 0 && change <= threshold) return { change, threshold };
        if (threshold > 0 && change >= threshold) return { change, threshold };
        return null;
      }

      case 'INDICATOR_THRESHOLD': {
        const indicator = String(params['indicator'] ?? 'RSI');
        const threshold = Number(params['threshold'] ?? 0);
        const direction = String(params['direction'] ?? 'above');
        const value = ctx.indicators[ticker]?.[indicator];
        if (value === undefined) return null;

        if (direction === 'crosses_above' || direction === 'crosses_below') {
          const previous = this.getPreviousValue(ticker, indicator);
          if (previous === undefined) return null;
          const crossed =
            direction === 'crosses_above'
              ? previous < threshold && value >= threshold
              : previous > threshold && value <= threshold;
          if (!crossed) return null;
          return { indicator, value, threshold, previous, crossover: direction };
        }

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
        if (value == null) return null;

        if (direction === 'crosses_above' || direction === 'crosses_below') {
          const previous = this.getPreviousValue(ticker, `metric:${metric}`);
          if (previous === undefined) return null;
          const crossed =
            direction === 'crosses_above'
              ? previous < threshold && value >= threshold
              : previous > threshold && value <= threshold;
          if (!crossed) return null;
          return { metric, value, threshold, previous, crossover: direction };
        }

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

      case 'CUSTOM':
        return null;

      default:
        return assertNever(trigger.type);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled trigger type: ${String(value)}`);
}
