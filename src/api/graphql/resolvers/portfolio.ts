/**
 * Portfolio resolvers — portfolio, positions, enrichedSnapshot, refreshPositions.
 *
 * Reads from PortfolioSnapshotStore when data is available, falls back to
 * empty state when no snapshots have been imported yet.
 */

import type { JintelClient } from '@yojinhq/jintel-client';

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

let snapshotStore: PortfolioSnapshotStore | undefined;
let connectionManager: ConnectionManager | undefined;
let jintelClient: JintelClient | undefined;

export function setPortfolioJintelClient(c: JintelClient | undefined): void {
  jintelClient = c;
}

// ---------------------------------------------------------------------------
// Mock sparkline / day-change generation (until real market data is wired)
// ---------------------------------------------------------------------------

/** Deterministic hash for a symbol string. */
function symbolHash(symbol: string): number {
  let h = 0;
  for (const c of symbol) h = c.charCodeAt(0) + ((h << 5) - h);
  return h;
}

/** Seeded pseudo-random — stable across calls for the same seed. */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/** Generate mock daily change based on the symbol (deterministic). */
function mockDayChange(symbol: string, currentPrice: number): { dayChange: number; dayChangePercent: number } {
  const h = symbolHash(symbol);
  // Range: roughly -5% to +5%, biased by symbol hash
  const pct = (seededRandom(h + 42) - 0.4) * 10;
  const roundedPct = Math.round(pct * 100) / 100;
  const change = Math.round(currentPrice * (roundedPct / 100) * 100) / 100;
  return { dayChange: change, dayChangePercent: roundedPct };
}

/** Generate a 24-point sparkline array for the day (deterministic per symbol). */
function mockSparkline(symbol: string, currentPrice: number, dayChangePercent: number): number[] {
  const points = 24;
  const h = symbolHash(symbol);
  const trend = dayChangePercent > 0 ? 1 : dayChangePercent < 0 ? -1 : 0;
  const startOffset = Math.max(0.02, Math.abs(dayChangePercent) * 0.008);
  let price = currentPrice * (1 - trend * startOffset);
  let momentum = 0;
  const volatility = 0.01 + seededRandom(h + 99) * 0.008;
  const data: number[] = [Math.round(price * 100) / 100];

  for (let i = 1; i < points; i++) {
    const noise = (seededRandom(h + i * 13) - 0.5) * currentPrice * volatility;
    momentum = momentum * 0.6 + noise * 0.4;
    const drift = (trend * currentPrice * startOffset * 1.2) / points;
    const pull = ((currentPrice - price) / (points - i)) * 0.15;
    price += momentum + drift + pull;
    data.push(Math.round(price * 100) / 100);
  }
  data[data.length - 1] = currentPrice;
  return data;
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
  const enriched: EnrichedPosition[] = await Promise.all(
    snapshot.positions.map(async (p): Promise<EnrichedPosition> => {
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
  // If a connection manager is available and the platform is connected,
  // trigger a live re-scrape via the connector.
  if (connectionManager && args.platform) {
    const syncResult = await connectionManager.syncPlatform(args.platform);
    if (syncResult.success) {
      // Return the freshly saved snapshot
      const snapshot = await getSnapshot();
      pubsub.publish('portfolioUpdate', snapshot);
      return snapshot;
    }
    // If sync failed (e.g. no connector for this platform), fall through to
    // returning the cached snapshot so the UI still gets data.
  }

  const snapshot = await getSnapshot();
  pubsub.publish('portfolioUpdate', snapshot);
  return snapshot;
}

// ---------------------------------------------------------------------------
// Position field resolvers — computed fields (mock until real market data)
// ---------------------------------------------------------------------------

/** Cache mock day-change per position object to avoid redundant computation across field resolvers. */
const dayChangeCache = new WeakMap<Position, { dayChange: number; dayChangePercent: number }>();

function getCachedDayChange(pos: Position): { dayChange: number; dayChangePercent: number } {
  let cached = dayChangeCache.get(pos);
  if (!cached) {
    cached = mockDayChange(pos.symbol, pos.currentPrice);
    dayChangeCache.set(pos, cached);
  }
  return cached;
}

export const positionFieldResolvers = {
  dayChange: (pos: Position) => {
    if (pos.dayChange != null) return pos.dayChange;
    return getCachedDayChange(pos).dayChange;
  },
  dayChangePercent: (pos: Position) => {
    if (pos.dayChangePercent != null) return pos.dayChangePercent;
    return getCachedDayChange(pos).dayChangePercent;
  },
  sparkline: (pos: Position) => {
    if (pos.sparkline) return pos.sparkline;
    const { dayChangePercent } = getCachedDayChange(pos);
    return mockSparkline(pos.symbol, pos.currentPrice, dayChangePercent);
  },
};
