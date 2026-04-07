/**
 * Portfolio resolvers — portfolio, positions, enrichedSnapshot, refreshPositions.
 *
 * Reads from PortfolioSnapshotStore when data is available, falls back to
 * empty state when no snapshots have been imported yet.
 */

import type { JintelClient, TickerPriceHistory } from '@yojinhq/jintel-client';

import { getLogger } from '../../../logging/index.js';
import {
  buildHistoryPoints,
  buildPriceMap,
  daysToJintelRange,
  fillCalendarDays,
  resolvePositionStartDates,
} from '../../../portfolio/history.js';
import { enrichPortfolioSnapshotWithLiveQuotes } from '../../../portfolio/live-enrichment.js';
import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
import type { ConnectionManager } from '../../../scraper/connection-manager.js';
import type { WatchlistStore } from '../../../watchlist/watchlist-store.js';
import { pubsub } from '../pubsub.js';
import type {
  AssetClass,
  Platform,
  PortfolioHistoryPoint,
  PortfolioSnapshot,
  Position,
  SectorWeight,
} from '../types.js';

const log = getLogger().sub('portfolio-resolver');

export { isUSMarketOpen } from '../../../portfolio/live-enrichment.js';

let snapshotStore: PortfolioSnapshotStore | undefined;
let connectionManager: ConnectionManager | undefined;
let jintelClient: JintelClient | undefined;
let onPortfolioChangedCb: ((tickers: string[]) => void) | undefined;
let portfolioWatchlistStore: WatchlistStore | undefined;

/** Register a callback fired after any position mutation (add/edit/remove). */
export function setPortfolioChangedCallback(cb: (tickers: string[]) => void): void {
  onPortfolioChangedCb = cb;
}

export function setPortfolioJintelClient(c: JintelClient | undefined): void {
  jintelClient = c;
}

