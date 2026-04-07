/**
 * Market resolvers — quote, news.
 *
 * When JintelClient is injected, resolvers fetch live data and fall back to
 * stubs on failure. Without a client, stubs are returned directly.
 */

import type { JintelClient, USMarketStatus } from '@yojinhq/jintel-client';

import { createSubsystemLogger } from '../../../logging/logger.js';
import type { Article, Quote, SymbolSearchResult } from '../types.js';

const log = createSubsystemLogger('market-resolver');

// ---------------------------------------------------------------------------
// Module-level state (injected via setters from composition root)
// ---------------------------------------------------------------------------

let jintelClient: JintelClient | undefined;

export function setMarketJintelClient(c: JintelClient | undefined): void {
  jintelClient = c;
}

// ---------------------------------------------------------------------------
// Stub data (fallback when Jintel is unavailable)
// ---------------------------------------------------------------------------

const stubQuotes: Record<string, Quote> = {
  AAPL: {
    symbol: 'AAPL',
    price: 178.5,
    change: 2.3,
    changePercent: 1.31,
    volume: 52_340_000,
    high: 179.8,
    low: 175.2,
    open: 176.0,
    previousClose: 176.2,
    timestamp: new Date().toISOString(),
  },
  MSFT: {
    symbol: 'MSFT',
    price: 415.2,
    change: -1.8,
    changePercent: -0.43,
    volume: 21_500_000,
    high: 418.0,
    low: 413.5,
    open: 417.0,
    previousClose: 417.0,
    timestamp: new Date().toISOString(),
  },
  BTC: {
    symbol: 'BTC',
    price: 67500.0,
    change: 1250.0,
    changePercent: 1.89,
    volume: 28_000_000_000,
    high: 68200.0,
    low: 65800.0,
    open: 66250.0,
    previousClose: 66250.0,
    timestamp: new Date().toISOString(),
  },
};

const stubArticles: Article[] = [
  {
    id: 'news-1',
    title: 'Apple Reports Record Q4 Revenue',
    source: 'Reuters',
    url: 'https://example.com/apple-q4',
    publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
    summary: 'Apple Inc. reported record fourth-quarter revenue driven by iPhone and Services growth.',
    symbols: ['AAPL'],
    sentiment: 0.85,
  },
  {
    id: 'news-2',
    title: 'Bitcoin Surges Past $67K on ETF Inflows',
    source: 'CoinDesk',
    url: 'https://example.com/btc-surge',
    publishedAt: new Date(Date.now() - 7_200_000).toISOString(),
    summary: 'Bitcoin rallied to new highs as institutional ETF inflows accelerated.',
    symbols: ['BTC'],
    sentiment: 0.78,
  },
  {
    id: 'news-3',
    title: 'Microsoft Azure Growth Slows Slightly',
    source: 'Bloomberg',
    url: 'https://example.com/msft-azure',
    publishedAt: new Date(Date.now() - 14_400_000).toISOString(),
    summary: 'Azure revenue growth decelerated to 29% year-over-year in the latest quarter.',
    symbols: ['MSFT'],
    sentiment: -0.12,
  },
];

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function quoteQuery(_parent: unknown, args: { symbol: string }): Promise<Quote | null> {
  const sym = args.symbol.toUpperCase();

  if (jintelClient) {
    // Try enrichEntity first — single call gets both name and quote via market sub-graph
    const result = await jintelClient.enrichEntity(sym, ['market']).catch(() => ({
      success: false as const,
      error: 'enrichEntity threw',
      data: undefined as never,
    }));
    if (result.success && result.data?.market?.quote) {
      const q = result.data.market.quote;
      return {
        symbol: q.ticker,
        name: result.data.name,
        price: q.price,
        change: q.change,
        changePercent: q.changePercent,
        volume: q.volume,
        high: q.high ?? 0,
        low: q.low ?? 0,
        open: q.open ?? 0,
        previousClose: q.previousClose ?? 0,
        timestamp: q.timestamp,
      };
    }
    // Fallback: entity not found or has no market quote — try standalone quotes()
    const quotesResult = await jintelClient.quotes([sym]).catch(() => undefined);
    if (quotesResult?.success && quotesResult.data[0]) {
      const q = quotesResult.data[0];
      return {
        symbol: q.ticker,
        name: (result.success ? result.data?.name : undefined) ?? q.ticker,
        price: q.price,
        change: q.change,
        changePercent: q.changePercent,
        volume: q.volume,
        high: q.high ?? 0,
        low: q.low ?? 0,
        open: q.open ?? 0,
        previousClose: q.previousClose ?? 0,
        timestamp: q.timestamp,
      };
    }
    log.warn('Jintel quote failed, using stub', { symbol: sym });
  }

  return stubQuotes[sym] ?? null;
}

