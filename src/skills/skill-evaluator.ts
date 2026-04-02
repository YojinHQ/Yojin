/**
 * SkillEvaluator — checks active skills against current portfolio state
 * and produces SkillEvaluation records when triggers fire.
 *
 * The evaluator is called periodically (e.g. after portfolio enrichment)
 * and returns evaluations that should be routed to the Strategist.
 */

import type { SkillStore } from './skill-store.js';
import type { SkillEvaluation, SkillTrigger } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('skill-evaluator');

/** Portfolio context passed to the evaluator for condition checking. */
interface PortfolioContext {
  /** Position weights by ticker (0-1). */
  weights: Record<string, number>;
  /** Current prices by ticker. */
  prices: Record<string, number>;
  /** Price changes (%) over the evaluation window. */
  priceChanges: Record<string, number>;
  /** Technical indicators by ticker. */
  indicators: Record<string, Record<string, number>>;
  /** Days until next earnings by ticker. */
  earningsDays: Record<string, number>;
  /** Total portfolio drawdown (%). */
  portfolioDrawdown: number;
  /** Per-position drawdown (%). */
  positionDrawdowns: Record<string, number>;
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
        const change = ctx.priceChanges[ticker];
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

      case 'SIGNAL_MATCH':
      case 'CUSTOM':
        // These require more complex evaluation — defer to Strategist reasoning
        return null;

      default:
        return null;
    }
  }
}
