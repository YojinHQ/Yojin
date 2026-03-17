/**
 * Enrichment resolvers — queries for enriched portfolio data (sentiment + fundamentals).
 *
 * Returns mock enriched snapshot data representing dual-source enrichment output
 * (Keelson sentiment + OpenBB fundamentals). Will be replaced with real enrichment
 * pipeline output once wired into YojinContext.
 */

const mockEnrichedSnapshot = {
  positions: [
    {
      symbol: 'AAPL',
      sentiment: {
        score: 0.72,
        label: 'bullish',
        source: 'keelson',
        updatedAt: new Date(Date.now() - 3600_000).toISOString(),
      },
      fundamentals: {
        marketCap: 2_950_000_000_000,
        peRatio: 31.2,
        eps: 6.08,
        dividendYield: 0.0053,
        beta: 1.24,
        fiftyTwoWeekHigh: 199.62,
        fiftyTwoWeekLow: 164.08,
      },
    },
    {
      symbol: 'MSFT',
      sentiment: {
        score: 0.65,
        label: 'bullish',
        source: 'keelson',
        updatedAt: new Date(Date.now() - 3600_000).toISOString(),
      },
      fundamentals: {
        marketCap: 3_120_000_000_000,
        peRatio: 36.8,
        eps: 11.43,
        dividendYield: 0.0072,
        beta: 0.89,
        fiftyTwoWeekHigh: 430.82,
        fiftyTwoWeekLow: 362.9,
      },
    },
    {
      symbol: 'SPY',
      sentiment: {
        score: 0.55,
        label: 'neutral',
        source: 'keelson',
        updatedAt: new Date(Date.now() - 7200_000).toISOString(),
      },
      fundamentals: {
        marketCap: null,
        peRatio: 23.5,
        eps: null,
        dividendYield: 0.013,
        beta: 1.0,
        fiftyTwoWeekHigh: 524.61,
        fiftyTwoWeekLow: 443.52,
      },
    },
    {
      symbol: 'BTC',
      sentiment: {
        score: 0.81,
        label: 'very bullish',
        source: 'keelson',
        updatedAt: new Date(Date.now() - 1800_000).toISOString(),
      },
      fundamentals: {
        marketCap: 1_320_000_000_000,
        peRatio: null,
        eps: null,
        dividendYield: null,
        beta: null,
        fiftyTwoWeekHigh: 73750.0,
        fiftyTwoWeekLow: 38500.0,
      },
    },
    {
      symbol: 'ETH',
      sentiment: {
        score: 0.58,
        label: 'neutral',
        source: 'keelson',
        updatedAt: new Date(Date.now() - 1800_000).toISOString(),
      },
      fundamentals: {
        marketCap: 423_000_000_000,
        peRatio: null,
        eps: null,
        dividendYield: null,
        beta: null,
        fiftyTwoWeekHigh: 4092.0,
        fiftyTwoWeekLow: 2150.0,
      },
    },
  ],
  generatedAt: new Date().toISOString(),
};

export const enrichmentResolvers = {
  Query: {
    enrichedSnapshot: () => mockEnrichedSnapshot,
  },
};
