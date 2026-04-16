/**
 * StrategyEvaluator — checks active strategies against current portfolio state
 * and produces StrategyEvaluation records when trigger groups fire.
 *
 * Trigger groups use AND within a group, OR across groups:
 *   (condA AND condB) OR (condC AND condD)
 */

import { SUPPORTED_LOOKBACK_MONTHS } from './portfolio-context-builder.js';
import type { StrategyStore } from './strategy-store.js';
import type {
  ConditionTrace,
  StrategyTrace,
  StrategyTraceReport,
  TickerGroupTrace,
  TraceSummary,
  TriggerGroupTrace,
} from './trace-types.js';
import {
  STRENGTH_ORDER,
  aggregateGroupStrength,
  computeTriggerStrength,
  pickStrongestGroup,
} from './trigger-strength.js';
import type { TriggerStrength } from './trigger-strength.js';
import type { Strategy, StrategyEvaluation, StrategyTrigger, TriggerGroup, TriggerType } from './types.js';
import type { AssetClass } from '../api/graphql/types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import { INDEX_TICKER_SET } from '../market-sentiment/types.js';
import { SignalTypeSchema } from '../signals/types.js';
import type { Signal, SignalType } from '../signals/types.js';

/** Triggers that require the full portfolio context and can only run during macro flow. */
const MACRO_ONLY_TRIGGERS: ReadonlySet<TriggerType> = new Set(['CONCENTRATION_DRIFT', 'ALLOCATION_DRIFT', 'CUSTOM']);

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
  /** Per-ticker asset class. Used to gate strategies by their declared `assetClasses`. */
  assetClasses?: Record<string, AssetClass>;
  /** Per-strategy allocation info: strategyId → { target, actual, tickers }. Computed by scheduler. */
  strategyAllocations?: Record<string, { target: number; actual: number; tickers: string[] }>;
}

export interface EvaluateOptions {
  trace?: boolean;
}

export class StrategyEvaluator {
  private readonly strategyStore: StrategyStore;
  /** Previous indicator/metric values per ticker for crossover detection. */
  private previousValues = new Map<string, Record<string, number>>();

  constructor(strategyStore: StrategyStore) {
    this.strategyStore = strategyStore;
  }

  /** Expose active strategies for callers that need to compute allocation context. */
  getActiveStrategies() {
    return this.strategyStore.getActive();
  }

  /** Evaluate all active strategies against current portfolio context (macro flow). */
  evaluate(ctx: PortfolioContext): StrategyEvaluation[];
  evaluate(ctx: PortfolioContext, options: { trace: true }): StrategyTraceReport;
  evaluate(ctx: PortfolioContext, options: EvaluateOptions): StrategyEvaluation[] | StrategyTraceReport;
  evaluate(ctx: PortfolioContext, options?: EvaluateOptions): StrategyEvaluation[] | StrategyTraceReport {
    if (options?.trace) {
      const report = this.evaluateTrace(ctx);
      this.snapshotCurrentValues(ctx);
      return report;
    }
    const results = this.strategyStore
      .getActive()
      .flatMap((strategy) =>
        this.evaluateStrategy(
          strategy,
          this.filterByAssetClass(strategy, this.resolveTickers(strategy, ctx), ctx),
          ctx,
        ),
      );
    this.snapshotCurrentValues(ctx);
    return results;
  }

