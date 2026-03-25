/**
 * Portfolio resolvers — portfolio, positions, enrichedSnapshot, refreshPositions.
 *
 * Reads from PortfolioSnapshotStore when data is available, falls back to
 * empty state when no snapshots have been imported yet.
 */

import type { JintelClient, MarketQuote } from '@yojinhq/jintel-client';

import { getLogger } from '../../../logging/index.js';
import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
import type { ConnectionManager } from '../../../scraper/connection-manager.js';
import { pubsub } from '../pubsub.js';
import type {
  AssetClass,
  EnrichedPosition,
  EnrichedSnapshot,
  Platform,
  PortfolioHistoryPoint,
  PortfolioSnapshot,
  Position,
} from '../types.js';

const log = getLogger().sub('portfolio-resolver');

let snapshotStore: PortfolioSnapshotStore | undefined;
let connectionManager: ConnectionManager | undefined;
let jintelClient: JintelClient | undefined;

export function setPortfolioJintelClient(c: JintelClient | undefined): void {
  jintelClient = c;
}

// ---------------------------------------------------------------------------
// Live quote enrichment — batch-fetch from Jintel and merge onto positions
// ---------------------------------------------------------------------------

/**
 * Enrich a snapshot's positions with live market quotes from Jintel.
 * One batch call per snapshot — avoids N+1 per-position fetches.
 * Returns a new snapshot (original is never mutated).
 * Falls back to the original snapshot when Jintel is unavailable or the call fails.
 */
