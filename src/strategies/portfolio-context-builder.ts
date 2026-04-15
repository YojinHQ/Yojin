/**
 * Portfolio Context Builder — transforms raw portfolio snapshot + Jintel enrichment data
 * into a PortfolioContext suitable for StrategyEvaluator trigger evaluation.
 */

import type {
  Entity,
  Fundamentals,
  MarketQuote,
  SocialSentiment,
  TechnicalIndicators,
  TickerPriceHistory,
} from '@yojinhq/jintel-client';

import type { PortfolioContext } from './strategy-evaluator.js';
import type { AssetClass } from '../api/graphql/types.js';
import type { Signal } from '../signals/types.js';

/** Single-quarter earnings history row from Jintel fundamentals. */
type EarningsHistoryEntry = NonNullable<Fundamentals['earningsHistory']>[number];

interface MinimalPosition {
  symbol: string;
  currentPrice: number;
  marketValue: number;
  assetClass?: AssetClass;
}

interface MinimalSnapshot {
  positions: MinimalPosition[];
  totalValue: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Supported lookback periods (months) for PRICE_MOVE triggers. */
export const SUPPORTED_LOOKBACK_MONTHS = [3, 6, 12] as const;

/** Map Jintel TechnicalIndicators to a flat key→number record for trigger evaluation. */
export function mapIndicators(technicals: TechnicalIndicators | null | undefined): Record<string, number> {
  if (!technicals) return {};

  const result: Record<string, number> = {};

  // Oscillators
  if (technicals.rsi != null) result.RSI = technicals.rsi;
  if (technicals.mfi != null) result.MFI = technicals.mfi;
  if (technicals.williamsR != null) result.WILLIAMS_R = technicals.williamsR;
  if (technicals.stochastic != null) {
    result.STOCH_K = technicals.stochastic.k;
    result.STOCH_D = technicals.stochastic.d;
  }

  // Moving averages
  if (technicals.ema != null) result.EMA = technicals.ema;
  if (technicals.ema50 != null) result.EMA_50 = technicals.ema50;
  if (technicals.ema200 != null) result.EMA_200 = technicals.ema200;
  if (technicals.sma != null) result.SMA = technicals.sma;
  if (technicals.sma20 != null) result.SMA_20 = technicals.sma20;
  if (technicals.sma200 != null) result.SMA_200 = technicals.sma200;
  if (technicals.wma52 != null) result.WMA_52 = technicals.wma52;
  if (technicals.vwma != null) result.VWMA = technicals.vwma;
  if (technicals.vwap != null) result.VWAP = technicals.vwap;

  // Volatility & trend
  if (technicals.atr != null) result.ATR = technicals.atr;
  if (technicals.adx != null) result.ADX = technicals.adx;
  if (technicals.parabolicSar != null) result.PSAR = technicals.parabolicSar;
  if (technicals.bollingerBandsWidth != null) result.BB_WIDTH = technicals.bollingerBandsWidth;

  // Volume
  if (technicals.obv != null) result.OBV = technicals.obv;

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

  // Crossover flags (1 = active, 0 = inactive)
  if (technicals.crossovers != null) {
    result.GOLDEN_CROSS = technicals.crossovers.goldenCross ? 1 : 0;
    result.DEATH_CROSS = technicals.crossovers.deathCross ? 1 : 0;
    result.EMA_CROSS = technicals.crossovers.emaCross ? 1 : 0;
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

  // Pre-compute date bounds once — stable across all tickers and periods.
  const now = new Date();
  const bounds = periods.map(({ months, skipMonths }) => {
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() - (skipMonths ?? 0));
    const startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - months);
    return {
      months,
      startIso: startDate.toISOString().slice(0, 10),
      endIso: endDate.toISOString().slice(0, 10),
    };
  });

  for (const h of histories) {
    if (!h.history || h.history.length === 0) continue;

    // Sort ascending by date
    const sorted = [...h.history].sort((a, b) => a.date.localeCompare(b.date));

    for (const { months, startIso, endIso } of bounds) {
      const startCandle = sorted.find((c) => c.date >= startIso);
      let endCandle = null;
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].date <= endIso) {
          endCandle = sorted[i];
          break;
        }
      }

      if (startCandle && endCandle && startCandle.close > 0) {
        const ret = (endCandle.close - startCandle.close) / startCandle.close;
        result[`${h.ticker}:${months}`] = ret;
      }
    }
  }

  return result;
}

/**
 * Compute Standardized Unexpected Earnings (SUE) from a quarterly earnings history.
 * SUE = most-recent epsDifference / sample stddev of epsDifference across available quarters.
 * Returns null if fewer than 2 usable quarters or if the stddev is zero.
 * Assumes the input array is newest-first (Yahoo's convention).
 */
export function computeSUE(history: EarningsHistoryEntry[] | null | undefined): number | null {
  if (!history || history.length === 0) return null;
  const diffs = history.map((h) => h.epsDifference).filter((x): x is number => x != null);
  if (diffs.length < 2) return null;
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (diffs.length - 1);
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return null;
  return diffs[0] / stddev;
}

/**
 * Compute 24h sentiment momentum as the fractional change in mention volume.
 * Returns null when the baseline is missing or zero.
 */
export function computeSentimentMomentum24h(sentiment: SocialSentiment | null | undefined): number | null {
  if (!sentiment) return null;
  const { mentions, mentions24hAgo } = sentiment;
  if (mentions24hAgo == null || mentions24hAgo === 0) return null;
  return (mentions - mentions24hAgo) / mentions24hAgo;
}

