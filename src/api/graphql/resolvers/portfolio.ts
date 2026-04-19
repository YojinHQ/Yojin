/**
 * Portfolio resolvers — portfolio, positions, enrichedSnapshot, refreshPositions.
 *
 * Reads from PortfolioSnapshotStore when data is available, falls back to
 * empty state when no snapshots have been imported yet.
 */

import type { JintelClient } from '@yojinhq/jintel-client';

import { getLogger } from '../../../logging/index.js';
import {
  buildHistoryPoints,
  buildPriceMap,
  computePortfolioTodayDelta,
  fillCalendarDays,
  resolvePositionStart,
} from '../../../portfolio/history.js';
import {
  enrichPortfolioSnapshotWithLiveQuotes,
  fetchCachedDailyPriceHistory,
} from '../../../portfolio/live-enrichment.js';
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
  cashBalances: [],
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

export async function portfolioQuery(): Promise<PortfolioSnapshot | null> {
  if (!snapshotStore) return null;
  const snapshot = await snapshotStore.getLatest();
  if (!snapshot) return null;
  return enrichAndOverlay(snapshot);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayISO(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function resolveGates(positions: Position[], today: string): Promise<Map<string, string>> {
  const gates = new Map<string, string>();
  if (!snapshotStore) return gates;
  const { firstSeenBySymbol, overallFirstDate } = await snapshotStore.getFirstSeenMap();
  for (const pos of positions) {
    const gate = resolvePositionStart(pos, firstSeenBySymbol, overallFirstDate, today);
    if (gate) gates.set(pos.symbol, gate);
  }
  return gates;
}

/**
 * Live-enrich a snapshot, then replace the quote-based `totalDayChange` with
 * the value-based delta that drives the P&L chart's today bar so the card and
 * chart always agree. Use at every site that returns or publishes a snapshot.
 */
export async function enrichAndOverlay(snapshot: PortfolioSnapshot): Promise<PortfolioSnapshot> {
  const live = await enrichPortfolioSnapshotWithLiveQuotes(snapshot, jintelClient);
  if (!jintelClient || !snapshotStore || live.positions.length === 0) return live;
  // No live quotes landed → enrichment returned stored prices; overlay would compare stale vs stale.
  if (!live.positions.some((p) => p.dayChange !== undefined)) return live;

  const symbols = [...new Set(live.positions.map((p) => p.symbol))];
  const priceData = await fetchCachedDailyPriceHistory(jintelClient, symbols);
  if (!priceData) return live;

  const yesterday = yesterdayISO();
  const filledPrices = fillCalendarDays(buildPriceMap(priceData), yesterday, yesterday);
  const gates = await resolveGates(live.positions, todayISO());
  const delta = computePortfolioTodayDelta(live, filledPrices, gates, yesterday);
  return { ...live, ...delta };
}

export async function portfolioHistoryQuery(days?: number | null): Promise<PortfolioHistoryPoint[]> {
  if (!snapshotStore) return [];

  const snapshot = await snapshotStore.getLatest();
  if (!snapshot || snapshot.positions.length === 0) return [];

  if (!jintelClient) return [];

  const symbols = [...new Set(snapshot.positions.map((p) => p.symbol))];
  const startDate = new Date(Date.now() - (days ?? 7) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const yesterday = yesterdayISO();

  const priceData = await fetchCachedDailyPriceHistory(jintelClient, symbols);
  if (!priceData) return [];

  const filledPrices = fillCalendarDays(buildPriceMap(priceData), startDate, yesterday);
  const liveSnapshot = await enrichPortfolioSnapshotWithLiveQuotes(snapshot, jintelClient);
  const gates = await resolveGates(liveSnapshot.positions, todayISO());
  const history = buildHistoryPoints(liveSnapshot.positions, filledPrices, startDate, yesterday, gates);

  const prevPoint = history.length > 0 ? history[history.length - 1] : null;
  const valueChange = prevPoint ? liveSnapshot.totalValue - prevPoint.totalValue : 0;
  const costChange = prevPoint ? liveSnapshot.totalCost - prevPoint.totalCost : 0;
  const periodPnl = prevPoint ? valueChange - costChange : 0;
  const periodPnlPercent = prevPoint && prevPoint.totalValue > 0 ? (periodPnl / prevPoint.totalValue) * 100 : 0;

  const livePoint: PortfolioHistoryPoint = {
    timestamp: new Date().toISOString(),
    totalValue: liveSnapshot.totalValue,
    totalCost: liveSnapshot.totalCost,
    totalPnl: liveSnapshot.totalPnl,
    totalPnlPercent: liveSnapshot.totalPnlPercent,
    periodPnl,
    periodPnlPercent,
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
    entryDate: entryDate || undefined,
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
  const enriched = await enrichAndOverlay(snapshot);
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
    entryDate: entryDate || existingPosition.entryDate,
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
  const enriched = await enrichAndOverlay(snapshot);
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
  const enriched = await enrichAndOverlay(snapshot);
  pubsub.publish('portfolioUpdate', enriched);
  onPortfolioChangedCb?.([targetSymbol]);
  return enriched;
}

export async function setCashBalanceMutation(
  _parent: unknown,
  args: { platform: string; currency: string; amount: number },
): Promise<PortfolioSnapshot> {
  if (!snapshotStore) throw new Error('Snapshot store not available');
  const snapshot = await snapshotStore.setCashBalance({
    platform: args.platform,
    currency: args.currency,
    amount: args.amount,
  });
  const enriched = await enrichAndOverlay(snapshot);
  pubsub.publish('portfolioUpdate', enriched);
  return enriched;
}

export async function removeCashBalanceMutation(
  _parent: unknown,
  args: { platform: string; currency: string },
): Promise<PortfolioSnapshot> {
  if (!snapshotStore) throw new Error('Snapshot store not available');
  const snapshot = await snapshotStore.removeCashBalance({
    platform: args.platform,
    currency: args.currency,
  });
  const enriched = await enrichAndOverlay(snapshot);
  pubsub.publish('portfolioUpdate', enriched);
  return enriched;
}

export async function refreshPositionsMutation(
  _parent: unknown,
  args: { platform: Platform },
): Promise<PortfolioSnapshot> {
  if (connectionManager && args.platform) {
    await connectionManager.syncPlatform(args.platform);
    // Sync failure falls through to the cached snapshot so the UI still gets data.
  }
  const enriched = await enrichAndOverlay(await getSnapshot());
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