  /**
   * Evaluate active strategies for specific tickers only, skipping macro-only triggers.
   * Used by micro flow (~5 min cadence).
   */
  evaluateForTickers(ctx: PortfolioContext, tickers: string[]): StrategyEvaluation[];
  evaluateForTickers(ctx: PortfolioContext, tickers: string[], options: { trace: true }): StrategyTraceReport;
  evaluateForTickers(
    ctx: PortfolioContext,
    tickers: string[],
    options?: EvaluateOptions,
  ): StrategyEvaluation[] | StrategyTraceReport {
    if (options?.trace) {
      const report = this.evaluateTrace(ctx, tickers);
      this.snapshotCurrentValues(ctx, tickers);
      return report;
    }
    const tickerSet = new Set(tickers);
    const results = this.strategyStore.getActive().flatMap((strategy) => {
      const applicable = strategy.tickers.length > 0 ? strategy.tickers.filter((t) => tickerSet.has(t)) : tickers;
      const scoped = this.filterByAssetClass(strategy, applicable, ctx);
      if (scoped.length === 0) return [];
      return this.evaluateStrategy(strategy, scoped, ctx, true);
    });
    this.snapshotCurrentValues(ctx, tickers);
    return results;
  }

  /**
   * Drop tickers whose asset class isn't in the strategy's declared `assetClasses`.
   * Empty `assetClasses` means "all asset classes". Tickers with unknown asset class
   * (no entry in ctx.assetClasses) are kept — the gate is permissive when data is missing.
   */
  private filterByAssetClass(strategy: Strategy, tickers: string[], ctx: PortfolioContext): string[] {
    if (strategy.assetClasses.length === 0) return tickers;
    const allowed = new Set<AssetClass>(strategy.assetClasses);
    const map = ctx.assetClasses;
    if (!map) return tickers;
    return tickers.filter((t) => {
      const cls = map[t];
      return cls === undefined || allowed.has(cls);
    });
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
Trigger Strength: ${ev.triggerStrength}
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
    const base = strategy.tickers.length > 0 ? strategy.tickers : Object.keys(ctx.weights);
    // ALLOCATION_DRIFT needs to fire on zero-position underweights too, so union the
    // target tickers into the evaluation set even when they aren't in the portfolio yet.
    if (!strategy.targetWeights) return base;
    const hasAllocationTrigger = strategy.triggerGroups.some((g) =>
      g.conditions.some((c) => c.type === 'ALLOCATION_DRIFT'),
    );
    if (!hasAllocationTrigger) return base;
    return [...new Set([...base, ...Object.keys(strategy.targetWeights)])];
  }

  private evaluateStrategy(
    strategy: Strategy,
    tickers: string[],
    ctx: PortfolioContext,
    isMicro = false,
  ): StrategyEvaluation[] {
    // Index ETFs (SPY, QQQ, DIA, IWM) are excluded from sentiment-style strategies.
    // Their social sentiment is collected as a macro market-regime indicator, not a trade signal.
    const effectiveTickers = strategy.style === 'sentiment' ? tickers.filter((t) => !INDEX_TICKER_SET.has(t)) : tickers;
    if (effectiveTickers.length === 0) return [];

    const allEvaluations = strategy.triggerGroups.flatMap((group, groupIndex) => {
      if (isMicro && this.groupHasMacroOnlyTrigger(group)) return [];
      if (isMicro && this.groupHasLookbackPriceMove(group)) return [];
      return effectiveTickers.flatMap((ticker) => this.evaluateGroup(strategy, group, groupIndex, ticker, ctx));
    });

    // Dedup across OR groups: keep only the strongest evaluation per ticker
    const byTicker = new Map<string, StrategyEvaluation[]>();
    for (const ev of allEvaluations) {
      const ticker = ev.context.ticker as string;
      const bucket = byTicker.get(ticker);
      if (bucket) {
        bucket.push(ev);
      } else {
        byTicker.set(ticker, [ev]);
      }
    }

    const deduped: StrategyEvaluation[] = [];
    for (const evaluations of byTicker.values()) {
      const best = pickStrongestGroup(evaluations);
      if (best) deduped.push(best);
    }

    return deduped;
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
    const check = this.checkAllConditions(group.conditions, ticker, ctx, strategy);
    if (!check) return [];

    const mergedContext: Record<string, unknown> = {
      ticker,
      ...this.allocationContext(ctx.strategyAllocations?.[strategy.id]),
    };
    const conditionResults: Record<string, unknown>[] = [];
    let primaryType: string | undefined;
    for (const result of check.results) {
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
      triggerStrength: check.triggerStrength,
    };

    logger.info(
      `Strategy trigger fired: ${strategy.name} [group${groupIndex}] for ${ticker} (${check.triggerStrength})`,
    );

    return [evaluation];
  }

