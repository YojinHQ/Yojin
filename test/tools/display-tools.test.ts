import type { JintelClient } from '@yojinhq/jintel-client';
import { describe, expect, it, vi } from 'vitest';

import type { ToolDefinition } from '../../src/core/types.js';
import type { PortfolioSnapshotStore } from '../../src/portfolio/snapshot-store.js';
import { createDisplayTools } from '../../src/tools/display-tools.js';

function createMockStore() {
  return {
    getLatest: vi.fn().mockResolvedValue({
      id: 'snap-fx-mixed',
      positions: [
        {
          symbol: 'QQQ',
          name: 'Invesco QQQ Trust',
          quantity: 42,
          costBasis: 447,
          currentPrice: 2102.294285714286,
          marketValue: 88296.36,
          unrealizedPnl: 69522.36,
          unrealizedPnlPercent: 370.41,
          assetClass: 'EQUITY' as const,
          platform: 'ISRAELI_BROKERAGE',
        },
      ],
      totalValue: 88296.36,
      totalCost: 18774,
      totalPnl: 69522.36,
      totalPnlPercent: 370.41,
      totalDayChange: 0,
      totalDayChangePercent: 0,
      timestamp: '2026-04-03T10:00:00Z',
      platform: null,
    }),
  } as unknown as PortfolioSnapshotStore;
}

function createQuoteMockClient(): JintelClient {
  return {
    quotes: vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          ticker: 'QQQ',
          price: 585,
          change: 4.2,
          changePercent: 0.72,
          volume: 1_000_000,
          timestamp: '2026-04-03T16:00:00Z',
          source: 'test',
        },
      ],
    }),
    priceHistory: vi.fn().mockResolvedValue({ success: true, data: [] }),
    enrichEntity: vi.fn(),
  } as unknown as JintelClient;
}

describe('Display tools', () => {
  it('normalizes display portfolio overview with live quotes before formatting', async () => {
    const client = createQuoteMockClient();
    const tools = createDisplayTools({
      snapshotStore: createMockStore(),
      getJintelClient: () => client,
    });

    const tool = tools.find((entry: ToolDefinition) => entry.name === 'display_portfolio_overview');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ period: 'today' });
    expect(result.displayCard).toBeDefined();
    expect(result.displayCard?.type).toBe('portfolio-overview');

    if (!result.displayCard || result.displayCard.type !== 'portfolio-overview') {
      throw new Error('Expected portfolio overview display card');
    }

    expect(result.displayCard.data.totalValue).toBe(42 * 585);
    expect(result.displayCard.data.totalPnl).toBe(42 * (585 - 447));
    expect(result.displayCard.data.totalPnlPercent).toBeCloseTo(((42 * 585 - 42 * 447) / (42 * 447)) * 100, 2);
    expect(result.displayCard.data.topHoldings[0]?.marketValue).toBe(42 * 585);
    expect(client.quotes as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(['QQQ']);
  });
});
