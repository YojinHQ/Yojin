import type { JintelClient, TickerPriceHistory } from '@yojinhq/jintel-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  portfolioHistoryQuery,
  setPortfolioJintelClient,
  setSnapshotStore,
} from '../../../../src/api/graphql/resolvers/portfolio.js';
import type { PortfolioSnapshot } from '../../../../src/api/graphql/types.js';
import type { PortfolioSnapshotStore } from '../../../../src/portfolio/snapshot-store.js';

function makeSnapshot(
  positions: PortfolioSnapshot['positions'],
  timestamp: string = new Date().toISOString(),
): PortfolioSnapshot {
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalCost = positions.reduce((s, p) => s + p.costBasis * p.quantity, 0);
  return {
    id: 'snap-test',
    positions,
    totalValue,
    totalCost,
    totalPnl: totalValue - totalCost,
    totalPnlPercent: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    totalDayChange: 0,
    totalDayChangePercent: 0,
    timestamp,
    platform: null,
  };
}

function makePriceHistory(ticker: string, prices: Record<string, number>): TickerPriceHistory {
  return {
    ticker,
    history: Object.entries(prices).map(([date, close]) => ({
      date,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1000,
    })),
  };
}

function createMockJintel(priceHistories: TickerPriceHistory[]): JintelClient {
  return {
    priceHistory: vi.fn().mockResolvedValue({ success: true, data: priceHistories }),
    quotes: vi.fn().mockResolvedValue({ success: false, error: 'not needed' }),
  } as unknown as JintelClient;
}

function createMockStore(snapshot: PortfolioSnapshot): PortfolioSnapshotStore {
  return {
    getLatest: vi.fn().mockResolvedValue(snapshot),
    getFirst: vi.fn().mockResolvedValue(snapshot),
    getPositionTimeline: vi.fn().mockResolvedValue(new Map()),
    save: vi.fn(),
  } as unknown as PortfolioSnapshotStore;
}

describe('portfolioHistoryQuery — backfill from Jintel prices', () => {
  beforeEach(() => {
    setPortfolioJintelClient(undefined);
  });

  it('returns empty when no jintel client', async () => {
    const latest = makeSnapshot([
      {
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 10,
        costBasis: 150,
        currentPrice: 200,
        marketValue: 2000,
        unrealizedPnl: 500,
        unrealizedPnlPercent: 33.33,
        assetClass: 'EQUITY',
        platform: 'MANUAL',
        entryDate: '2026-04-01',
      },
    ]);
    setSnapshotStore(createMockStore(latest));
    setPortfolioJintelClient(undefined);

    const history = await portfolioHistoryQuery(7);
    expect(history).toEqual([]);
  });

  it('emits a live trailing point for a fresh same-day import', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const snap = makeSnapshot([
      {
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 10,
        costBasis: 150,
        currentPrice: 200,
        marketValue: 2000,
        unrealizedPnl: 500,
        unrealizedPnlPercent: 33.33,
        assetClass: 'EQUITY',
        platform: 'MANUAL',
        entryDate: today,
      },
    ]);
    setSnapshotStore(createMockStore(snap));
    setPortfolioJintelClient(createMockJintel([]));

    const history = await portfolioHistoryQuery(7);

    // A same-day import has no backfill window, but the live trailing point
    // should still render so the chart isn't empty on import day.
    expect(history).toHaveLength(1);
    expect(history[0].totalValue).toBe(2000);
    expect(history[0].periodPnl).toBe(500);
  });

  it('plots every day from entryDate with unrealized P&L vs. cost basis', async () => {
    const d = (offset: number) => new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const day3ago = d(3);
    const day2ago = d(2);
    const day1ago = d(1);

    const latest = makeSnapshot([
      {
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 10,
        costBasis: 150,
        currentPrice: 200,
        marketValue: 2000,
        unrealizedPnl: 500,
        unrealizedPnlPercent: 33.33,
        assetClass: 'EQUITY',
        platform: 'MANUAL',
        entryDate: day3ago,
      },
    ]);
    const prices = makePriceHistory('AAPL', {
      [day3ago]: 200,
      [day2ago]: 210,
      [day1ago]: 205,
    });
    setSnapshotStore(createMockStore(latest));
    setPortfolioJintelClient(createMockJintel([prices]));

    const history = await portfolioHistoryQuery(7);

    // Entry day is now plotted.
    const point3ago = history.find((p) => p.timestamp.slice(0, 10) === day3ago);
    const point2ago = history.find((p) => p.timestamp.slice(0, 10) === day2ago);
    const point1ago = history.find((p) => p.timestamp.slice(0, 10) === day1ago);

    // Day 3 ago: value=2000, cost=1500 → pnl=500
    expect(point3ago?.totalValue).toBe(2000);
    expect(point3ago?.periodPnl).toBe(500);
    // Day 2 ago: value=2100, cost=1500 → pnl=600
    expect(point2ago?.totalValue).toBe(2100);
    expect(point2ago?.periodPnl).toBe(600);
    // Day 1 ago: value=2050, cost=1500 → pnl=550
    expect(point1ago?.totalValue).toBe(2050);
    expect(point1ago?.periodPnl).toBe(550);
  });

  it('returns empty when no positions', async () => {
    const snap = makeSnapshot([]);
    setSnapshotStore(createMockStore(snap));
    setPortfolioJintelClient(createMockJintel([]));

    const history = await portfolioHistoryQuery(7);
    expect(history).toEqual([]);
  });

  it('returns empty when Jintel fails', async () => {
    const latest = makeSnapshot([
      {
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 10,
        costBasis: 150,
        currentPrice: 200,
        marketValue: 2000,
        unrealizedPnl: 500,
        unrealizedPnlPercent: 33.33,
        assetClass: 'EQUITY',
        platform: 'MANUAL',
        entryDate: '2026-04-01',
      },
    ]);
    const failClient = {
      priceHistory: vi.fn().mockResolvedValue({ success: false, error: 'API down' }),
      quotes: vi.fn().mockResolvedValue({ success: false }),
    } as unknown as JintelClient;

    setSnapshotStore(createMockStore(latest));
    setPortfolioJintelClient(failClient);

    const history = await portfolioHistoryQuery(7);
    expect(history).toEqual([]);
  });

  it('calls getPositionTimeline for positions missing entryDate', async () => {
    const latest = makeSnapshot([
      {
        symbol: 'AAPL',
        name: 'Apple',
        quantity: 10,
        costBasis: 150,
        currentPrice: 200,
        marketValue: 2000,
        unrealizedPnl: 500,
        unrealizedPnlPercent: 33.33,
        assetClass: 'EQUITY',
        platform: 'ROBINHOOD',
      },
    ]);
    const mockStore = createMockStore(latest);
    const prices = makePriceHistory('AAPL', { '2026-04-01': 200 });

    setSnapshotStore(mockStore);
    setPortfolioJintelClient(createMockJintel([prices]));

    await portfolioHistoryQuery(7);

    expect(mockStore.getPositionTimeline).toHaveBeenCalledWith(['AAPL']);
  });
});
