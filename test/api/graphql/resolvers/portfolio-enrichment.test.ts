import type { JintelClient, MarketQuote } from '@yojinhq/jintel-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isUSMarketOpen,
  portfolioQuery,
  positionFieldResolvers,
  setPortfolioJintelClient,
  setSnapshotStore,
} from '../../../../src/api/graphql/resolvers/portfolio.js';
import type { PortfolioSnapshotStore } from '../../../../src/portfolio/snapshot-store.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSnapshot() {
  return {
    id: 'snap-1',
    positions: [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        quantity: 10,
        costBasis: 150,
        currentPrice: 175,
        marketValue: 1750,
        unrealizedPnl: 250,
        unrealizedPnlPercent: 16.67,
        assetClass: 'EQUITY' as const,
        platform: 'MANUAL' as const,
      },
      {
        symbol: 'GOOG',
        name: 'Alphabet Inc.',
        quantity: 5,
        costBasis: 100,
        currentPrice: 140,
        marketValue: 700,
        unrealizedPnl: 200,
        unrealizedPnlPercent: 40,
        assetClass: 'EQUITY' as const,
        platform: 'MANUAL' as const,
      },
    ],
    totalValue: 2450,
    totalCost: 2000,
    totalPnl: 450,
    totalPnlPercent: 22.5,
    timestamp: '2026-03-24T00:00:00Z',
    platform: 'MANUAL' as const,
  };
}

function createMockStore(): PortfolioSnapshotStore {
  return {
    getLatest: vi.fn().mockResolvedValue(makeSnapshot()),
    getAll: vi.fn().mockResolvedValue([makeSnapshot()]),
    save: vi.fn(),
  } as unknown as PortfolioSnapshotStore;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Live quote enrichment tests
// ---------------------------------------------------------------------------

function makeQuotes(): MarketQuote[] {
  return [
    {
      ticker: 'AAPL',
      price: 190,
      change: 2.5,
      changePercent: 1.33,
      volume: 50_000_000,
      timestamp: '2026-03-24T16:00:00Z',
      source: 'test',
    },
    {
      ticker: 'GOOG',
      price: 155,
      change: -1.2,
      changePercent: -0.77,
      volume: 20_000_000,
      timestamp: '2026-03-24T16:00:00Z',
      source: 'test',
    },
  ];
}

function createQuoteMockClient(
  quotesFn?: JintelClient['quotes'],
  enrichFn?: JintelClient['enrichEntity'],
): JintelClient {
  return {
    enrichEntity: enrichFn ?? vi.fn(),
    quotes: quotesFn ?? vi.fn().mockResolvedValue({ success: true, data: makeQuotes() }),
    priceHistory: vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          ticker: 'AAPL',
          history: [
            { date: '2026-03-20', open: 185, high: 187, low: 184, close: 186, volume: 40_000_000 },
            { date: '2026-03-21', open: 186, high: 189, low: 185, close: 188, volume: 42_000_000 },
            { date: '2026-03-24', open: 188, high: 191, low: 187, close: 190, volume: 50_000_000 },
          ],
        },
        {
          ticker: 'GOOG',
          history: [
            { date: '2026-03-20', open: 150, high: 153, low: 149, close: 152, volume: 18_000_000 },
            { date: '2026-03-21', open: 152, high: 156, low: 151, close: 155, volume: 19_000_000 },
            { date: '2026-03-24', open: 155, high: 157, low: 153, close: 155, volume: 20_000_000 },
          ],
        },
      ],
    }),
  } as unknown as JintelClient;
}

describe('isUSMarketOpen', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true during regular trading hours (Mon–Fri 9:30–16:00 ET)', () => {
    // Wednesday 2026-03-25 at 12:00 ET = 16:00 UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T16:00:00Z'));
    expect(isUSMarketOpen()).toBe(true);
  });

  it('returns false before market open', () => {
    // Wednesday 2026-03-25 at 9:00 ET = 13:00 UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T13:00:00Z'));
    expect(isUSMarketOpen()).toBe(false);
  });

  it('returns false after market close', () => {
    // Wednesday 2026-03-25 at 16:30 ET = 20:30 UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T20:30:00Z'));
    expect(isUSMarketOpen()).toBe(false);
  });

  it('returns false on weekends', () => {
    // Saturday 2026-03-28 at 12:00 ET = 16:00 UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T16:00:00Z'));
    expect(isUSMarketOpen()).toBe(false);
  });
});

