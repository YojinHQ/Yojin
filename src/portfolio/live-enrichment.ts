import type { JintelClient, MarketQuote, TickerPriceHistory } from '@yojinhq/jintel-client';

import type { PortfolioSnapshot, Position } from '../api/graphql/types.js';
import { getLogger } from '../logging/index.js';

const log = getLogger().sub('portfolio-live-enrichment');

// ---------------------------------------------------------------------------
// Quote cache — avoids hammering Jintel on repeated polls (30s frontend interval)
// ---------------------------------------------------------------------------

const QUOTE_CACHE_TTL_MS = 15_000; // 15 seconds

interface CachedQuotes {
  quotes: MarketQuote[];
  fetchedAt: number;
}

// Keyed by sorted symbols string for stable cache hits
const quoteCache = new Map<string, CachedQuotes>();

function getCachedQuotes(symbols: string[]): MarketQuote[] | undefined {
  const key = symbols.slice().sort().join(',');
  const cached = quoteCache.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.fetchedAt > QUOTE_CACHE_TTL_MS) {
    quoteCache.delete(key);
    return undefined;
  }
  return cached.quotes;
}

function setCachedQuotes(symbols: string[], quotes: MarketQuote[]): void {
  const key = symbols.slice().sort().join(',');
  quoteCache.set(key, { quotes, fetchedAt: Date.now() });
}

const HISTORY_CACHE_TTL_MS = 30_000; // 30 seconds — sparklines change slowly

interface CachedHistory {
  data: Map<string, TickerPriceHistory>;
  fetchedAt: number;
}

const historyCache = new Map<string, CachedHistory>();

function getCachedHistory(
  tickers: string[],
  range: string,
  interval?: string,
): Map<string, TickerPriceHistory> | undefined {
  const key = `${tickers.slice().sort().join(',')}_${range}_${interval ?? ''}`;
  const cached = historyCache.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.fetchedAt > HISTORY_CACHE_TTL_MS) {
    historyCache.delete(key);
    return undefined;
  }
  return cached.data;
}

function setCachedHistory(
  tickers: string[],
  range: string,
  interval: string | undefined,
  data: Map<string, TickerPriceHistory>,
): void {
  const key = `${tickers.slice().sort().join(',')}_${range}_${interval ?? ''}`;
  historyCache.set(key, { data, fetchedAt: Date.now() });
}

/** Clear all quote and history caches. Exported for tests. */
export function clearLiveEnrichmentCache(): void {
  quoteCache.clear();
  historyCache.clear();
}

/** Check if the US stock market is currently in regular trading hours (9:30–16:00 ET, Mon–Fri). */
export function isUSMarketOpen(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false; // weekend
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes >= 570 && minutes < 960; // 9:30 (570) to 16:00 (960)
}

/** Check if the US equity market has been open today (Mon–Fri, after 9:30 AM ET).
 *  Pre-market (before 9:30 AM ET on a weekday) returns false because a `1d` range
 *  would only contain pre-market candles that the regular-hours filter strips out,
 *  leaving an empty sparkline. Returning false widens the range to 5d so the
 *  previous session's price action is visible instead. */
function isUSMarketSessionAvailable(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes >= 570; // 9:30 AM ET
}

/** Parse a candle timestamp as UTC. The Jintel API returns UTC timestamps
 *  without a timezone suffix (e.g. '2026-03-31 16:30:00'). Bare `new Date()`
 *  treats these as local time, shifting the regular-hours filter by the host's
 *  UTC offset and selecting the wrong session's candles. */
function parseUTC(dateStr: string): Date {
  if (dateStr.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(dateStr)) return new Date(dateStr);
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}

/** Return the ET calendar date key (YYYY-MM-DD) for a UTC timestamp string. */
function toETDate(dateStr: string): string {
  const d = parseUTC(dateStr);
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;
}

/** Build a sparkline from price history closing prices.
 *  When `regularHoursOnly` is true, strips pre-market (<9:30 AM ET) and after-hours (>=4:00 PM ET) candles
 *  and keeps only the latest trading date so a multi-session 1d range doesn't produce an overnight cliff.
 *  When `livePrice` is omitted (e.g. the live quote endpoint returned no data for this ticker),
 *  the sparkline ends at the most recent close from history instead. */
