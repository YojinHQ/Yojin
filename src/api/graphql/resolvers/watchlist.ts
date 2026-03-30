/**
 * Watchlist resolvers — watchlist query, addToWatchlist, removeFromWatchlist mutations.
 *
 * Delegates to WatchlistStore for persistence and WatchlistEnrichment for quote data.
 */

import type { WatchlistEnrichment } from '../../../watchlist/watchlist-enrichment.js';
import type { WatchlistStore } from '../../../watchlist/watchlist-store.js';
import type { AssetClass } from '../types.js';

let store: WatchlistStore | undefined;
let enrichment: WatchlistEnrichment | undefined;
let watchlistChangedCallback: ((tickers: string[]) => void) | undefined;

export function setWatchlistStore(s: WatchlistStore): void {
  store = s;
}

export function setWatchlistEnrichment(e: WatchlistEnrichment): void {
  enrichment = e;
}

export function setWatchlistChangedCallback(cb: (tickers: string[]) => void): void {
  watchlistChangedCallback = cb;
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function watchlistQuery() {
  if (!store) return [];

  const entries = store.list();
  if (entries.length === 0) return [];

  // Best-effort enrichment — return cached data, don't block on stale refresh
  const enriched = enrichment ? await enrichment.getEnrichedBatch(entries.map((e) => e.symbol)) : new Map();

  return entries.map((entry) => {
    const cache = enriched.get(entry.symbol) ?? null;
    return {
      symbol: entry.symbol,
      name: entry.name,
      assetClass: entry.assetClass,
      addedAt: entry.addedAt,
      price: cache?.quote?.price ?? null,
      change: cache?.quote?.change ?? null,
      changePercent: cache?.quote?.changePercent ?? null,
      enrichedAt: cache?.enrichedAt ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

export async function addToWatchlistMutation(
  _: unknown,
  args: { symbol: string; name: string; assetClass: AssetClass },
) {
  if (!store) return { success: false, error: 'Watchlist not initialized' };

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
