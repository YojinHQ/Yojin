/**
 * ActionScorer — grades SimulatedActions against OHLCV history.
 *
 * For each action:
 *   - exit = close at firedAt + horizonDays (walking past weekends/holidays).
 *   - returnPct = (exit - entry) / entry * 100, flipped for SELL so positive = thesis paid off.
 *   - hit = returnPct > 0.
 *
 * Actions whose horizon extends past `until` are marked TRUNCATED and excluded
 * from hitRate / avgReturn. Missing exit price → NO_EXIT_DATA, also excluded.
 *
 * Primary scalar: score = hitRate × avgReturn (zero when nothing scored).
 */
import type { PriceHistoryProvider } from './price-history.js';
import { shiftDays } from './price-history.js';
import type { ScoredAction, SimulatedAction, StrategyScorecard } from './types.js';

export interface ScoreOptions {
  strategyId: string;
  strategyName: string;
  since: string;
  until: string;
  horizonDays: number;
}

export class ActionScorer {
  constructor(private readonly priceHistory: PriceHistoryProvider) {}

  async score(actions: SimulatedAction[], options: ScoreOptions): Promise<StrategyScorecard> {
    const scored: ScoredAction[] = [];

    for (const action of actions) {
      const exitDate = shiftDays(action.firedAt, action.horizonDays);
      if (exitDate > options.until) {
        scored.push({
          ...action,
          exitPrice: null,
          exitDate: null,
          returnPct: null,
          hit: null,
          status: 'TRUNCATED',
        });
        continue;
      }

      const exitPrice = await this.priceHistory.closeAt(action.ticker, exitDate);
      if (exitPrice === null || exitPrice <= 0) {
        scored.push({
          ...action,
          exitPrice: null,
          exitDate,
          returnPct: null,
          hit: null,
          status: 'NO_EXIT_DATA',
        });
        continue;
      }

      let returnPct = ((exitPrice - action.entryPrice) / action.entryPrice) * 100;
      if (action.verdict === 'SELL') returnPct = -returnPct;
      scored.push({
        ...action,
        exitPrice,
        exitDate,
        returnPct,
        hit: returnPct > 0,
        status: 'SCORED',
      });
    }

    const scoredOnly = scored.filter((a) => a.status === 'SCORED');
    const hitCount = scoredOnly.filter((a) => a.hit === true).length;
    const hitRate = scoredOnly.length > 0 ? hitCount / scoredOnly.length : 0;
    const avgReturn =
      scoredOnly.length > 0 ? scoredOnly.reduce((sum, a) => sum + (a.returnPct ?? 0), 0) / scoredOnly.length : 0;

    return {
      strategyId: options.strategyId,
      strategyName: options.strategyName,
      since: options.since,
      until: options.until,
      horizonDays: options.horizonDays,
      actionCount: actions.length,
      scoredCount: scoredOnly.length,
      truncatedCount: scored.filter((a) => a.status === 'TRUNCATED').length,
      noExitDataCount: scored.filter((a) => a.status === 'NO_EXIT_DATA').length,
      hitRate,
      avgReturn,
      score: hitRate * avgReturn,
      actions: scored,
      generatedAt: new Date().toISOString(),
    };
  }
}
