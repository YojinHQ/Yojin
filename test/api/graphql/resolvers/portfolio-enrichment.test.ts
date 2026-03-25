import type { Entity, JintelClient, JintelResult, MarketQuote } from '@yojinhq/jintel-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enrichedSnapshotQuery,
  portfolioQuery,
  positionFieldResolvers,
  positionsQuery,
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

function createMockJintelClient(enrichFn?: JintelClient['enrichEntity']): JintelClient {
  return {
    enrichEntity: enrichFn ?? vi.fn(),
    quotes: vi.fn().mockResolvedValue({ success: true, data: [] }),
  } as unknown as JintelClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enrichedSnapshotQuery', () => {
  beforeEach(() => {
    setPortfolioJintelClient(undefined);
    setSnapshotStore(createMockStore() as unknown as PortfolioSnapshotStore);
  });

  it('enriches positions when Jintel client is available', async () => {
    const enrichFn = vi.fn().mockImplementation((ticker: string): Promise<JintelResult<Entity>> => {
      const fundamentals: Record<string, Record<string, unknown>> = {
        AAPL: {
          peRatio: 28.5,
          dividendYield: 0.55,
          beta: 1.2,
          fiftyTwoWeekHigh: 200,
          fiftyTwoWeekLow: 130,
          sector: 'Technology',
          source: 'test',
        },
        GOOG: {
          peRatio: 25.1,
          dividendYield: null,
          beta: 1.1,
          fiftyTwoWeekHigh: 160,
          fiftyTwoWeekLow: 90,
          sector: 'Technology',
          source: 'test',
        },
      };

      return Promise.resolve({
        success: true as const,
        data: {
          market: { fundamentals: fundamentals[ticker] },
        } as unknown as Entity,
      });
    });

    setPortfolioJintelClient(createMockJintelClient(enrichFn));

    const result = await enrichedSnapshotQuery();

    expect(result.positions).toHaveLength(2);
    expect(result.enrichedAt).toBeDefined();

    const aapl = result.positions.find((p) => p.symbol === 'AAPL')!;
    expect(aapl.peRatio).toBe(28.5);
    expect(aapl.dividendYield).toBe(0.55);
    expect(aapl.beta).toBe(1.2);
    expect(aapl.fiftyTwoWeekHigh).toBe(200);
    expect(aapl.fiftyTwoWeekLow).toBe(130);
    expect(aapl.sector).toBe('Technology');

    const goog = result.positions.find((p) => p.symbol === 'GOOG')!;
    expect(goog.peRatio).toBe(25.1);
    expect(goog.dividendYield).toBeUndefined(); // null → undefined
    expect(goog.beta).toBe(1.1);

    expect(enrichFn).toHaveBeenCalledWith('AAPL', ['market']);
    expect(enrichFn).toHaveBeenCalledWith('GOOG', ['market']);
  });

  it('returns unenriched positions when Jintel fails', async () => {
    const enrichFn = vi.fn().mockResolvedValue({
      success: false,
      error: 'Entity not found',
    });

    setPortfolioJintelClient(createMockJintelClient(enrichFn));

    const result = await enrichedSnapshotQuery();

    expect(result.positions).toHaveLength(2);
    const aapl = result.positions.find((p) => p.symbol === 'AAPL')!;
    expect(aapl.peRatio).toBeUndefined();
    expect(aapl.beta).toBeUndefined();
    expect(aapl.sector).toBeUndefined();
    // Original position fields are preserved
    expect(aapl.symbol).toBe('AAPL');
    expect(aapl.currentPrice).toBe(175);
  });

  it('returns unenriched positions when no client', async () => {
    setPortfolioJintelClient(undefined);

    const result = await enrichedSnapshotQuery();

    expect(result.positions).toHaveLength(2);
    const aapl = result.positions.find((p) => p.symbol === 'AAPL')!;
    expect(aapl.peRatio).toBeUndefined();
    expect(aapl.beta).toBeUndefined();
    expect(aapl.fiftyTwoWeekHigh).toBeUndefined();
    // Original fields preserved
    expect(aapl.symbol).toBe('AAPL');
    expect(aapl.marketValue).toBe(1750);
    // Snapshot-level fields
    expect(result.totalValue).toBe(2450);
    expect(result.id).toMatch(/^enriched-/);
    expect(result.enrichedAt).toBeDefined();
  });
});

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
  } as unknown as JintelClient;
}

describe('live quote enrichment', () => {
  beforeEach(() => {
    setPortfolioJintelClient(undefined);
    setSnapshotStore(createMockStore() as unknown as PortfolioSnapshotStore);
  });

  it('positionsQuery returns positions with live prices from Jintel quotes', async () => {
    setPortfolioJintelClient(createQuoteMockClient());

    const positions = await positionsQuery();

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

    const positions = await positionsQuery();

    // Positions retain original store values
    const aapl = positions.find((p) => p.symbol === 'AAPL')!;
    expect(aapl.currentPrice).toBe(175);
    expect(aapl.marketValue).toBe(1750);
  });

  it('falls back gracefully when quotes call throws', async () => {
    const throwingQuotes = vi.fn().mockRejectedValue(new Error('Network error'));
    setPortfolioJintelClient(createQuoteMockClient(throwingQuotes));

    const positions = await positionsQuery();

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

    const positions = await positionsQuery();

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

    const positions = await positionsQuery();

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

    await positionsQuery();

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
