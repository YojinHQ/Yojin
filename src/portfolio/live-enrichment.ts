import type { JintelClient, MarketQuote, TickerPriceHistory } from '@yojinhq/jintel-client';

import type { PortfolioSnapshot, Position } from '../api/graphql/types.js';
import { getLogger } from '../logging/index.js';

const log = getLogger().sub('portfolio-live-enrichment');

/** Check if the US stock market is currently in regular trading hours (9:30–16:00 ET, Mon–Fri). */
export function isUSMarketOpen(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false; // weekend
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes >= 570 && minutes < 960; // 9:30 (570) to 16:00 (960)
}

/** Check if today is a US weekday (Mon–Fri). Used to decide intraday vs multi-day sparkline range. */
function isUSWeekday(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  return day !== 0 && day !== 6;
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
 *  and keeps only the latest trading date so a multi-session 1d range doesn't produce an overnight cliff. */
function buildSparkline(history: TickerPriceHistory, livePrice: number, regularHoursOnly = false): number[] {
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
  points.push(livePrice);
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
  const symbols = [...new Set(snapshot.positions.map((p) => p.symbol))];
  log.debug('Fetching live quotes', { symbols });

  // Crypto trades 24/7 → always intraday. Equities → intraday only during US market hours.
  const cryptoSet = new Set(snapshot.positions.filter((p) => p.assetClass === 'CRYPTO').map((p) => p.symbol));
  const equitySymbols = symbols.filter((s) => !cryptoSet.has(s));
  const cryptoSymbols = symbols.filter((s) => cryptoSet.has(s));

  const fetchHistory = (tickers: string[], range: string, interval?: string) =>
    client.priceHistory(tickers, range, interval).catch((err: unknown) => {
      log.warn('Jintel priceHistory failed', { tickers, error: String(err) });
      return undefined;
    });

  const weekday = isUSWeekday();
  const equityRange = weekday ? '1d' : '5d';
  const equityInterval = weekday ? '5m' : undefined;

  const [result, equityHistory, cryptoHistory] = await Promise.all([
    client.quotes(symbols).catch((err: unknown) => {
      log.warn('Jintel quotes call failed', { error: String(err) });
      return undefined;
    }),
    equitySymbols.length > 0 ? fetchHistory(equitySymbols, equityRange, equityInterval) : undefined,
    cryptoSymbols.length > 0 ? fetchHistory(cryptoSymbols, '1d') : undefined,
  ]);

  if (!result?.success) {
    const errorMsg = result && 'error' in result ? (result as { error: string }).error : 'no result';
    log.warn('Jintel quotes returned non-success', {
      success: result?.success,
      error: errorMsg,
    });

    const warnings: string[] = [];
    if (typeof errorMsg === 'string' && /request limit/i.test(errorMsg)) {
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

  const validQuotes = result.data.filter((q): q is MarketQuote => q != null);

  log.info('Jintel quotes received', {
    requested: symbols.length,
    received: validQuotes.length,
    tickers: validQuotes.map((q) => q.ticker),
  });

  const quoteMap = new Map<string, MarketQuote>(validQuotes.map((q) => [q.ticker, q]));

  const historyMap = new Map<string, TickerPriceHistory>();
  for (const res of [equityHistory, cryptoHistory]) {
    if (res?.success) {
      for (const h of res.data) historyMap.set(h.ticker, h);
    }
  }
  if (historyMap.size > 0) {
    log.debug('Jintel priceHistory received', { tickers: [...historyMap.keys()] });
  }

  const positions: Position[] = snapshot.positions.map((pos) => {
    const quote = quoteMap.get(pos.symbol);
    if (!quote) {
      log.debug('No quote found for position', { symbol: pos.symbol, availableTickers: [...quoteMap.keys()] });
      return pos;
    }

    const currentPrice = quote.price;
    const marketValue = pos.quantity * currentPrice;
    const hasCostBasis = pos.costBasis > 0;
    const totalCost = hasCostBasis ? pos.costBasis * pos.quantity : 0;

    const priceHist = historyMap.get(pos.symbol);
    const isEquity = !cryptoSet.has(pos.symbol);
    const sparkline =
      priceHist && priceHist.history.length > 0
        ? buildSparkline(priceHist, currentPrice, weekday && isEquity)
        : undefined;

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