  private checkAllConditions(
    conditions: StrategyTrigger[],
    ticker: string,
    ctx: PortfolioContext,
    strategy: Strategy,
  ): { results: Record<string, unknown>[]; triggerStrength: TriggerStrength } | null {
    const results: Record<string, unknown>[] = [];
    const strengths: TriggerStrength[] = [];
    for (const condition of conditions) {
      const fired = this.checkTrigger(condition, ticker, ctx, strategy);
      if (!fired) return null;
      results.push({ ...fired, _triggerType: condition.type });
      strengths.push(computeTriggerStrength(condition.type, fired));
    }
    return { results, triggerStrength: aggregateGroupStrength(strengths) };
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
    strategy: Strategy,
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

      case 'ALLOCATION_DRIFT': {
        // Per-ticker ETF-style rebalancing (targetWeights)
        if (strategy.targetWeights) {
          const target = strategy.targetWeights[ticker];
          if (target == null) return null;
          const actual = ctx.weights[ticker] ?? 0;
          const delta = actual - target;
          const toleranceBps = Number(params['toleranceBps'] ?? 500);
          const tolerance = toleranceBps / 10_000;
          if (Math.abs(delta) < tolerance) return null;
          return {
            target,
            actual,
            delta,
            toleranceBps,
            direction: delta > 0 ? 'overweight' : 'underweight',
          };
        }
        // Strategy-level allocation drift (targetAllocation budget)
        const alloc = ctx.strategyAllocations?.[strategy.id];
        if (!alloc) return null;
        const driftThreshold = Number(params['driftThreshold'] ?? 0.05);
        const direction = String(params['direction'] ?? 'both');
        const drift = alloc.actual - alloc.target;
        if (Math.abs(drift) < driftThreshold) return null;
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

      case 'PERSON_ACTIVITY': {
        const person = typeof params['person'] === 'string' ? params['person'] : '';
        if (!person) return null;
        const actionFilter = typeof params['action'] === 'string' ? params['action'].toUpperCase() : 'ANY';
        const minDollar = params['minDollar'] != null ? Number(params['minDollar']) : 0;
        const lookbackDays = params['lookback_days'] != null ? Number(params['lookback_days']) : 120;
        const cutoff = Date.now() - lookbackDays * 24 * 3_600_000;

        const tickerSignals = ctx.signals[ticker] ?? [];
        const matched = tickerSignals.find((s) => {
          if (s.type !== 'DISCLOSED_TRADE') return false;
          if (new Date(s.publishedAt).getTime() < cutoff) return false;
          const meta = s.metadata ?? {};
          if (meta['person'] !== person) return false;
          if (actionFilter !== 'ANY' && String(meta['action'] ?? '').toUpperCase() !== actionFilter) return false;
          const dollar = Number(meta['dollarValue'] ?? 0);
          if (minDollar > 0 && dollar < minDollar) return false;
          return true;
        });
        if (!matched) return null;
        const meta = matched.metadata ?? {};
        return {
          signalId: matched.id,
          person,
          action: meta['action'] ?? null,
          shares: meta['shares'] ?? null,
          dollarValue: meta['dollarValue'] ?? null,
          filingSource: meta['source'] ?? null,
          publishedAt: matched.publishedAt,
        };
      }

      case 'CUSTOM':
        return null;

      default:
        return assertNever(trigger.type);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — trace mode
  // ---------------------------------------------------------------------------

  private evaluateTrace(ctx: PortfolioContext, onlyTickers?: string[]): StrategyTraceReport {
    const allStrategies = this.strategyStore.getActive();
    const isMicro = onlyTickers != null;
    const onlySet = onlyTickers ? new Set(onlyTickers) : null;

    const strategyTraces: StrategyTrace[] = allStrategies.map((strategy) => {
      const allTickers = this.resolveTickers(strategy, ctx);
      const filteredOutTickers: { ticker: string; reason: string }[] = [];
      let scopedTickers: string[];

      if (onlySet) {
        const applicable =
          strategy.tickers.length > 0 ? strategy.tickers.filter((t) => onlySet.has(t)) : (onlyTickers ?? []);
        scopedTickers = this.filterByAssetClass(strategy, applicable, ctx);
      } else {
        scopedTickers = this.filterByAssetClass(strategy, allTickers, ctx);
      }

      // Track filtered-out tickers with reasons
      const scopedSet = new Set(scopedTickers);
      for (const t of allTickers) {
        if (scopedSet.has(t)) continue;
        const cls = ctx.assetClasses?.[t];
        if (cls && strategy.assetClasses.length > 0 && !strategy.assetClasses.includes(cls)) {
          filteredOutTickers.push({
            ticker: t,
            reason: `asset class ${cls} not in [${strategy.assetClasses.join(', ')}]`,
          });
        } else if (onlySet && !onlySet.has(t)) {
          filteredOutTickers.push({
            ticker: t,
            reason: `not in --tickers filter`,
          });
        }
      }

      const groups: TriggerGroupTrace[] = strategy.triggerGroups.map((group, groupIndex) => {
        // Check for skipped groups
        if (isMicro && this.groupHasMacroOnlyTrigger(group)) {
          return {
            groupIndex,
            label: group.label,
            skipped: 'macro-only trigger in micro mode',
            tickers: [],
          };
        }
        if (isMicro && this.groupHasLookbackPriceMove(group)) {
          return {
            groupIndex,
            label: group.label,
            skipped: 'lookback PRICE_MOVE skipped in micro mode',
            tickers: [],
          };
        }

        const tickerTraces: TickerGroupTrace[] = scopedTickers.map((ticker) => {
          const conditionTraces: ConditionTrace[] = group.conditions.map((condition) =>
            this.checkTriggerTrace(condition, ticker, ctx, strategy),
          );

          const allPass = conditionTraces.every((c) => c.result === 'PASS');
          const passedStrengths = conditionTraces
            .filter((c) => c.result === 'PASS' && c.strength != null)
            .map((c) => c.strength as TriggerStrength);

          return {
            ticker,
            conditions: conditionTraces,
            groupResult: allPass ? 'PASS' : 'FAIL',
            groupStrength: allPass && passedStrengths.length > 0 ? aggregateGroupStrength(passedStrengths) : undefined,
          };
        });

        return {
          groupIndex,
          label: group.label,
          tickers: tickerTraces,
        };
      });

      // Determine which tickers fired and find the winning group
      const firedByTicker = new Map<string, { groupIndex: number; strength: TriggerStrength }>();
      for (const group of groups) {
        if (group.skipped) continue;
        for (const tickerTrace of group.tickers) {
          if (tickerTrace.groupResult === 'PASS' && tickerTrace.groupStrength != null) {
            const existing = firedByTicker.get(tickerTrace.ticker);
            if (!existing || STRENGTH_ORDER[tickerTrace.groupStrength] > STRENGTH_ORDER[existing.strength]) {
              firedByTicker.set(tickerTrace.ticker, {
                groupIndex: group.groupIndex,
                strength: tickerTrace.groupStrength,
              });
            }
          }
        }
      }

      const fired = firedByTicker.size > 0;
      const winningEntries = [...firedByTicker.values()];
      const winner =
        winningEntries.length > 0
          ? winningEntries.reduce((best, cur) =>
              STRENGTH_ORDER[cur.strength] > STRENGTH_ORDER[best.strength] ? cur : best,
            )
          : undefined;

      return {
        strategyId: strategy.id,
        strategyName: strategy.name,
        active: true,
        scopedTickers,
        filteredOutTickers,
        groups,
        result: fired ? 'FIRED' : 'NO_MATCH',
        winningGroup: winner?.groupIndex,
        winningStrength: winner?.strength,
      };
    });

    const summary = this.buildTraceSummary(strategyTraces);

    return {
      evaluatedAt: new Date().toISOString(),
      portfolioContext: ctx,
      errors: [],
      strategies: strategyTraces,
      summary,
    };
  }

  private checkTriggerTrace(
    trigger: StrategyTrigger,
    ticker: string,
    ctx: PortfolioContext,
    strategy: Strategy,
  ): ConditionTrace {
    try {
      const result = this.checkTrigger(trigger, ticker, ctx, strategy);
      if (result !== null) {
        const strength = computeTriggerStrength(trigger.type, result);
        return {
          type: trigger.type,
          description: trigger.description,
          params: trigger.params ?? {},
          result: 'PASS',
          actualValue: this.extractActualValue(trigger, ticker, ctx, strategy),
          threshold: this.extractThreshold(trigger),
          detail: result,
          strength,
        };
      }

      // checkTrigger returned null — determine FAIL vs NO_DATA
      const actualValue = this.extractActualValue(trigger, ticker, ctx, strategy);
      const isNoData = actualValue === null || actualValue === undefined;

      // Crossover triggers need prior history — if absent, that's NO_DATA not FAIL
      if (!isNoData && this.isCrossoverTriggerMissingHistory(trigger, ticker)) {
        return {
          type: trigger.type,
          description: trigger.description,
          params: trigger.params ?? {},
          result: 'NO_DATA',
          actualValue,
          threshold: this.extractThreshold(trigger),
          detail: {},
          failReason: `No prior snapshot for crossover detection on ${ticker}`,
        };
      }

      if (isNoData) {
        return {
          type: trigger.type,
          description: trigger.description,
          params: trigger.params ?? {},
          result: 'NO_DATA',
          actualValue: null,
          threshold: this.extractThreshold(trigger),
          detail: {},
          failReason: this.buildNoDataReason(trigger, ticker),
        };
      }

      return {
        type: trigger.type,
        description: trigger.description,
        params: trigger.params ?? {},
        result: 'FAIL',
        actualValue,
        threshold: this.extractThreshold(trigger),
        detail: {},
        failReason: this.buildFailReason(trigger, ticker, actualValue),
      };
    } catch (err) {
      return {
        type: trigger.type,
        description: trigger.description,
        params: trigger.params ?? {},
        result: 'ERROR',
        actualValue: null,
        threshold: this.extractThreshold(trigger),
        detail: {},
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private extractActualValue(
    trigger: StrategyTrigger,
    ticker: string,
    ctx: PortfolioContext,
    strategy?: Strategy,
  ): number | string | null {
    const params = trigger.params ?? {};
    switch (trigger.type) {
      case 'PRICE_MOVE': {
        const lookbackMonths = params['lookback_months'] != null ? Number(params['lookback_months']) : undefined;
        if (lookbackMonths != null) {
          return ctx.periodReturns?.[`${ticker}:${lookbackMonths}`] ?? null;
        }
        return ctx.priceChanges[ticker] ?? null;
      }
      case 'INDICATOR_THRESHOLD': {
        const indicator = String(params['indicator'] ?? 'RSI');
        return ctx.indicators[ticker]?.[indicator] ?? null;
      }
      case 'CONCENTRATION_DRIFT':
        // checkTrigger defaults to 0 when absent, so match that (FAIL, not NO_DATA)
        return ctx.weights[ticker] ?? 0;
      case 'ALLOCATION_DRIFT': {
        if (strategy?.targetWeights) {
          // checkTrigger defaults to 0 when absent (unheld tickers), so match that
          return ctx.weights[ticker] ?? 0;
        }
        return ctx.strategyAllocations?.[strategy?.id ?? '']?.actual ?? null;
      }
      case 'DRAWDOWN':
        // checkTrigger defaults to 0 when absent, so match that (FAIL, not NO_DATA)
        return ctx.positionDrawdowns[ticker] ?? 0;
      case 'EARNINGS_PROXIMITY': {
        const days = ctx.earningsDays[ticker];
        return days ?? null;
      }
      case 'METRIC_THRESHOLD': {
        const metric = String(params['metric'] ?? '');
        return ctx.metrics[ticker]?.[metric] ?? null;
      }
      case 'SIGNAL_PRESENT':
      case 'PERSON_ACTIVITY': {
        const signals = ctx.signals[ticker];
        return signals != null ? signals.length : null;
      }
      case 'CUSTOM':
        return null;
      default:
        return null;
    }
  }

  private extractThreshold(trigger: StrategyTrigger): number | string | null {
    const params = trigger.params ?? {};
    switch (trigger.type) {
      case 'PRICE_MOVE':
        return Number(params['threshold'] ?? 0);
      case 'INDICATOR_THRESHOLD':
      case 'METRIC_THRESHOLD':
        return Number(params['threshold'] ?? 0);
      case 'CONCENTRATION_DRIFT':
        return Number(params['maxWeight'] ?? 0.15);
      case 'ALLOCATION_DRIFT':
        return params['toleranceBps'] != null
          ? Number(params['toleranceBps']) / 10_000
          : Number(params['driftThreshold'] ?? 0.05);
      case 'DRAWDOWN':
        return Number(params['threshold'] ?? -0.1);
      case 'EARNINGS_PROXIMITY':
        return Number(params['withinDays'] ?? 7);
      case 'SIGNAL_PRESENT':
      case 'PERSON_ACTIVITY':
      case 'CUSTOM':
        return null;
      default:
        return null;
    }
  }

  private buildNoDataReason(trigger: StrategyTrigger, ticker: string): string {
    const params = trigger.params ?? {};
    switch (trigger.type) {
      case 'PRICE_MOVE': {
        const lookback = params['lookback_months'];
        return lookback != null
          ? `No period return for ${ticker} (lookback_months=${lookback})`
          : `No price change data for ${ticker}`;
      }
      case 'INDICATOR_THRESHOLD': {
        const indicator = String(params['indicator'] ?? 'RSI');
        return `Indicator ${indicator} is undefined or missing for ${ticker}`;
      }
      case 'CONCENTRATION_DRIFT':
        return `Weight data missing for ${ticker}`;
      case 'ALLOCATION_DRIFT':
        return `Allocation data missing for ${ticker}`;
      case 'DRAWDOWN':
        return `Drawdown data missing for ${ticker}`;
      case 'EARNINGS_PROXIMITY':
        return `Earnings days data missing for ${ticker}`;
      case 'METRIC_THRESHOLD': {
        const metric = String(params['metric'] ?? '');
        return `Metric ${metric} is undefined or missing for ${ticker}`;
      }
      case 'SIGNAL_PRESENT':
        return `No signals found for ${ticker}`;
      case 'PERSON_ACTIVITY':
        return `No signals found for ${ticker}`;
      case 'CUSTOM':
        return `Custom trigger has no data for ${ticker}`;
      default:
        return `Data missing for ${ticker}`;
    }
  }

  private buildFailReason(trigger: StrategyTrigger, ticker: string, actual: number | string | null): string {
    const params = trigger.params ?? {};
    const threshold = this.extractThreshold(trigger);
    switch (trigger.type) {
      case 'PRICE_MOVE': {
        const direction = params['direction'];
        if (direction === 'drop') {
          return `${ticker} price change ${actual} did not drop by ${Math.abs(Number(threshold))}`;
        }
        if (direction === 'rise') {
          return `${ticker} price change ${actual} did not rise by ${threshold}`;
        }
        return `${ticker} price change ${actual} did not meet threshold ${threshold}`;
      }
      case 'INDICATOR_THRESHOLD': {
        const indicator = String(params['indicator'] ?? 'RSI');
        const direction = String(params['direction'] ?? 'above');
        return `${ticker} ${indicator}=${actual} did not meet ${direction} ${threshold}`;
      }
      case 'CONCENTRATION_DRIFT':
        return `${ticker} weight=${actual} does not exceed maxWeight=${threshold}`;
      case 'ALLOCATION_DRIFT':
        return `${ticker} allocation drift does not meet tolerance`;
      case 'DRAWDOWN':
        return `${ticker} drawdown=${actual} does not reach threshold=${threshold}`;
      case 'EARNINGS_PROXIMITY':
        return `${ticker} earnings in ${actual} days, not within ${threshold}`;
      case 'METRIC_THRESHOLD': {
        const metric = String(params['metric'] ?? '');
        const direction = String(params['direction'] ?? 'above');
        return `${ticker} ${metric}=${actual} did not meet ${direction} ${threshold}`;
      }
      case 'SIGNAL_PRESENT':
        return `No matching signal found for ${ticker} with required types/sentiment`;
      case 'PERSON_ACTIVITY':
        return `No matching person activity signal for ${ticker}`;
      case 'CUSTOM':
        return `Custom trigger condition not met for ${ticker}`;
      default:
        return `Condition not met for ${ticker}`;
    }
  }

  private isCrossoverTriggerMissingHistory(trigger: StrategyTrigger, ticker: string): boolean {
    const direction = String(trigger.params?.['direction'] ?? '');
    if (direction !== 'crosses_above' && direction !== 'crosses_below') return false;
    if (trigger.type === 'INDICATOR_THRESHOLD') {
      const indicator = String(trigger.params?.['indicator'] ?? 'RSI');
      return this.getPreviousValue(ticker, indicator) === undefined;
    }
    if (trigger.type === 'METRIC_THRESHOLD') {
      const metric = String(trigger.params?.['metric'] ?? '');
      return this.getPreviousValue(ticker, `metric:${metric}`) === undefined;
    }
    return false;
  }

  private buildTraceSummary(strategies: StrategyTrace[]): TraceSummary {
    const fired = strategies.filter((s) => s.result === 'FIRED').length;
    const noMatch = strategies.filter((s) => s.result === 'NO_MATCH').length;

    const allTickersSet = new Set<string>();
    for (const s of strategies) {
      for (const t of s.scopedTickers) allTickersSet.add(t);
    }

    let noDataCount = 0;
    let errorCount = 0;
    const firedList: { strategy: string; ticker: string; strength: TriggerStrength }[] = [];

    for (const s of strategies) {
      for (const group of s.groups) {
        if (group.skipped) continue;
        for (const tickerTrace of group.tickers) {
          for (const cond of tickerTrace.conditions) {
            if (cond.result === 'NO_DATA') noDataCount++;
            if (cond.result === 'ERROR') errorCount++;
          }
        }
      }

      if (s.result === 'FIRED' && s.winningStrength) {
        const tickerWinners = new Map<string, TriggerStrength>();
        for (const group of s.groups) {
          if (group.skipped) continue;
          for (const tickerTrace of group.tickers) {
            if (tickerTrace.groupResult === 'PASS' && tickerTrace.groupStrength != null) {
              const existing = tickerWinners.get(tickerTrace.ticker);
              if (!existing || STRENGTH_ORDER[tickerTrace.groupStrength] > STRENGTH_ORDER[existing]) {
                tickerWinners.set(tickerTrace.ticker, tickerTrace.groupStrength);
              }
            }
          }
        }
        for (const [ticker, strength] of tickerWinners) {
          firedList.push({ strategy: s.strategyName, ticker, strength });
        }
      }
    }

    return {
      totalStrategies: strategies.length,
      activeStrategies: strategies.filter((s) => s.active).length,
      fired,
      noMatch,
      tickersEvaluated: [...allTickersSet],
      noDataCount,
      errorCount,
      firedList,
    };
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled trigger type: ${String(value)}`);
}