export function setPortfolioWatchlistStore(s: WatchlistStore): void {
  portfolioWatchlistStore = s;
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

/** Normalize a position's platform to uppercase for comparison. Handles null/undefined. */
function normPlatform(p: Position): string {
  return (p.platform ?? '').toUpperCase();
}

const EMPTY_SNAPSHOT: PortfolioSnapshot = {
  id: 'empty',
  positions: [],
  totalValue: 0,
  totalCost: 0,
  totalPnl: 0,
  totalPnlPercent: 0,
  totalDayChange: 0,
  totalDayChangePercent: 0,
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
  return enrichPortfolioSnapshotWithLiveQuotes(snapshot, jintelClient);
}

export async function portfolioHistoryQuery(days?: number | null): Promise<PortfolioHistoryPoint[]> {
  if (!snapshotStore) return [];

  const snapshot = await snapshotStore.getLatest();
  if (!snapshot || snapshot.positions.length === 0) return [];

  const positions = snapshot.positions;
  const symbols = [...new Set(positions.map((p) => p.symbol))];

  // Determine date range
  const effectiveDays = days ?? 7;
  const startDate = new Date(Date.now() - effectiveDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Resolve when each position was first held
  const needsTimeline = positions.filter((p) => !p.entryDate);
  let timeline: Map<string, string> | null = null;
  if (needsTimeline.length > 0) {
    timeline = await snapshotStore.getPositionTimeline(needsTimeline.map((p) => p.symbol));
  }
  const startDates = resolvePositionStartDates(positions, timeline, startDate);

  // Fetch historical daily prices from Jintel
  if (!jintelClient) {
    log.debug('No Jintel client — returning empty history');
    return [];
  }

  const range = daysToJintelRange(effectiveDays);
  let priceData: TickerPriceHistory[];
  try {
    const result = await jintelClient.priceHistory(symbols, range, '1d');
    if (!result.success) {
      log.warn('Jintel priceHistory returned non-success', { error: result });
      return [];
    }
    priceData = result.data;
  } catch (err) {
    log.warn('Jintel priceHistory call failed', { error: String(err) });
    return [];
  }

  // Build price map and fill weekends/holidays
  const rawPriceMap = buildPriceMap(priceData);
  const filledPrices = fillCalendarDays(rawPriceMap, startDate, yesterday);

  // Compute historical points (up to yesterday)
  const history = buildHistoryPoints(positions, filledPrices, startDates, startDate, yesterday);

  // Append today's live-priced trailing point
  const liveSnapshot = await enrichPortfolioSnapshotWithLiveQuotes(snapshot, jintelClient);
  const prevPoint = history.length > 0 ? history[history.length - 1] : null;
  const prevValue = prevPoint ? prevPoint.totalValue : 0;
  const prevCost = prevPoint ? prevPoint.totalCost : 0;
  const liveCostChange = liveSnapshot.totalCost - prevCost;
  const livePnl = liveSnapshot.totalValue - prevValue - liveCostChange;

  const livePoint: PortfolioHistoryPoint = {
    timestamp: new Date().toISOString(),
    totalValue: liveSnapshot.totalValue,
    totalCost: liveSnapshot.totalCost,
    totalPnl: liveSnapshot.totalPnl,
    totalPnlPercent: liveSnapshot.totalPnlPercent,
    periodPnl: prevPoint ? livePnl : 0,
    periodPnlPercent: prevValue > 0 ? (livePnl / prevValue) * 100 : 0,
  };

  // If yesterday's point exists, append today. Otherwise just return the live point.
  const liveDay = livePoint.timestamp.slice(0, 10);
  const lastDay = history.length > 0 ? history[history.length - 1].timestamp.slice(0, 10) : null;
  if (liveDay === lastDay) {
    history[history.length - 1] = livePoint;
  } else {
    history.push(livePoint);
  }

  return history;
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
  entryDate?: string;
}

export async function addManualPositionMutation(
  _parent: unknown,
  args: { input: ManualPositionInput },
): Promise<PortfolioSnapshot> {
  if (!snapshotStore) throw new Error('Snapshot store not available');

  const { symbol, name, quantity, costBasis, assetClass, platform, entryDate } = args.input;

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
    entryDate: entryDate || new Date().toISOString().slice(0, 10),
  };

  const effectivePlatform = newPosition.platform;

  // Symbol-level dedup within this platform only
  const existing = await snapshotStore.getLatest();
  const samePlatformPositions = (existing?.positions ?? []).filter((p) => normPlatform(p) === effectivePlatform);
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
  const enriched = await enrichPortfolioSnapshotWithLiveQuotes(snapshot, jintelClient);
  pubsub.publish('portfolioUpdate', enriched);
  onPortfolioChangedCb?.([newPosition.symbol]);

  if (portfolioWatchlistStore?.has(newPosition.symbol)) {
    try {
      await portfolioWatchlistStore.remove(newPosition.symbol);
    } catch (err) {
      log.warn('Failed to auto-remove from watchlist', { symbol: newPosition.symbol, error: err });
    }
  }

  return enriched;
}

export async function editPositionMutation(
  _parent: unknown,
  args: { symbol: string; platform: string; input: ManualPositionInput },
): Promise<PortfolioSnapshot> {
  if (!snapshotStore) throw new Error('Snapshot store not available');

  const existing = await snapshotStore.getLatest();
  if (!existing) throw new Error('No portfolio snapshot exists');

  const targetSymbol = args.symbol.toUpperCase();
  const targetPlatform = args.platform.toUpperCase();
  const { symbol, name, quantity, costBasis, assetClass, platform, entryDate } = args.input;

  // Partition positions into target platform vs other platforms in a single pass
  const targetPlatformPositions: Position[] = [];
  const otherPlatformPositions: Position[] = [];
  for (const p of existing.positions) {
    if (normPlatform(p) === targetPlatform) {
      targetPlatformPositions.push(p);
    } else {
      otherPlatformPositions.push(p);
    }
  }

  const existingPosition = targetPlatformPositions.find((p) => p.symbol.toUpperCase() === targetSymbol);

  if (!existingPosition) {
    throw new Error(`Position ${targetSymbol} not found on platform ${targetPlatform}`);
  }

  const updatedPosition: Position = {
    symbol: symbol.toUpperCase(),
    name: name ?? symbol.toUpperCase(),
    quantity,
    costBasis,
    currentPrice: costBasis,
    marketValue: quantity * costBasis,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    assetClass: (assetClass as AssetClass) ?? 'EQUITY',
    platform: ((platform as Position['platform']) ?? targetPlatform).toUpperCase(),
    entryDate: entryDate || existingPosition.entryDate || new Date().toISOString().slice(0, 10),
  };

  const updatedPlatformPositions = targetPlatformPositions.map((p) =>
    p.symbol.toUpperCase() === targetSymbol ? updatedPosition : p,
  );

  const snapshot = await snapshotStore.save({
    positions: updatedPlatformPositions,
    platform: updatedPosition.platform,
    existingSnapshot: {
      ...existing,
      positions: otherPlatformPositions,
    },
  });
  const enriched = await enrichPortfolioSnapshotWithLiveQuotes(snapshot, jintelClient);
  pubsub.publish('portfolioUpdate', enriched);
  onPortfolioChangedCb?.([updatedPosition.symbol]);
  return enriched;
}

export async function removePositionMutation(
  _parent: unknown,
  args: { symbol: string; platform: string },
): Promise<PortfolioSnapshot> {
  if (!snapshotStore) throw new Error('Snapshot store not available');

  const existing = await snapshotStore.getLatest();
  if (!existing) throw new Error('No portfolio snapshot exists');

  const targetSymbol = args.symbol.toUpperCase();
  const targetPlatform = args.platform.toUpperCase();

  // Partition positions in a single pass: target platform (excluding removed) vs other platforms
  const platformPositions: Position[] = [];
  const otherPlatformPositions: Position[] = [];
  for (const p of existing.positions) {
    const pPlatform = normPlatform(p);
    if (pPlatform === targetPlatform) {
      if (p.symbol.toUpperCase() !== targetSymbol) {
        platformPositions.push(p);
      }
    } else {
      otherPlatformPositions.push(p);
    }
  }

  const snapshot = await snapshotStore.save({
    positions: platformPositions,
    platform: targetPlatform,
    existingSnapshot: {
      ...existing,
      positions: otherPlatformPositions,
    },
  });
  const enriched = await enrichPortfolioSnapshotWithLiveQuotes(snapshot, jintelClient);
  pubsub.publish('portfolioUpdate', enriched);
  onPortfolioChangedCb?.([targetSymbol]);
  return enriched;
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
      const enriched = await enrichPortfolioSnapshotWithLiveQuotes(snapshot, jintelClient);
      pubsub.publish('portfolioUpdate', enriched);
      return enriched;
    }
    // If sync failed (e.g. no connector for this platform), fall through to
    // returning the cached snapshot so the UI still gets data.
  }

  const snapshot = await getSnapshot();
  const enriched = await enrichPortfolioSnapshotWithLiveQuotes(snapshot, jintelClient);
  pubsub.publish('portfolioUpdate', enriched);
  return enriched;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// PortfolioSnapshot field resolvers (nested sub-graph)
