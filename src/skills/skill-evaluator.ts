/**
 * SkillEvaluator — checks active skills against current portfolio state
 * and produces SkillEvaluation records when triggers fire.
 *
 * The evaluator is called periodically (e.g. after portfolio enrichment)
 * and returns evaluations that should be routed to the Strategist.
 */

import { SUPPORTED_LOOKBACK_MONTHS } from './portfolio-context-builder.js';
import type { SkillStore } from './skill-store.js';
import type { SkillEvaluation, SkillTrigger } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import { SignalTypeSchema } from '../signals/types.js';
import type { Signal, SignalType } from '../signals/types.js';

const logger = createSubsystemLogger('skill-evaluator');

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
}

export class SkillEvaluator {
  private readonly skillStore: SkillStore;

  constructor(skillStore: SkillStore) {
    this.skillStore = skillStore;
  }

  /** Evaluate all active skills against current portfolio context. */
  evaluate(ctx: PortfolioContext): SkillEvaluation[] {
    const activeSkills = this.skillStore.getActive();
    const evaluations: SkillEvaluation[] = [];

    for (const skill of activeSkills) {
      const applicableTickers = skill.tickers.length > 0 ? skill.tickers : Object.keys(ctx.weights);

      for (const trigger of skill.triggers) {
        for (const ticker of applicableTickers) {
          const fired = this.checkTrigger(trigger, ticker, ctx);
          if (fired) {
            evaluations.push({
              skillId: skill.id,
              skillName: skill.name,
              triggerId: `${skill.id}-${trigger.type}-${ticker}`,
              triggerType: trigger.type,
              context: { ticker, ...fired },
              skillContent: skill.content,
              evaluatedAt: new Date().toISOString(),
            });
            logger.info(`Skill trigger fired: ${skill.name} [${trigger.type}] for ${ticker}`);
          }
        }
      }
    }

    return evaluations;
  }

  /** Build a Strategist prompt section from fired skill evaluations. */
  formatForStrategist(evaluations: SkillEvaluation[]): string {
    if (evaluations.length === 0) return '';

    const sections = evaluations.map((ev) => {
      const ctx = Object.entries(ev.context)
        .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
        .join('\n');

      return `## Skill: ${ev.skillName}
Trigger: ${ev.triggerType}
Context:
${ctx}

### Strategy Instructions
${ev.skillContent}`;
    });

    return `# Active Skill Triggers

The following skills have fired and require your evaluation.
For each, assess whether the conditions warrant proposing an ACTION.

${sections.join('\n\n---\n\n')}`;
  }

  // ---------------------------------------------------------------------------
  // Private trigger checks
  // ---------------------------------------------------------------------------

  private checkTrigger(trigger: SkillTrigger, ticker: string, ctx: PortfolioContext): Record<string, unknown> | null {
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
