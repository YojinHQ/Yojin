/**
 * Portfolio resolvers — portfolio, positions, enrichedSnapshot, refreshPositions.
 */

import { pubsub } from '../pubsub.js';
import type { EnrichedPosition, EnrichedSnapshot, Platform, PortfolioSnapshot, Position } from '../types.js';

// ---------------------------------------------------------------------------
// Stub data — replaced by real services when available
// ---------------------------------------------------------------------------

const stubPositions: Position[] = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    quantity: 50,
    costBasis: 145.0,
    currentPrice: 178.5,
    marketValue: 8925.0,
    unrealizedPnl: 1675.0,
    unrealizedPnlPercent: 23.1,
    sector: 'Technology',
    assetClass: 'EQUITY',
    platform: 'INTERACTIVE_BROKERS',
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corp.',
    quantity: 30,
    costBasis: 310.0,
    currentPrice: 415.2,
    marketValue: 12456.0,
    unrealizedPnl: 3156.0,
    unrealizedPnlPercent: 33.94,
    sector: 'Technology',
    assetClass: 'EQUITY',
    platform: 'INTERACTIVE_BROKERS',
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    quantity: 0.5,
    costBasis: 42000.0,
    currentPrice: 67500.0,
    marketValue: 33750.0,
    unrealizedPnl: 12750.0,
    unrealizedPnlPercent: 60.71,
    sector: undefined,
    assetClass: 'CRYPTO',
    platform: 'COINBASE',
  },
];

function buildSnapshot(platform?: Platform): PortfolioSnapshot {
  const positions = platform ? stubPositions.filter((p) => p.platform === platform) : stubPositions;
  const totalValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const totalCost = positions.reduce((sum, p) => sum + p.costBasis * p.quantity, 0);
  const totalPnl = totalValue - totalCost;

  return {
    id: `snap-${Date.now()}`,
    positions,
    totalValue,
    totalCost,
    totalPnl,
    totalPnlPercent: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
    timestamp: new Date().toISOString(),
    platform: platform ?? null,
  };
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export function portfolioQuery(): PortfolioSnapshot {
  return buildSnapshot();
}

export function positionsQuery(): Position[] {
  return stubPositions;
}

export function enrichedSnapshotQuery(): EnrichedSnapshot {
  const snapshot = buildSnapshot();
  const enriched: EnrichedPosition[] = snapshot.positions.map((p) => ({
    ...p,
    sentimentScore: 0.72,
    sentimentLabel: 'Bullish',
    analystRating: 'Buy',
    targetPrice: p.currentPrice * 1.15,
    peRatio: 28.5,
    dividendYield: 0.5,
    beta: 1.1,
    fiftyTwoWeekHigh: p.currentPrice * 1.2,
    fiftyTwoWeekLow: p.currentPrice * 0.7,
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

export function refreshPositionsMutation(_parent: unknown, args: { platform: Platform }): PortfolioSnapshot {
  const snapshot = buildSnapshot(args.platform);
  pubsub.publish('portfolioUpdate', snapshot);
  return snapshot;
}