// ---------------------------------------------------------------------------

export const portfolioSnapshotFieldResolvers = {
  /** Warnings from live quote enrichment; empty array when no issues. */
  warnings: (parent: PortfolioSnapshot): string[] => parent.warnings ?? [],

  /** Nested: historical portfolio values (deduplicated by day, latest live-priced). */
  history: (_parent: PortfolioSnapshot, args: { days?: number | null }): Promise<PortfolioHistoryPoint[]> =>
    portfolioHistoryQuery(args.days),

  /** Nested: sector allocation from the live-priced positions. */
  sectorExposure: (parent: PortfolioSnapshot): SectorWeight[] => {
    if (parent.positions.length === 0) return [];

    const sectorMap = new Map<string, number>();
    let total = 0;

    for (const pos of parent.positions) {
      const sector = pos.sector || 'Other';
      sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + pos.marketValue);
      total += pos.marketValue;
    }

    if (total <= 0) return [];

    return Array.from(sectorMap.entries()).map(([sector, value]) => ({
      sector,
      weight: value / total,
      value,
    }));
  },
};

// Position field resolvers
// ---------------------------------------------------------------------------

export const positionFieldResolvers = {
  /** Real value from enrichWithLiveQuotes; null when no quote data available. */
  dayChange: (pos: Position) => pos.dayChange ?? null,

  /** Real value from enrichWithLiveQuotes; null when no quote data available. */
  dayChangePercent: (pos: Position) => pos.dayChangePercent ?? null,

  preMarketChange: (pos: Position) => pos.preMarketChange ?? null,
  preMarketChangePercent: (pos: Position) => pos.preMarketChangePercent ?? null,
  postMarketChange: (pos: Position) => pos.postMarketChange ?? null,
  postMarketChangePercent: (pos: Position) => pos.postMarketChangePercent ?? null,

  /** Real sparkline from enrichWithLiveQuotes; null when no intraday data available. */
  sparkline: (pos: Position) => pos.sparkline ?? null,
};
