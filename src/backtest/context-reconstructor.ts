/**
 * context-reconstructor — build a PortfolioContext "as of" a historical date D.
 *
 * Strategies expect a `PortfolioContext` to evaluate against. For a backtest we
 * synthesize one per day from cached OHLCV + the signal archive:
 *   - prices: close at D per ticker
 *   - priceChanges: 1-day pct change
 *   - indicators: RSI14 / SMA20 / SMA50 / SMA200 computed from bars
 *   - signals: archive.query({ tickers, since: D-14d, until: D })
 *   - weights: strategy.targetWeights (historical snapshots are not available)
 *
 * Anything the StrategyEvaluator reads but that we cannot reconstruct is left
 * empty — triggers depending on it will simply not fire during replay.
 */
import { computeIndicators } from './indicators.js';
import type { PriceHistoryProvider } from './price-history.js';
import type { SignalArchive } from '../signals/archive.js';
import type { PortfolioContext } from '../strategies/strategy-evaluator.js';
import type { Strategy } from '../strategies/types.js';

export interface ContextReconstructorDeps {
  priceHistory: PriceHistoryProvider;
  signalArchive: SignalArchive;
}

export class ContextReconstructor {
  constructor(private readonly deps: ContextReconstructorDeps) {}

  async buildContext(strategy: Strategy, asOf: string, tickers: string[]): Promise<PortfolioContext> {
    const { priceHistory, signalArchive } = this.deps;

    const prices: Record<string, number> = {};
    const priceChanges: Record<string, number> = {};
    const indicators: Record<string, Record<string, number>> = {};

    for (const ticker of tickers) {
      const close = await priceHistory.closeAt(ticker, asOf);
      if (close !== null) prices[ticker] = close;

      const dayChange = await priceHistory.pctChange(ticker, asOf, 1);
      if (dayChange !== null) priceChanges[ticker] = dayChange;

      const bars = await priceHistory.getBars(ticker, shiftDaysBack(asOf, 300), asOf);
      indicators[ticker] = computeIndicators(bars, asOf);
    }

    const weights = strategy.targetWeights ?? {};

    const signalsSince = shiftDaysBack(asOf, 14);
    const rawSignals = await signalArchive.query({
      tickers,
      since: signalsSince,
      until: asOf,
      limit: tickers.length * 100,
    });
    const signalsByTicker: Record<string, typeof rawSignals> = {};
    for (const ticker of tickers) signalsByTicker[ticker] = [];
    for (const signal of rawSignals) {
      for (const link of signal.assets ?? []) {
        if (signalsByTicker[link.ticker]) signalsByTicker[link.ticker].push(signal);
      }
    }

    return {
      weights,
      prices,
      priceChanges,
      indicators,
      earningsDays: {},
      portfolioDrawdown: 0,
      positionDrawdowns: {},
      metrics: {},
      signals: signalsByTicker,
    };
  }
}

function shiftDaysBack(dateStr: string, days: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) - days * 86_400_000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
