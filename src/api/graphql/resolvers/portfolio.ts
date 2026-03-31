/**
 * Portfolio resolvers — portfolio, positions, enrichedSnapshot, refreshPositions.
 *
 * Reads from PortfolioSnapshotStore when data is available, falls back to
 * empty state when no snapshots have been imported yet.
 */

import type { JintelClient, MarketQuote, TickerPriceHistory } from '@yojinhq/jintel-client';

import { getLogger } from '../../../logging/index.js';
import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
import type { ConnectionManager } from '../../../scraper/connection-manager.js';
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

let snapshotStore: PortfolioSnapshotStore | undefined;
let connectionManager: ConnectionManager | undefined;
let jintelClient: JintelClient | undefined;
let onPortfolioChangedCb: ((tickers: string[]) => void) | undefined;

/** Register a callback fired after any position mutation (add/edit/remove). */
export function setPortfolioChangedCallback(cb: (tickers: string[]) => void): void {
  onPortfolioChangedCb = cb;
}

export function setPortfolioJintelClient(c: JintelClient | undefined): void {
  jintelClient = c;
}

// ---------------------------------------------------------------------------
// Market hours detection
// ---------------------------------------------------------------------------

/** Check if the US stock market is currently in regular trading hours (9:30–16:00 ET, Mon–Fri). */
export function isUSMarketOpen(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false; // weekend
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes >= 570 && minutes < 960; // 9:30 (570) to 16:00 (960)
}

// ---------------------------------------------------------------------------
// Live quote enrichment — batch-fetch from Jintel and merge onto positions
// ---------------------------------------------------------------------------

/** Build a sparkline from price history closing prices, appending the live price. */
function buildSparkline(history: TickerPriceHistory, livePrice: number): number[] {
  const points = history.history.map((p) => p.close);
  // Append live price so the sparkline extends to "now"
  points.push(livePrice);
  return points;
}

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
  const marketOpen = isUSMarketOpen();

  // Parallel fetches: quotes + sparkline history per asset group
  const fetchHistory = (tickers: string[], range: string) =>
    client.priceHistory(tickers, range).catch((err: unknown) => {
      log.warn('Jintel priceHistory failed', { tickers, error: String(err) });
      return undefined;
    });

  const equityRange = marketOpen ? '1d' : '5d';

  const [result, equityHistory, cryptoHistory] = await Promise.all([
    client.quotes(symbols).catch((err: unknown) => {
      log.warn('Jintel quotes call failed', { error: String(err) });
      return undefined;
    }),
    equitySymbols.length > 0 ? fetchHistory(equitySymbols, equityRange) : undefined,
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

  // Merge sparkline history from both asset groups
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

    // Real sparkline from price history; undefined if no history available
    const priceHist = historyMap.get(pos.symbol);
    const sparkline = priceHist && priceHist.history.length > 0 ? buildSparkline(priceHist, currentPrice) : undefined;

    return {
      ...pos,
      currentPrice,
      marketValue,
      dayChange: quote.change,
      dayChangePercent: quote.changePercent,
      // Pre/post market fields — available on some Jintel quote responses
      preMarketChange: (quote as unknown as Record<string, number | null>).preMarketChange ?? null,
      preMarketChangePercent: (quote as unknown as Record<string, number | null>).preMarketChangePercent ?? null,
      postMarketChange: (quote as unknown as Record<string, number | null>).postMarketChange ?? null,
      postMarketChangePercent: (quote as unknown as Record<string, number | null>).postMarketChangePercent ?? null,
      unrealizedPnl: hasCostBasis ? marketValue - totalCost : 0,
      unrealizedPnlPercent: hasCostBasis ? ((currentPrice - pos.costBasis) / pos.costBasis) * 100 : 0,
      sparkline,
    };
  });

  // Recompute portfolio totals from live-priced positions
  const totalValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const totalCost = positions.reduce((sum, p) => sum + p.costBasis * p.quantity, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  const totalDayChange = positions.reduce((sum, p) => sum + (p.dayChange ?? 0) * p.quantity, 0);
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
  return enrichWithLiveQuotes(snapshot);
}