async function enrichWithLiveQuotes(snapshot: PortfolioSnapshot): Promise<PortfolioSnapshot> {
  if (!jintelClient || snapshot.positions.length === 0) {
    log.debug('enrichWithLiveQuotes skipped', {
      hasClient: !!jintelClient,
      positionCount: snapshot.positions.length,
    });
    return snapshot;
  }

  const symbols = [...new Set(snapshot.positions.map((p) => p.symbol))];
  log.debug('Fetching live quotes', { symbols });

  const result = await jintelClient.quotes(symbols).catch((err: unknown) => {
    log.warn('Jintel quotes call failed', { error: String(err) });
    return undefined;
  });

  if (!result?.success) {
    log.warn('Jintel quotes returned non-success', {
      success: result?.success,
      error: result && 'error' in result ? (result as { error: string }).error : 'no result',
    });
    return snapshot;
  }

  const validQuotes = result.data.filter((q): q is MarketQuote => q != null);

  log.info('Jintel quotes received', {
    requested: symbols.length,
    received: validQuotes.length,
    tickers: validQuotes.map((q) => q.ticker),
  });

  const quoteMap = new Map<string, MarketQuote>(validQuotes.map((q) => [q.ticker, q]));

  const positions: Position[] = snapshot.positions.map((pos) => {
    const quote = quoteMap.get(pos.symbol);
    if (!quote) {
      log.debug('No quote found for position', { symbol: pos.symbol, availableTickers: [...quoteMap.keys()] });
      return pos;
    }

    const currentPrice = quote.price;
    const marketValue = pos.quantity * currentPrice;
    const totalCost = pos.costBasis * pos.quantity;

    return {
      ...pos,
      currentPrice,
      marketValue,
      dayChange: quote.change,
      dayChangePercent: quote.changePercent,
      unrealizedPnl: marketValue - totalCost,
      unrealizedPnlPercent: pos.costBasis > 0 ? ((currentPrice - pos.costBasis) / pos.costBasis) * 100 : 0,
    };
  });

  // Recompute portfolio totals from live-priced positions
  const totalValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const totalCost = positions.reduce((sum, p) => sum + p.costBasis * p.quantity, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return { ...snapshot, positions, totalValue, totalCost, totalPnl, totalPnlPercent };
}

/** Called once during server startup to inject the store. */
export function setSnapshotStore(store: PortfolioSnapshotStore): void {
  snapshotStore = store;
}

/** Called once during server startup to inject the connection manager. */
export function setPortfolioConnectionManager(manager: ConnectionManager): void {
  connectionManager = manager;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_SNAPSHOT: PortfolioSnapshot = {
  id: 'empty',
  positions: [],
  totalValue: 0,
  totalCost: 0,
  totalPnl: 0,
  totalPnlPercent: 0,
  timestamp: new Date().toISOString(),
  platform: null,
};

async function getSnapshot(): Promise<PortfolioSnapshot> {
  if (!snapshotStore) return EMPTY_SNAPSHOT;
  return (await snapshotStore.getLatest()) ?? EMPTY_SNAPSHOT;
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function portfolioQuery(): Promise<PortfolioSnapshot> {
  const snapshot = await getSnapshot();
  return enrichWithLiveQuotes(snapshot);
}

export async function positionsQuery(): Promise<Position[]> {
  const snapshot = await getSnapshot();
  const enriched = await enrichWithLiveQuotes(snapshot);
  return enriched.positions;
}

export async function portfolioHistoryQuery(): Promise<PortfolioHistoryPoint[]> {
  if (!snapshotStore) return [];
  const snapshots = await snapshotStore.getAll();
  return snapshots.map((s) => ({
    timestamp: s.timestamp,
    totalValue: s.totalValue,
    totalCost: s.totalCost,
    totalPnl: s.totalPnl,
    totalPnlPercent: s.totalPnlPercent,
  }));
}

export async function enrichedSnapshotQuery(): Promise<EnrichedSnapshot> {
  const snapshot = await getSnapshot();
  const liveSnapshot = await enrichWithLiveQuotes(snapshot);
  const enriched: EnrichedPosition[] = await Promise.all(
    liveSnapshot.positions.map(async (p): Promise<EnrichedPosition> => {
      if (!jintelClient) {
        return { ...p };
      }

      const result = await jintelClient.enrichEntity(p.symbol, ['market']).catch(() => ({
        success: false as const,
        error: 'enrichEntity threw',
      }));
      if (!result.success || !('data' in result) || !result.data.market?.fundamentals) {
        return { ...p };
      }

      const f = result.data.market.fundamentals;
      return {
        ...p,
        peRatio: f.peRatio ?? undefined,
        dividendYield: f.dividendYield ?? undefined,
        beta: f.beta ?? undefined,
        fiftyTwoWeekHigh: f.fiftyTwoWeekHigh ?? undefined,
        fiftyTwoWeekLow: f.fiftyTwoWeekLow ?? undefined,
        sector: f.sector ?? undefined,
      };
    }),
  );

  return {
    id: `enriched-${Date.now()}`,
    positions: enriched,
    totalValue: liveSnapshot.totalValue,
    totalCost: liveSnapshot.totalCost,
    totalPnl: liveSnapshot.totalPnl,
    totalPnlPercent: liveSnapshot.totalPnlPercent,
    timestamp: liveSnapshot.timestamp,
    enrichedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

interface ManualPositionInput {
  symbol: string;
  name?: string;
  quantity: number;
  costBasis: number;
  assetClass?: string;
  platform?: string;
}

export async function addManualPositionMutation(
  _parent: unknown,
  args: { input: ManualPositionInput },
): Promise<PortfolioSnapshot> {
  if (!snapshotStore) throw new Error('Snapshot store not available');

  const { symbol, name, quantity, costBasis, assetClass, platform } = args.input;

  const newPosition: Position = {
    symbol: symbol.toUpperCase(),
    name: name ?? symbol.toUpperCase(),
    quantity,
    costBasis,
    currentPrice: costBasis,
    marketValue: quantity * costBasis,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    assetClass: (assetClass as AssetClass) ?? 'EQUITY',
    platform: ((platform as Position['platform']) ?? 'MANUAL').toUpperCase(),
  };

  const effectivePlatform = newPosition.platform;

  // Symbol-level dedup within this platform only
  const existing = await snapshotStore.getLatest();
  const samePlatformPositions = (existing?.positions ?? []).filter(
    (p) => p.platform?.toUpperCase() === effectivePlatform,
  );
  const existingIdx = samePlatformPositions.findIndex((p) => p.symbol === newPosition.symbol);
  const updatedPlatformPositions =
    existingIdx !== -1
      ? samePlatformPositions.map((p, i) => (i === existingIdx ? newPosition : p))
      : [...samePlatformPositions, newPosition];

  const snapshot = await snapshotStore.save({
    positions: updatedPlatformPositions,
    platform: effectivePlatform,
    existingSnapshot: existing,
  });
  pubsub.publish('portfolioUpdate', snapshot);
  return snapshot;
}

export async function refreshPositionsMutation(
  _parent: unknown,
  args: { platform: Platform },
): Promise<PortfolioSnapshot> {
  // If a connection manager is available and the platform is connected,
  // trigger a live re-scrape via the connector.
  if (connectionManager && args.platform) {
    const syncResult = await connectionManager.syncPlatform(args.platform);
    if (syncResult.success) {
      // Return the freshly saved snapshot with live prices
      const snapshot = await getSnapshot();
      const enriched = await enrichWithLiveQuotes(snapshot);
      pubsub.publish('portfolioUpdate', enriched);
      return enriched;
    }
    // If sync failed (e.g. no connector for this platform), fall through to
    // returning the cached snapshot so the UI still gets data.
  }

  const snapshot = await getSnapshot();
  const enriched = await enrichWithLiveQuotes(snapshot);
  pubsub.publish('portfolioUpdate', enriched);
  return enriched;
}

// ---------------------------------------------------------------------------
// Position field resolvers
// ---------------------------------------------------------------------------

export const positionFieldResolvers = {
  /** Real value from enrichWithLiveQuotes; null when no quote data available. */
  dayChange: (pos: Position) => pos.dayChange ?? null,

  /** Real value from enrichWithLiveQuotes; null when no quote data available. */
  dayChangePercent: (pos: Position) => pos.dayChangePercent ?? null,

  /** Real sparkline from enrichWithLiveQuotes; null when no intraday data available. */
  sparkline: (pos: Position) => pos.sparkline ?? null,
};
