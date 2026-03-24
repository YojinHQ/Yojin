import type { Entity, JintelClient, JintelResult } from '@yojinhq/jintel-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enrichedSnapshotQuery,
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
