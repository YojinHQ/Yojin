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

function daysAgoISO(offset: number): string {
  return new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString();
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

function createMockStore(snapshot: PortfolioSnapshot, firstSnapshot?: PortfolioSnapshot): PortfolioSnapshotStore {
  return {
    getLatest: vi.fn().mockResolvedValue(snapshot),
    getFirst: vi.fn().mockResolvedValue(firstSnapshot ?? snapshot),
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
    // First import was 3 days ago — otherwise the "imported today" guard short-circuits
    // before the Jintel check and the test would pass for the wrong reason.
    const first = makeSnapshot(latest.positions, daysAgoISO(3));
    setSnapshotStore(createMockStore(latest, first));
    setPortfolioJintelClient(undefined);

    const history = await portfolioHistoryQuery(7);
    expect(history).toEqual([]);
  });

  it('returns empty on a fresh same-day import (no day-after yet)', async () => {
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
        entryDate: new Date().toISOString().slice(0, 10),
      },
    ]);
    setSnapshotStore(createMockStore(snap));
    setPortfolioJintelClient(createMockJintel([]));

    const history = await portfolioHistoryQuery(7);
    expect(history).toEqual([]);
  });

  it('emits first bar the day after first import with cumulative delta from baseline', async () => {
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
    // First import was 3 days ago at $2000 value / $1500 cost — this is the baseline.
    const first = makeSnapshot(latest.positions, daysAgoISO(3));
    const prices = makePriceHistory('AAPL', {
      [day3ago]: 200,
      [day2ago]: 210,
      [day1ago]: 205,
    });
    setSnapshotStore(createMockStore(latest, first));
    setPortfolioJintelClient(createMockJintel([prices]));

    const history = await portfolioHistoryQuery(7);

    // Import day (day3ago) is the $0 baseline and is NOT plotted.
    expect(history.find((p) => p.timestamp.slice(0, 10) === day3ago)).toBeUndefined();

    const point2ago = history.find((p) => p.timestamp.slice(0, 10) === day2ago);
    const point1ago = history.find((p) => p.timestamp.slice(0, 10) === day1ago);
    expect(point2ago?.totalValue).toBe(2100);
    // Cumulative P&L vs. baseline ($2000 value, $1500 cost): (2100-2000) - 0 = 100
    expect(point2ago?.periodPnl).toBe(100);
    expect(point1ago?.totalValue).toBe(2050);
    expect(point1ago?.periodPnl).toBe(50);
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
    const first = makeSnapshot(latest.positions, daysAgoISO(3));
    const failClient = {
      priceHistory: vi.fn().mockResolvedValue({ success: false, error: 'API down' }),
      quotes: vi.fn().mockResolvedValue({ success: false }),
    } as unknown as JintelClient;

    setSnapshotStore(createMockStore(latest, first));
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
    const first = makeSnapshot(latest.positions, daysAgoISO(3));
    const mockStore = createMockStore(latest, first);
    const prices = makePriceHistory('AAPL', { '2026-04-01': 200 });

    setSnapshotStore(mockStore);
    setPortfolioJintelClient(createMockJintel([prices]));

    await portfolioHistoryQuery(7);

    expect(mockStore.getPositionTimeline).toHaveBeenCalledWith(['AAPL']);
  });
});