function buildSparkline(history: TickerPriceHistory, livePrice?: number, regularHoursOnly = false): number[] {
  let candles = history.history;
  if (regularHoursOnly) {
    candles = candles.filter((p) => {
      const d = parseUTC(p.date);
      const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const minutes = et.getHours() * 60 + et.getMinutes();
      return minutes >= 570 && minutes < 960; // 9:30 AM – 4:00 PM ET
    });
    if (candles.length > 1) {
      const latest = toETDate(candles[candles.length - 1].date);
      candles = candles.filter((p) => toETDate(p.date) === latest);
    }
  }
  const points = candles.map((p) => p.close);
  if (livePrice !== undefined) points.push(livePrice);
  return points;
}

/**
 * Normalize a stored portfolio snapshot with live quotes.
 *
 * This is shared by the GraphQL portfolio resolver and the display tools so
 * web, chat, and channel output all show the same portfolio totals and prices.
 */
export async function enrichPortfolioSnapshotWithLiveQuotes(
  snapshot: PortfolioSnapshot,
  jintelClient?: JintelClient,
): Promise<PortfolioSnapshot> {
  if (!jintelClient || snapshot.positions.length === 0) {
    log.debug('enrichPortfolioSnapshotWithLiveQuotes skipped', {
      hasClient: !!jintelClient,
      positionCount: snapshot.positions.length,
    });
    return {
      ...snapshot,
      totalDayChange: snapshot.totalDayChange ?? 0,
      totalDayChangePercent: snapshot.totalDayChangePercent ?? 0,
    };
  }

  const client = jintelClient;
  const symbols = [...new Set(snapshot.positions.map((p) => p.symbol.toUpperCase()))];
  log.debug('Fetching live quotes', { symbols });

  // Crypto trades 24/7 → always intraday. Equities → intraday only during US market hours.
  const cryptoSet = new Set(
    snapshot.positions.filter((p) => p.assetClass === 'CRYPTO').map((p) => p.symbol.toUpperCase()),
  );
  const equitySymbols = symbols.filter((s) => !cryptoSet.has(s));
  const cryptoSymbols = symbols.filter((s) => cryptoSet.has(s));

  const marketSessionAvailable = isUSMarketSessionAvailable();
  // During/after regular hours fetch today's session; before market open,
  // weekends, and holidays widen to 5d so buildSparkline can find the most
  // recent complete trading session.
  const equityRange = marketSessionAvailable ? '1d' : '5d';
  // Always 5m so weekend/holiday sparklines show the last session's open→close
  // price action at the same resolution as weekday sparklines.
  const equityInterval = '5m';

  // Check quote cache first to avoid hammering Jintel on repeated polls
  const cachedQuotes = getCachedQuotes(symbols);

  const fetchHistory = (tickers: string[], range: string, interval?: string) => {
    const cached = getCachedHistory(tickers, range, interval);
    if (cached) {
      log.debug('Using cached priceHistory', { tickers });
      return Promise.resolve(cached);
    }
    return client
      .priceHistory(tickers, range, interval)
      .then((res) => {
        if (res?.success) {
          const map = new Map<string, TickerPriceHistory>();
          for (const h of res.data) map.set(h.ticker, h);
          setCachedHistory(tickers, range, interval, map);
          return map;
        }
        return undefined;
      })
      .catch((err: unknown) => {
        log.warn('Jintel priceHistory failed', { tickers, error: String(err) });
        return undefined;
      });
  };

  // Fetch quotes + history in parallel (all respect their own caches)
  const quotesPromise = cachedQuotes
    ? Promise.resolve(cachedQuotes)
    : client
        .quotes(symbols)
        .then((result) => {
          if (!result?.success) {
            const errorMsg = result && 'error' in result ? (result as { error: string }).error : 'no result';
            log.warn('Jintel quotes returned non-success', { success: result?.success, error: errorMsg });
            return { error: errorMsg };
          }
          const quotes = result.data.filter((q): q is MarketQuote => q != null);
          setCachedQuotes(symbols, quotes);
          log.info('Jintel quotes received', {
            requested: symbols.length,
            received: quotes.length,
            tickers: quotes.map((q) => q.ticker),
          });
          return quotes;
        })
        .catch((err: unknown) => {
          log.warn('Jintel quotes call failed', { error: String(err) });
          return { error: String(err) };
        });

  const [quotesResult, equityHistoryMap, cryptoHistoryMap] = await Promise.all([
    quotesPromise,
    equitySymbols.length > 0 ? fetchHistory(equitySymbols, equityRange, equityInterval) : undefined,
    cryptoSymbols.length > 0 ? fetchHistory(cryptoSymbols, '1d') : undefined,
  ]);

  // Handle quotes failure
  if (!Array.isArray(quotesResult)) {
    const warnings: string[] = [];
    if (typeof quotesResult.error === 'string' && /request limit/i.test(quotesResult.error)) {
      warnings.push(
        'Jintel API daily request limit exceeded. Upgrade your plan at https://api.jintel.ai/billing for higher limits.',
      );
    }
    return {
      ...snapshot,
      totalDayChange: snapshot.totalDayChange ?? 0,
      totalDayChangePercent: snapshot.totalDayChangePercent ?? 0,
      warnings,
    };
  }

  if (cachedQuotes) {
    log.debug('Using cached quotes', { symbols });
  }

  const quoteMap = new Map<string, MarketQuote>(quotesResult.map((q) => [q.ticker, q]));

  const historyMap = new Map<string, TickerPriceHistory>();
  for (const map of [equityHistoryMap, cryptoHistoryMap]) {
    if (map) {
      for (const [k, v] of map) historyMap.set(k, v);
    }
  }
  if (historyMap.size > 0) {
    log.debug('priceHistory available', { tickers: [...historyMap.keys()] });
  }

  const positions: Position[] = snapshot.positions.map((pos) => {
    const upperSymbol = pos.symbol.toUpperCase();
    const quote = quoteMap.get(upperSymbol);
    const priceHist = historyMap.get(upperSymbol);
    const isEquity = !cryptoSet.has(upperSymbol);

    // Jintel's /quotes endpoint has coverage gaps (e.g. some ETFs return null),
    // but /priceHistory often still has data. Fall back to history so the UI
    // gets a fresh price + sparkline instead of stale scrape values.
    if (!quote) {
      log.debug('No quote found for position', { symbol: pos.symbol, availableTickers: [...quoteMap.keys()] });
      if (!priceHist || priceHist.history.length === 0) return pos;
      const lastClose = priceHist.history[priceHist.history.length - 1]?.close;
      if (lastClose === undefined) return pos;
      const sparkline = buildSparkline(priceHist, undefined, isEquity);
      const hasCostBasis = pos.costBasis > 0;
      const marketValue = pos.quantity * lastClose;
      const totalCost = hasCostBasis ? pos.costBasis * pos.quantity : 0;
      return {
        ...pos,
        currentPrice: lastClose,
        marketValue,
        unrealizedPnl: hasCostBasis ? marketValue - totalCost : 0,
        unrealizedPnlPercent: hasCostBasis ? ((lastClose - pos.costBasis) / pos.costBasis) * 100 : 0,
        sparkline: sparkline.length >= 2 ? sparkline : undefined,
      };
    }

    const currentPrice = quote.price;
    const marketValue = pos.quantity * currentPrice;
    const hasCostBasis = pos.costBasis > 0;
    const totalCost = hasCostBasis ? pos.costBasis * pos.quantity : 0;

    const sparkline =
      priceHist && priceHist.history.length > 0 ? buildSparkline(priceHist, currentPrice, isEquity) : undefined;

    return {
      ...pos,
      currentPrice,
      marketValue,
      dayChange: quote.change,
      dayChangePercent: quote.changePercent,
      preMarketChange: quote.preMarketChange ?? null,
      preMarketChangePercent: quote.preMarketChangePercent ?? null,
      postMarketChange: quote.postMarketChange ?? null,
      postMarketChangePercent: quote.postMarketChangePercent ?? null,
      unrealizedPnl: hasCostBasis ? marketValue - totalCost : 0,
      unrealizedPnlPercent: hasCostBasis ? ((currentPrice - pos.costBasis) / pos.costBasis) * 100 : 0,
      sparkline,
    };
  });

  let totalValue = 0;
  let totalCost = 0;
  let totalDayChange = 0;
  for (const p of positions) {
    totalValue += p.marketValue;
    totalCost += p.costBasis * p.quantity;
    totalDayChange += (p.dayChange ?? 0) * p.quantity;
  }
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const prevValue = totalValue - totalDayChange;
  const totalDayChangePercent = prevValue > 0 ? (totalDayChange / prevValue) * 100 : 0;

  return {
    ...snapshot,
    positions,
    totalValue,
    totalCost,
    totalPnl,
    totalPnlPercent,
    totalDayChange,
    totalDayChangePercent,
  };
}