export async function portfolioHistoryQuery(days?: number | null): Promise<PortfolioHistoryPoint[]> {
  if (!snapshotStore) return [];
  const snapshots = await snapshotStore.getAll();
  if (snapshots.length === 0) return [];

  // Sort chronologically — JSONL insertion order may not be time-ordered
  snapshots.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Group by day. Older days are deduplicated to one snapshot (the latest).
  // The most recent day keeps all intraday points so the chart shows
  // movement on day 1 (e.g. portfolio being built up during onboarding).
  const byDay = new Map<string, PortfolioSnapshot[]>();
  for (const s of snapshots) {
    const day = s.timestamp.slice(0, 10); // YYYY-MM-DD
    const arr = byDay.get(day) ?? [];
    arr.push(s);
    byDay.set(day, arr);
  }

  const sortedDays = [...byDay.keys()].sort();
  const latestDay = sortedDays[sortedDays.length - 1];

  const deduped: PortfolioSnapshot[] = [];
  for (const day of sortedDays) {
    const daySnapshots = byDay.get(day) ?? [];
    if (day === latestDay) {
      deduped.push(...daySnapshots);
    } else {
      // Keep only the last snapshot per older day
      deduped.push(daySnapshots[daySnapshots.length - 1]);
    }
  }

  // Apply days filter if provided
  let filtered = deduped;
  if (days != null && days > 0) {
    const latestTs = new Date(deduped[deduped.length - 1].timestamp).getTime();
    const cutoff = latestTs - days * 24 * 60 * 60 * 1000;
    filtered = deduped.filter((s) => new Date(s.timestamp).getTime() >= cutoff);
  }

  // Deduplicate to one point per day (keep last snapshot per day)
  const dayDedup = new Map<string, PortfolioSnapshot>();
  for (const s of filtered) {
    const day = s.timestamp.slice(0, 10);
    dayDedup.set(day, s);
  }
  const final = [...dayDedup.values()].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const history: PortfolioHistoryPoint[] = final.map((s, i) => {
    if (i === 0) {
      return {
        timestamp: s.timestamp,
        totalValue: s.totalValue,
        totalCost: s.totalCost,
        totalPnl: s.totalPnl,
        totalPnlPercent: s.totalPnlPercent,
        periodPnl: 0,
        periodPnlPercent: 0,
      };
    }
    const prev = final[i - 1];
    // Subtract cost-basis changes to exclude deposits/withdrawals from daily PnL.
    // dailyPnl = (value change) - (cost change) = pure market movement.
    const valueChange = s.totalValue - prev.totalValue;
    const costChange = s.totalCost - prev.totalCost;
    const dailyPnl = valueChange - costChange;
    const prevMarketValue = prev.totalValue;
    return {
      timestamp: s.timestamp,
      totalValue: s.totalValue,
      totalCost: s.totalCost,
      totalPnl: s.totalPnl,
      totalPnlPercent: s.totalPnlPercent,
      periodPnl: dailyPnl,
      periodPnlPercent: prevMarketValue > 0 ? (dailyPnl / prevMarketValue) * 100 : 0,
    };
  });

  // Replace the trailing point with live-priced data so the chart's edge
  // matches the Portfolio Value card (which uses enrichWithLiveQuotes).
  if (final.length > 0) {
    const latest = final[final.length - 1];
    const liveSnapshot = await enrichWithLiveQuotes(latest);
    // Use previous day's snapshot as baseline (consistent with historical bars).
    // If only one day exists, fall back to today's stored snapshot.
    const prevSnap = final.length >= 2 ? final[final.length - 2] : null;
    const prevValue = prevSnap ? prevSnap.totalValue : latest.totalValue;
    const liveCostChange = prevSnap ? liveSnapshot.totalCost - prevSnap.totalCost : 0;
    const liveDailyPnl = liveSnapshot.totalValue - prevValue - liveCostChange;
    const livePoint: PortfolioHistoryPoint = {
      timestamp: new Date().toISOString(),
      totalValue: liveSnapshot.totalValue,
      totalCost: liveSnapshot.totalCost,
      totalPnl: liveSnapshot.totalPnl,
      totalPnlPercent: liveSnapshot.totalPnlPercent,
      periodPnl: liveDailyPnl,
      periodPnlPercent: prevValue > 0 ? (liveDailyPnl / prevValue) * 100 : 0,
    };
    // Replace last entry if same day, otherwise append
    const liveDay = livePoint.timestamp.slice(0, 10);
    const lastDay = history[history.length - 1]?.timestamp.slice(0, 10);
    if (liveDay === lastDay) {
      history[history.length - 1] = livePoint;
    } else {
      history.push(livePoint);
    }
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
  const enriched = await enrichWithLiveQuotes(snapshot);
  pubsub.publish('portfolioUpdate', enriched);
  onPortfolioChangedCb?.([newPosition.symbol]);
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

  // Look up existing position first so we can preserve its entry date
  const targetPlatformPositions = existing.positions.filter((p) => (p.platform ?? '').toUpperCase() === targetPlatform);
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
      positions: existing.positions.filter((p) => (p.platform ?? '').toUpperCase() !== targetPlatform),
    },
  });
  const enriched = await enrichWithLiveQuotes(snapshot);
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

  const remaining = existing.positions.filter(
    (p) => !(p.symbol.toUpperCase() === targetSymbol && (p.platform ?? '').toUpperCase() === targetPlatform),
  );

  // Save the filtered positions for this platform
  const platformPositions = remaining.filter((p) => (p.platform ?? '').toUpperCase() === targetPlatform);
  const snapshot = await snapshotStore.save({
    positions: platformPositions,
    platform: targetPlatform,
    existingSnapshot: {
      ...existing,
      positions: existing.positions.filter((p) => (p.platform ?? '').toUpperCase() !== targetPlatform),
    },
  });
  const enriched = await enrichWithLiveQuotes(snapshot);
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