describe('live quote enrichment', () => {
  beforeEach(() => {
    setPortfolioJintelClient(undefined);
    setSnapshotStore(createMockStore() as unknown as PortfolioSnapshotStore);
  });

  it('portfolioQuery returns positions with live prices from Jintel quotes', async () => {
    setPortfolioJintelClient(createQuoteMockClient());

    const positions = (await portfolioQuery()).positions;

    const aapl = positions.find((p) => p.symbol === 'AAPL')!;
    expect(aapl.currentPrice).toBe(190);
    expect(aapl.marketValue).toBe(10 * 190); // quantity × live price
    expect(aapl.dayChange).toBe(2.5);
    expect(aapl.dayChangePercent).toBe(1.33);
    // PnL recalculated: (190 - 150) / 150 * 100
    expect(aapl.unrealizedPnl).toBe(10 * 190 - 10 * 150);
    expect(aapl.unrealizedPnlPercent).toBeCloseTo(((190 - 150) / 150) * 100, 2);

    const goog = positions.find((p) => p.symbol === 'GOOG')!;
    expect(goog.currentPrice).toBe(155);
    expect(goog.marketValue).toBe(5 * 155);
    expect(goog.dayChange).toBe(-1.2);
    expect(goog.dayChangePercent).toBe(-0.77);
  });

  it('portfolioQuery recalculates totals from live prices', async () => {
    setPortfolioJintelClient(createQuoteMockClient());

    const portfolio = await portfolioQuery();

    const expectedTotalValue = 10 * 190 + 5 * 155; // 1900 + 775 = 2675
    const expectedTotalCost = 10 * 150 + 5 * 100; // 1500 + 500 = 2000
    expect(portfolio.totalValue).toBe(expectedTotalValue);
    expect(portfolio.totalCost).toBe(expectedTotalCost);
    expect(portfolio.totalPnl).toBe(expectedTotalValue - expectedTotalCost);
    expect(portfolio.totalPnlPercent).toBeCloseTo(
      ((expectedTotalValue - expectedTotalCost) / expectedTotalCost) * 100,
      2,
    );
  });

  it('falls back gracefully when quotes call fails', async () => {
    const failingQuotes = vi.fn().mockResolvedValue({ success: false, error: 'API down' });
    setPortfolioJintelClient(createQuoteMockClient(failingQuotes));

    const positions = (await portfolioQuery()).positions;

    // Positions retain original store values
    const aapl = positions.find((p) => p.symbol === 'AAPL')!;
    expect(aapl.currentPrice).toBe(175);
    expect(aapl.marketValue).toBe(1750);
  });

  it('falls back gracefully when quotes call throws', async () => {
    const throwingQuotes = vi.fn().mockRejectedValue(new Error('Network error'));
    setPortfolioJintelClient(createQuoteMockClient(throwingQuotes));

    const positions = (await portfolioQuery()).positions;

    const aapl = positions.find((p) => p.symbol === 'AAPL')!;
    expect(aapl.currentPrice).toBe(175);
  });

  it('preserves positions when no quote exists for a symbol', async () => {
    // Only return a quote for AAPL, not GOOG
    const partialQuotes = vi.fn().mockResolvedValue({
      success: true,
      data: [makeQuotes()[0]],
    });
    setPortfolioJintelClient(createQuoteMockClient(partialQuotes));

    const positions = (await portfolioQuery()).positions;

    // AAPL gets live price
    const aapl = positions.find((p) => p.symbol === 'AAPL')!;
    expect(aapl.currentPrice).toBe(190);

    // GOOG retains original price
    const goog = positions.find((p) => p.symbol === 'GOOG')!;
    expect(goog.currentPrice).toBe(140);
    expect(goog.marketValue).toBe(700);
  });

  it('handles null entries in quotes response', async () => {
    // Jintel can return null for symbols it doesn't recognize
    const quotesWithNull = vi.fn().mockResolvedValue({
      success: true,
      data: [makeQuotes()[0], null],
    });
    setPortfolioJintelClient(createQuoteMockClient(quotesWithNull));

    const positions = (await portfolioQuery()).positions;

    // AAPL gets live price from the valid quote
    const aapl = positions.find((p) => p.symbol === 'AAPL')!;
    expect(aapl.currentPrice).toBe(190);

    // GOOG retains original price (its quote was null)
    const goog = positions.find((p) => p.symbol === 'GOOG')!;
    expect(goog.currentPrice).toBe(140);
    expect(goog.marketValue).toBe(700);
  });

  it('makes one batch call with deduplicated symbols', async () => {
    const quotesFn = vi.fn().mockResolvedValue({ success: true, data: makeQuotes() });
    setPortfolioJintelClient(createQuoteMockClient(quotesFn));

    await portfolioQuery();

    expect(quotesFn).toHaveBeenCalledTimes(1);
    expect(quotesFn).toHaveBeenCalledWith(['AAPL', 'GOOG']);
  });
});

describe('positionFieldResolvers', () => {
  it('returns dayChange from position when set', () => {
    const pos = { ...makeSnapshot().positions[0], dayChange: 3.5, dayChangePercent: 2.0 };
    expect(positionFieldResolvers.dayChange(pos)).toBe(3.5);
    expect(positionFieldResolvers.dayChangePercent(pos)).toBe(2.0);
  });

  it('returns null for dayChange when not enriched with real quotes', () => {
    const pos = makeSnapshot().positions[0]; // AAPL, no dayChange set
    expect(positionFieldResolvers.dayChange(pos)).toBeNull();
    expect(positionFieldResolvers.dayChangePercent(pos)).toBeNull();
  });

  it('returns null for sparkline when not enriched', () => {
    const pos = makeSnapshot().positions[0];
    expect(positionFieldResolvers.sparkline(pos)).toBeNull();
  });
});
