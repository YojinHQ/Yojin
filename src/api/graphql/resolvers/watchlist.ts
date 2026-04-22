/**
 * Watchlist resolvers — watchlist query, addToWatchlist, removeFromWatchlist mutations.
 *
 * Delegates to WatchlistStore for persistence and WatchlistEnrichment for quote data.
 */

import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
import type { WatchlistEnrichment } from '../../../watchlist/watchlist-enrichment.js';
import type { WatchlistStore } from '../../../watchlist/watchlist-store.js';
import type { AssetClass } from '../types.js';

let store: WatchlistStore | undefined;
let enrichment: WatchlistEnrichment | undefined;
let watchlistChangedCallback: ((tickers: string[]) => void) | undefined;
let snapshotStore: PortfolioSnapshotStore | undefined;

export function setWatchlistStore(s: WatchlistStore): void {
  store = s;
}

export function setWatchlistEnrichment(e: WatchlistEnrichment): void {
  enrichment = e;
}

export function setWatchlistChangedCallback(cb: (tickers: string[]) => void): void {
  watchlistChangedCallback = cb;
}

export function setWatchlistSnapshotStore(s: PortfolioSnapshotStore): void {
  snapshotStore = s;
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function watchlistQuery() {
  if (!store) return [];

  const entries = store.list();
  if (entries.length === 0) return [];

  const symbols = entries.map((e) => e.symbol);

  // Best-effort enrichment — sparklines are fetched separately via
  // `watchlistSparklines` so the main card data isn't blocked on 1m-interval
  // price history.
  const enriched = enrichment ? await enrichment.getEnrichedBatch(symbols) : new Map();

  return entries.map((entry) => {
    const cache = enriched.get(entry.symbol) ?? null;
    const quote = cache?.quote;
    return {
      symbol: entry.symbol,
      name: entry.name,
      assetClass: entry.assetClass,
      addedAt: entry.addedAt,
      price: quote?.price ?? null,
      change: quote?.change ?? null,
      changePercent: quote?.changePercent ?? null,
      preMarketPrice: quote?.preMarketPrice ?? null,
      preMarketChange: quote?.preMarketChange ?? null,
      preMarketChangePercent: quote?.preMarketChangePercent ?? null,
      postMarketPrice: quote?.postMarketPrice ?? null,
      postMarketChange: quote?.postMarketChange ?? null,
      postMarketChangePercent: quote?.postMarketChangePercent ?? null,
      enrichedAt: cache?.enrichedAt ?? null,
    };
  });
}

export async function watchlistSparklinesQuery() {
  if (!store || !enrichment) return [];
  const entries = store.list();
  if (entries.length === 0) return [];

  const sparklines = await enrichment.getSparklines(
    entries.map((e) => ({ symbol: e.symbol, assetClass: e.assetClass })),
  );

  const result: { symbol: string; points: number[] }[] = [];
  for (const [symbol, points] of sparklines) {
    result.push({ symbol, points });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

export async function addToWatchlistMutation(
  _: unknown,
  args: { symbol: string; name: string; assetClass: AssetClass },
) {
  if (!store) return { success: false, error: 'Watchlist not initialized' };

  if (snapshotStore) {
    const snapshot = await snapshotStore.getLatest();
    if (snapshot?.positions.some((p) => p.symbol.toUpperCase() === args.symbol.toUpperCase())) {
      return { success: false, error: 'Symbol already in portfolio' };
    }
  }

  const result = await store.add({
    symbol: args.symbol.toUpperCase(),
    name: args.name,
    assetClass: args.assetClass,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  watchlistChangedCallback?.([args.symbol.toUpperCase()]);
  return { success: true, error: null };
}

export async function removeFromWatchlistMutation(_: unknown, args: { symbol: string }) {
  if (!store) return { success: false, error: 'Watchlist not initialized' };

  const result = await store.remove(args.symbol.toUpperCase());

  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, error: null };
}