// ---------------------------------------------------------------------------
// Price history
// ---------------------------------------------------------------------------

interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TickerPriceHistory {
  ticker: string;
  history: PricePoint[];
}

export async function priceHistoryQuery(
  _parent: unknown,
  args: { tickers: string[]; range?: string; interval?: string },
): Promise<TickerPriceHistory[]> {
  if (!jintelClient) return [];

  try {
    const result = await jintelClient.priceHistory(
      args.tickers.map((t) => t.toUpperCase()),
      args.range ?? '1y',
      args.interval,
    );
    return result.success ? result.data : [];
  } catch (err) {
    log.warn('Jintel priceHistory failed', { tickers: args.tickers, error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Market status (NYSE holiday-aware, proxied from Jintel)
// ---------------------------------------------------------------------------

export async function marketStatusQuery(): Promise<USMarketStatus> {
  if (jintelClient) {
    try {
      const result = await jintelClient.marketStatus();
      if (result.success) return result.data;
      log.warn('Jintel marketStatus returned error, falling back to local', { error: result.error });
    } catch (err) {
      log.warn('Jintel marketStatus failed, falling back to local', { error: String(err) });
    }
  }
  // Fallback: local weekend-only check (no holiday awareness)
  return computeLocalMarketStatus();
}

function computeLocalMarketStatus(): USMarketStatus {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const dateKey = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;

  if (day === 0 || day === 6) {
    return { isOpen: false, isTradingDay: false, session: 'CLOSED', holiday: null, date: dateKey };
  }

  const minutes = et.getHours() * 60 + et.getMinutes();
  let session: USMarketStatus['session'];
  if (minutes < 240) session = 'CLOSED';
  else if (minutes < 570) session = 'PRE_MARKET';
  else if (minutes < 960) session = 'OPEN';
  else if (minutes < 1200) session = 'AFTER_HOURS';
  else session = 'CLOSED';

  return { isOpen: session === 'OPEN', isTradingDay: true, session, holiday: null, date: dateKey };
}

export function newsQuery(_parent: unknown, args: { symbol?: string; limit?: number }): Article[] {
  let articles = stubArticles;
  if (args.symbol) {
    const sym = args.symbol.toUpperCase();
    articles = articles.filter((a) => a.symbols.includes(sym));
  }
  if (args.limit && args.limit > 0) {
    articles = articles.slice(0, args.limit);
  }
  return articles;
}

// ---------------------------------------------------------------------------
// Symbol search (backed by Jintel searchEntities)
// ---------------------------------------------------------------------------

/** Map Jintel entity type to our AssetClass enum. */
function entityTypeToAssetClass(type: string): string {
  if (type === 'CRYPTO') return 'CRYPTO';
  return 'EQUITY';
}

export async function searchSymbolsQuery(
  _parent: unknown,
  args: { query: string; limit?: number },
): Promise<SymbolSearchResult[]> {
  const q = args.query.trim();
  if (!q || !jintelClient) return [];

  const result = await jintelClient.searchEntities(q, { limit: args.limit ?? 10 }).catch(() => ({
    success: false as const,
    error: 'searchEntities threw',
    data: [] as never[],
  }));

  if (!result.success) {
    log.warn('Jintel searchEntities failed', { query: q, error: result.error });
    return [];
  }

  return result.data.map((entity) => ({
    symbol: entity.tickers?.[0] ?? q.toUpperCase(),
    name: entity.name,
    assetClass: entityTypeToAssetClass(entity.type),
  }));
}
