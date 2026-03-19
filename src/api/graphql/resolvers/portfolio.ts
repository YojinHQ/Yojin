/**
 * Portfolio resolvers — portfolio, positions, enrichedSnapshot, refreshPositions.
 *
 * Reads from PortfolioSnapshotStore when data is available, falls back to
 * empty state when no snapshots have been imported yet.
 */

import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
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

let snapshotStore: PortfolioSnapshotStore | undefined;

/** Called once during server startup to inject the store. */
export function setSnapshotStore(store: PortfolioSnapshotStore): void {
  snapshotStore = store;
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
  return getSnapshot();
}

export async function positionsQuery(): Promise<Position[]> {
  const snapshot = await getSnapshot();
  return snapshot.positions;
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
  const enriched: EnrichedPosition[] = snapshot.positions.map((p) => ({
    ...p,
    sentimentScore: undefined,
    sentimentLabel: undefined,
    analystRating: undefined,
    targetPrice: undefined,
    peRatio: undefined,
    dividendYield: undefined,
    beta: undefined,
    fiftyTwoWeekHigh: undefined,
    fiftyTwoWeekLow: undefined,
  }));

  return {
    id: `enriched-${Date.now()}`,
    positions: enriched,
    totalValue: snapshot.totalValue,
    totalCost: snapshot.totalCost,
    totalPnl: snapshot.totalPnl,
    totalPnlPercent: snapshot.totalPnlPercent,
    timestamp: snapshot.timestamp,
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
    platform: (platform as Position['platform']) ?? 'MANUAL',
  };

  // Merge with existing positions, replacing any existing entry for the same symbol
  const existing = await snapshotStore.getLatest();
  const existingPositions = existing?.positions ?? [];
  const existingIdx = existingPositions.findIndex((p) => p.symbol === newPosition.symbol);
  const mergedPositions =
    existingIdx !== -1
      ? existingPositions.map((p, i) => (i === existingIdx ? newPosition : p))
      : [...existingPositions, newPosition];

  const snapshot = await snapshotStore.save({ positions: mergedPositions, platform: 'MANUAL' });
  pubsub.publish('portfolioUpdate', snapshot);
  return snapshot;
}

export async function refreshPositionsMutation(
  _parent: unknown,
  args: { platform: Platform },
): Promise<PortfolioSnapshot> {
  const snapshot = await getSnapshot();
  // Filter by platform if specified and we have data
  if (args.platform && snapshot.positions.length > 0) {
    const filtered = snapshot.positions.filter((p) => p.platform === args.platform);
    const totalValue = filtered.reduce((sum, p) => sum + p.marketValue, 0);
    const totalCost = filtered.reduce((sum, p) => sum + p.costBasis * p.quantity, 0);
    const totalPnl = totalValue - totalCost;
    const result: PortfolioSnapshot = {
      ...snapshot,
      id: `snap-${Date.now()}`,
      positions: filtered,
      totalValue,
      totalCost,
      totalPnl,
      totalPnlPercent: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
      platform: args.platform,
    };
    pubsub.publish('portfolioUpdate', result);
    return result;
  }
  pubsub.publish('portfolioUpdate', snapshot);
  return snapshot;
}
