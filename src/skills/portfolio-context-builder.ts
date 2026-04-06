/**
 * Portfolio Context Builder — transforms raw portfolio snapshot + Jintel enrichment data
 * into a PortfolioContext suitable for SkillEvaluator trigger evaluation.
 */

import type { Entity, MarketQuote, TechnicalIndicators, TickerPriceHistory } from '@yojinhq/jintel-client';

import type { PortfolioContext } from './skill-evaluator.js';

interface MinimalPosition {
  symbol: string;
  currentPrice: number;
  marketValue: number;
}

interface MinimalSnapshot {
  positions: MinimalPosition[];
  totalValue: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Map Jintel TechnicalIndicators to a flat key→number record for trigger evaluation. */
export function mapIndicators(technicals: TechnicalIndicators | null | undefined): Record<string, number> {
  if (!technicals) return {};

  const result: Record<string, number> = {};

  if (technicals.rsi != null) result.RSI = technicals.rsi;
  if (technicals.ema != null) result.EMA = technicals.ema;
  if (technicals.sma != null) result.SMA = technicals.sma;
  if (technicals.atr != null) result.ATR = technicals.atr;
  if (technicals.vwma != null) result.VWMA = technicals.vwma;
  if (technicals.mfi != null) result.MFI = technicals.mfi;

  if (technicals.macd != null) {
    result.MACD = technicals.macd.histogram;
    result.MACD_LINE = technicals.macd.macd;
    result.MACD_SIGNAL = technicals.macd.signal;
  }

  if (technicals.bollingerBands != null) {
    result.BB_LOWER = technicals.bollingerBands.lower;
    result.BB_MIDDLE = technicals.bollingerBands.middle;
    result.BB_UPPER = technicals.bollingerBands.upper;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Multi-period returns from price history
// ---------------------------------------------------------------------------

/**
 * Compute period returns from daily candle history.
 * Returns a map of "TICKER:months" → return fraction (e.g. 0.15 for +15%).
 * Supports skip_months by excluding the most recent N months of data.
 */
export function computePeriodReturns(
  histories: TickerPriceHistory[],
  periods: { months: number; skipMonths?: number }[],
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const h of histories) {
    if (!h.history || h.history.length === 0) continue;

    // Sort ascending by date
    const sorted = [...h.history].sort((a, b) => a.date.localeCompare(b.date));

    for (const { months, skipMonths } of periods) {
      const skip = skipMonths ?? 0;
      const now = new Date();
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() - skip);
      const startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - months);

      // Find the candle closest to startDate and endDate
      const startCandle = sorted.find((c) => c.date >= startDate.toISOString().slice(0, 10));
      const endCandidates = sorted.filter((c) => c.date <= endDate.toISOString().slice(0, 10));
      const endCandle = endCandidates.length > 0 ? endCandidates[endCandidates.length - 1] : null;

      if (startCandle && endCandle && startCandle.close > 0) {
        const ret = (endCandle.close - startCandle.close) / startCandle.close;
        result[`${h.ticker}:${months}`] = ret;
      }
    }
  }

  return result;
}

/** Compute drawdown as (price - high) / high. Returns 0 when high is missing or zero. */
export function computeDrawdown(currentPrice: number, fiftyTwoWeekHigh: number | null | undefined): number {
  if (!fiftyTwoWeekHigh) return 0;
  return (currentPrice - fiftyTwoWeekHigh) / fiftyTwoWeekHigh;
}

/** Build PortfolioContext from snapshot + Jintel enrichment data. */
export function buildPortfolioContext(
  snapshot: MinimalSnapshot,
  quotes: MarketQuote[],
  entities: Entity[],
  priceHistories?: TickerPriceHistory[],
): PortfolioContext {
  const weights: Record<string, number> = {};
  const prices: Record<string, number> = {};
  const priceChanges: Record<string, number> = {};
  const indicators: Record<string, Record<string, number>> = {};
  const earningsDays: Record<string, number> = {};
  const positionDrawdowns: Record<string, number> = {};

  const quoteMap = new Map(quotes.map((q) => [q.ticker, q]));
  const entityMap = new Map(entities.map((e) => [e.tickers?.[0] ?? e.id, e]));

  const totalValue = snapshot.totalValue || 0;
  const now = Date.now();

  for (const pos of snapshot.positions) {
    const sym = pos.symbol;
    const quote = quoteMap.get(sym);
    const entity = entityMap.get(sym);

    // Weights
    if (totalValue > 0) {
      weights[sym] = pos.marketValue / totalValue;
    }

    // Prices — prefer live quote, fall back to snapshot
    const price = quote?.price ?? pos.currentPrice;
    prices[sym] = price;

    // Price changes — convert percentage to fraction
    if (quote) {
      priceChanges[sym] = quote.changePercent / 100;
    }

    // Indicators from entity technicals
    if (entity?.technicals) {
      const mapped = mapIndicators(entity.technicals);
      if (Object.keys(mapped).length > 0) {
        indicators[sym] = mapped;
      }
    }

    // Drawdown from fundamentals
    const high = entity?.market?.fundamentals?.fiftyTwoWeekHigh;
    positionDrawdowns[sym] = computeDrawdown(price, high);

    // Earnings days — from fundamentals.earningsDate if present and in the future
    const earningsDate = (entity?.market?.fundamentals as { earningsDate?: string | null } | null | undefined)
      ?.earningsDate;
    if (earningsDate) {
      const days = Math.ceil((new Date(earningsDate).getTime() - now) / MS_PER_DAY);
      if (days >= 0) {
        earningsDays[sym] = days;
      }
    }
  }

  // Portfolio drawdown — weighted sum of position drawdowns
  let portfolioDrawdown = 0;
  for (const sym of Object.keys(positionDrawdowns)) {
    const w = weights[sym] ?? 0;
    portfolioDrawdown += w * positionDrawdowns[sym];
  }

  // Compute multi-period returns if price history is available
  const periodReturns =
    priceHistories && priceHistories.length > 0
      ? computePeriodReturns(priceHistories, [{ months: 12, skipMonths: 1 }, { months: 6 }, { months: 3 }])
      : undefined;

  return {
    weights,
    prices,
    priceChanges,
    indicators,
    earningsDays,
    portfolioDrawdown,
    positionDrawdowns,
    ...(periodReturns && Object.keys(periodReturns).length > 0 ? { periodReturns } : {}),
  };
}
