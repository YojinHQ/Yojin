/**
 * Market resolvers — quote, news, sectorExposure.
 *
 * When JintelClient is injected, resolvers fetch live data and fall back to
 * stubs on failure. Without a client, stubs are returned directly.
 */

import type { JintelClient } from '@yojinhq/jintel-client';

import { createSubsystemLogger } from '../../../logging/logger.js';
import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
import type { Article, Quote, SectorWeight } from '../types.js';

const log = createSubsystemLogger('market-resolver');

// ---------------------------------------------------------------------------
// Module-level state (injected via setters from composition root)
// ---------------------------------------------------------------------------

let jintelClient: JintelClient | undefined;
let snapshotStore: PortfolioSnapshotStore | undefined;

export function setMarketJintelClient(c: JintelClient | undefined): void {
  jintelClient = c;
}

export function setMarketSnapshotStore(s: PortfolioSnapshotStore | undefined): void {
  snapshotStore = s;
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

const stubSectorExposure: SectorWeight[] = [
  { sector: 'Technology', weight: 0.388, value: 21381.0 },
  { sector: 'Crypto', weight: 0.612, value: 33750.0 },
];

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function quoteQuery(_parent: unknown, args: { symbol: string }): Promise<Quote | null> {
  const sym = args.symbol.toUpperCase();

  if (jintelClient) {
    const result = await jintelClient.quotes([sym]).catch(() => ({
      success: false as const,
      error: 'quotes threw',
      data: [] as never[],
    }));
    if (result.success && result.data[0]) {
      const q = result.data[0];
      return {
        symbol: q.ticker,
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
    if (!result.success) {
      log.warn('Jintel quote failed, using stub', { symbol: sym, error: result.error });
    }
  }

  return stubQuotes[sym] ?? null;
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

export async function sectorExposureQuery(): Promise<SectorWeight[]> {
  if (snapshotStore) {
    const snapshot = await snapshotStore.getLatest();
    if (snapshot && snapshot.positions.length > 0) {
      const sectorMap = new Map<string, number>();
      let total = 0;

      for (const pos of snapshot.positions) {
        const sector = pos.sector || 'Other';
        sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + pos.marketValue);
        total += pos.marketValue;
      }

      if (total > 0) {
        return Array.from(sectorMap.entries()).map(([sector, value]) => ({
          sector,
          weight: value / total,
          value,
        }));
      }
    }
  }

  return stubSectorExposure;
}
