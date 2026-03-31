import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  portfolioHistoryQuery,
  setPortfolioJintelClient,
  setSnapshotStore,
} from '../../../../src/api/graphql/resolvers/portfolio.js';
import type { PortfolioSnapshotStore } from '../../../../src/portfolio/snapshot-store.js';

function makeSnapshotAt(day: string, totalValue: number, totalCost: number) {
  return {
    id: `snap-${day}`,
    positions: [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        quantity: 10,
        costBasis: 150,
        currentPrice: totalValue / 10,
        marketValue: totalValue,
        unrealizedPnl: totalValue - totalCost,
        unrealizedPnlPercent: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
        assetClass: 'EQUITY' as const,
        platform: 'MANUAL' as const,
      },
    ],
    totalValue,
    totalCost,
    totalPnl: totalValue - totalCost,
    totalPnlPercent: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    totalDayChange: 0,
    totalDayChangePercent: 0,
    timestamp: `${day}T16:00:00Z`,
    platform: 'MANUAL' as const,
  };
}

function createMockStore(snapshots: ReturnType<typeof makeSnapshotAt>[]): PortfolioSnapshotStore {
  return {
    getLatest: vi.fn().mockResolvedValue(snapshots[snapshots.length - 1]),
    getAll: vi.fn().mockResolvedValue(snapshots),
    save: vi.fn(),
  } as unknown as PortfolioSnapshotStore;
}

describe('portfolioHistoryQuery — period returns', () => {
  beforeEach(() => {
    setPortfolioJintelClient(undefined);
  });

  it('computes periodPnl as daily change excluding deposits', async () => {
    const snapshots = [
      makeSnapshotAt('2026-03-25', 1000, 900),
      makeSnapshotAt('2026-03-26', 1050, 900),
      makeSnapshotAt('2026-03-27', 980, 900),
    ];
    setSnapshotStore(createMockStore(snapshots) as unknown as PortfolioSnapshotStore);
    const history = await portfolioHistoryQuery(7);
    expect(history[0].periodPnl).toBe(0);
    expect(history[0].periodPnlPercent).toBe(0);
    // Day-over-day: 1050 - 1000 = +50
    expect(history[1].periodPnl).toBe(50);
    expect(history[1].periodPnlPercent).toBeCloseTo(5, 2);
    // Day-over-day: 980 - 1050 = -70
    expect(history[2].periodPnl).toBe(-70);
    expect(history[2].periodPnlPercent).toBeCloseTo(-6.67, 1);
  });

  it('handles single-day history with zero period return', async () => {
    const snapshots = [makeSnapshotAt('2026-03-27', 1000, 900)];
    setSnapshotStore(createMockStore(snapshots) as unknown as PortfolioSnapshotStore);
    const history = await portfolioHistoryQuery(7);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].periodPnl).toBe(0);
    expect(history[0].periodPnlPercent).toBe(0);
  });

  it('handles zero starting value without division by zero', async () => {
    const snapshots = [makeSnapshotAt('2026-03-25', 0, 0), makeSnapshotAt('2026-03-26', 500, 400)];
    setSnapshotStore(createMockStore(snapshots) as unknown as PortfolioSnapshotStore);
    const history = await portfolioHistoryQuery(7);
    expect(history[0].periodPnl).toBe(0);
    expect(history[0].periodPnlPercent).toBe(0);
    // Daily PnL = valueChange (500) - costChange (400) = 100 (pure market gain)
    expect(history[1].periodPnl).toBe(100);
    expect(history[1].periodPnlPercent).toBe(0); // prevValue was 0 → no percent
  });
});
