/**
 * verdict-mapper — deterministic (StrategyEvaluation, Strategy) → BUY | SELL | null.
 *
 * StrategyEvaluation doesn't carry a verdict — verdicts normally come from the
 * Strategist LLM. For a deterministic backtest we need a pure function.
 *
 * Priority:
 *   1. `evaluation.context.expectedDirection` ('UP' | 'DOWN') — explicit thesis.
 *   2. Heuristic table over (triggerType, params.direction, strategy.style).
 *   3. null — trigger fired but direction is ambiguous; excluded from hit rate.
 *
 * This is the v1 "simulation model" and intentionally conservative: only triggers
 * that clearly map to a directional thesis are scored.
 */
import type { BacktestVerdict } from './types.js';
import type { Strategy, StrategyEvaluation } from '../strategies/types.js';

export interface VerdictMapping {
  verdict: BacktestVerdict;
  reason: string;
}

const BUY_STYLES_PRICE_UP = new Set(['momentum', 'trend_following', 'swing', 'technical']);
const SELL_STYLES_PRICE_DOWN = new Set(['momentum', 'trend_following', 'swing', 'technical']);

export function mapEvaluationToVerdict(evaluation: StrategyEvaluation, strategy: Strategy): VerdictMapping | null {
  const ctx = evaluation.context ?? {};
  const explicit = readDirection(ctx.expectedDirection);
  if (explicit) {
    return {
      verdict: explicit === 'UP' ? 'BUY' : 'SELL',
      reason: `explicit expectedDirection=${explicit}`,
    };
  }

  const direction = typeof ctx.direction === 'string' ? ctx.direction.toLowerCase() : undefined;
  const threshold = typeof ctx.threshold === 'number' ? ctx.threshold : undefined;
  const style = strategy.style;

  switch (evaluation.triggerType) {
    case 'INDICATOR_THRESHOLD': {
      if (style === 'mean_reversion') {
        if (direction === 'below') {
          return {
            verdict: 'BUY',
            reason: `mean_reversion + indicator below${threshold !== undefined ? ` ${threshold}` : ''}`,
          };
        }
        if (direction === 'above') {
          return {
            verdict: 'SELL',
            reason: `mean_reversion + indicator above${threshold !== undefined ? ` ${threshold}` : ''}`,
          };
        }
      }
      if (style === 'momentum' || style === 'trend_following') {
        if (direction === 'above') {
          return { verdict: 'BUY', reason: `${style} + indicator above threshold` };
        }
        if (direction === 'below') {
          return { verdict: 'SELL', reason: `${style} + indicator below threshold` };
        }
      }
      return null;
    }

    case 'PRICE_MOVE': {
      if (direction === 'up' && BUY_STYLES_PRICE_UP.has(style)) {
        return { verdict: 'BUY', reason: `${style} + price up` };
      }
      if (direction === 'down' && SELL_STYLES_PRICE_DOWN.has(style)) {
        return { verdict: 'SELL', reason: `${style} + price down` };
      }
      if (direction === 'down' && style === 'mean_reversion') {
        return { verdict: 'BUY', reason: 'mean_reversion + price down (dip buy)' };
      }
      if (direction === 'up' && style === 'mean_reversion') {
        return { verdict: 'SELL', reason: 'mean_reversion + price up (fade rally)' };
      }
      return null;
    }

    case 'METRIC_THRESHOLD': {
      if (direction === 'above') return { verdict: 'BUY', reason: 'metric above threshold' };
      if (direction === 'below') return { verdict: 'SELL', reason: 'metric below threshold' };
      return null;
    }

    case 'SIGNAL_PRESENT': {
      const sentiment = typeof ctx.sentiment === 'string' ? ctx.sentiment.toLowerCase() : undefined;
      if (sentiment === 'bullish' || sentiment === 'positive') {
        return { verdict: 'BUY', reason: 'bullish signal present' };
      }
      if (sentiment === 'bearish' || sentiment === 'negative') {
        return { verdict: 'SELL', reason: 'bearish signal present' };
      }
      return null;
    }

    case 'PERSON_ACTIVITY': {
      const side = typeof ctx.side === 'string' ? ctx.side.toLowerCase() : undefined;
      if (side === 'buy') return { verdict: 'BUY', reason: 'tracked person buy' };
      if (side === 'sell') return { verdict: 'SELL', reason: 'tracked person sell' };
      return null;
    }

    case 'DRAWDOWN':
    case 'CONCENTRATION_DRIFT':
    case 'ALLOCATION_DRIFT':
    case 'EARNINGS_PROXIMITY':
    case 'CUSTOM':
      return null;

    default:
      return null;
  }
}

function readDirection(value: unknown): 'UP' | 'DOWN' | null {
  if (typeof value !== 'string') return null;
  const up = value.toUpperCase();
  if (up === 'UP' || up === 'DOWN') return up;
  return null;
}