/**
 * Map per-ticker numeric metrics from a Jintel Entity into a flat record.
 * Only populates keys with non-null upstream data — absent metrics are simply omitted.
 */
export function mapMetrics(entity: Entity | null | undefined): Record<string, number> {
  if (!entity) return {};
  const result: Record<string, number> = {};

  const fundamentals = entity.market?.fundamentals;

  if (fundamentals?.priceToBook != null) result.priceToBook = fundamentals.priceToBook;
  if (fundamentals?.bookValue != null) result.bookValue = fundamentals.bookValue;

  const sue = computeSUE(fundamentals?.earningsHistory);
  if (sue != null) result.SUE = sue;

  const momentum = computeSentimentMomentum24h(entity.sentiment);
  if (momentum != null) result.sentiment_momentum_24h = momentum;

  return result;
}

/** Compute drawdown as (price - high) / high. Returns 0 when high is missing or zero. */
export function computeDrawdown(currentPrice: number, fiftyTwoWeekHigh: number | null | undefined): number {
  if (!fiftyTwoWeekHigh) return 0;
  return (currentPrice - fiftyTwoWeekHigh) / fiftyTwoWeekHigh;
}

/**
 * Build a lightweight PortfolioContext for a single ticker from micro flow data.
 * Reuses the same helpers as the full builder but avoids fetching all tickers.
 * `periodReturns` is omitted (needs 1-year price history not available in micro flow).
 */
export function buildSingleTickerContext(
  ticker: string,
  entity: Entity,
  quote: { price: number; changePercent: number },
  snapshot: { marketValue: number; totalValue: number },
  signals: Signal[],
  assetClass?: AssetClass,
): PortfolioContext {
  const weight = snapshot.totalValue > 0 ? snapshot.marketValue / snapshot.totalValue : 0;
  const price = quote.price;
  const priceChange = quote.changePercent / 100; // convert % to fraction

  const indicatorsMap = mapIndicators(entity.technicals);
  const metricsMap = mapMetrics(entity);

  const high = entity.market?.fundamentals?.fiftyTwoWeekHigh;
  const drawdown = computeDrawdown(price, high);

  const earningsDays: Record<string, number> = {};
  const earningsDate = entity.market?.fundamentals?.earningsDate;
  if (earningsDate) {
    const days = Math.ceil((new Date(earningsDate).getTime() - Date.now()) / MS_PER_DAY);
    if (days >= 0) earningsDays[ticker] = days;
  }

  return {
    weights: { [ticker]: weight },
    prices: { [ticker]: price },
    priceChanges: { [ticker]: priceChange },
    indicators: Object.keys(indicatorsMap).length > 0 ? { [ticker]: indicatorsMap } : {},
    earningsDays,
    portfolioDrawdown: 0, // not meaningful for single ticker
    positionDrawdowns: { [ticker]: drawdown },
    metrics: Object.keys(metricsMap).length > 0 ? { [ticker]: metricsMap } : {},
    signals: { [ticker]: signals },
    ...(assetClass ? { assetClasses: { [ticker]: assetClass } } : {}),
  };
}

/** Build PortfolioContext from snapshot + Jintel enrichment data. */
export function buildPortfolioContext(
  snapshot: MinimalSnapshot,
  quotes: MarketQuote[],
  entities: Entity[],
  priceHistories?: TickerPriceHistory[],
  signalsByTicker?: Record<string, Signal[]>,
): PortfolioContext {
  const weights: Record<string, number> = {};
  const prices: Record<string, number> = {};
  const priceChanges: Record<string, number> = {};
  const indicators: Record<string, Record<string, number>> = {};
  const earningsDays: Record<string, number> = {};
  const positionDrawdowns: Record<string, number> = {};
  const metrics: Record<string, Record<string, number>> = {};
  const assetClasses: Record<string, AssetClass> = {};

  const quoteMap = new Map(quotes.filter(Boolean).map((q) => [q.ticker, q]));
  const entityMap = new Map(entities.filter(Boolean).map((e) => [e.tickers?.[0] ?? e.id, e]));

  const totalValue = snapshot.totalValue || 0;
  const now = Date.now();

  for (const pos of snapshot.positions) {
    const sym = pos.symbol;
    const quote = quoteMap.get(sym);
    const entity = entityMap.get(sym);

    if (pos.assetClass) assetClasses[sym] = pos.assetClass;

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

    // Numeric metrics (SUE, sentiment momentum, P/B, book value, ...)
    const mappedMetrics = mapMetrics(entity);
    if (Object.keys(mappedMetrics).length > 0) {
      metrics[sym] = mappedMetrics;
    }

    // Drawdown from fundamentals
    const high = entity?.market?.fundamentals?.fiftyTwoWeekHigh;
    positionDrawdowns[sym] = computeDrawdown(price, high);

    // Earnings days — from fundamentals.earningsDate if present and in the future
    const earningsDate = entity?.market?.fundamentals?.earningsDate;
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
      ? computePeriodReturns(
          priceHistories,
          SUPPORTED_LOOKBACK_MONTHS.map((m) => (m === 12 ? { months: m, skipMonths: 1 } : { months: m })),
        )
      : undefined;

  return {
    weights,
    prices,
    priceChanges,
    indicators,
    earningsDays,
    portfolioDrawdown,
    positionDrawdowns,
    metrics,
    signals: signalsByTicker ?? {},
    ...(Object.keys(assetClasses).length > 0 ? { assetClasses } : {}),
    ...(periodReturns && Object.keys(periodReturns).length > 0 ? { periodReturns } : {}),
  };
}
