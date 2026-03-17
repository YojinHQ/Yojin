/**
 * Portfolio resolvers — queries for portfolio overview and individual positions.
 *
 * Returns mock data representing a diversified retail portfolio across equities,
 * ETFs, and crypto. Will be swapped for real data sources (scraper snapshots,
 * enrichment pipeline) once wired into YojinContext.
 */

interface MockPosition {
  symbol: string;
  name: string;
  quantity: number;
  currentPrice: number;
  avgCost: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  dayChange: number;
  dayChangePercent: number;
  weight: number;
  assetClass: string;
  sector: string | null;
  platform: string;
}

const mockPositions: MockPosition[] = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    quantity: 50,
    currentPrice: 189.84,
    avgCost: 162.35,
    marketValue: 9492.0,
    unrealizedPnl: 1374.5,
    unrealizedPnlPercent: 16.93,
    dayChange: 2.15,
    dayChangePercent: 1.15,
    weight: 0.252,
    assetClass: 'equity',
    sector: 'Technology',
    platform: 'interactive-brokers',
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    quantity: 25,
    currentPrice: 420.72,
    avgCost: 378.5,
    marketValue: 10518.0,
    unrealizedPnl: 1055.5,
    unrealizedPnlPercent: 11.14,
    dayChange: -1.28,
    dayChangePercent: -0.3,
    weight: 0.279,
    assetClass: 'equity',
    sector: 'Technology',
    platform: 'interactive-brokers',
  },
  {
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    quantity: 20,
    currentPrice: 512.45,
    avgCost: 488.2,
    marketValue: 10249.0,
    unrealizedPnl: 485.0,
    unrealizedPnlPercent: 4.97,
    dayChange: 0.85,
    dayChangePercent: 0.17,
    weight: 0.272,
    assetClass: 'etf',
    sector: null,
    platform: 'interactive-brokers',
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    quantity: 0.08,
    currentPrice: 67450.0,
    avgCost: 42300.0,
    marketValue: 5396.0,
    unrealizedPnl: 2012.0,
    unrealizedPnlPercent: 59.46,
    dayChange: 1250.0,
    dayChangePercent: 1.89,
    weight: 0.143,
    assetClass: 'crypto',
    sector: null,
    platform: 'coinbase',
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    quantity: 1.5,
    currentPrice: 3520.0,
    avgCost: 2850.0,
    marketValue: 5280.0,
    unrealizedPnl: 1005.0,
    unrealizedPnlPercent: 23.51,
    dayChange: -45.0,
    dayChangePercent: -1.26,
    weight: 0.054,
    assetClass: 'crypto',
    sector: null,
    platform: 'coinbase',
  },
];

function buildPortfolio() {
  const totalValue = mockPositions.reduce((sum, p) => sum + p.marketValue, 0);
  const dayChange = mockPositions.reduce((sum, p) => sum + p.dayChange * p.quantity, 0);
  const dayChangePercent = (dayChange / (totalValue - dayChange)) * 100;

  return {
    totalValue,
    dayChange,
    dayChangePercent: Math.round(dayChangePercent * 100) / 100,
    positions: mockPositions,
    lastUpdated: new Date().toISOString(),
  };
}

export const portfolioResolvers = {
  Query: {
    portfolio: () => buildPortfolio(),
    positions: () => mockPositions,
    position: (_: unknown, { symbol }: { symbol: string }) =>
      mockPositions.find((p) => p.symbol.toLowerCase() === symbol.toLowerCase()) ?? null,
  },
};
