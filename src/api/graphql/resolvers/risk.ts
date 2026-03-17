/**
 * Risk resolvers — queries for portfolio risk analysis.
 *
 * Returns mock risk report data including exposure breakdown (sector, asset class,
 * geography), concentration scoring, and correlated pair detection. Will be replaced
 * with real risk module output once wired into YojinContext.
 */

const mockRiskReport = {
  overallScore: 6.2,
  exposureBreakdown: {
    bySector: [
      { name: 'Technology', weight: 0.531, value: 20010.0 },
      { name: 'Broad Market', weight: 0.272, value: 10249.0 },
      { name: 'Crypto', weight: 0.197, value: 10676.0 },
    ],
    byAssetClass: [
      { name: 'Equity', weight: 0.531, value: 20010.0 },
      { name: 'ETF', weight: 0.272, value: 10249.0 },
      { name: 'Crypto', weight: 0.197, value: 10676.0 },
    ],
    byGeography: [
      { name: 'United States', weight: 0.803, value: 30259.0 },
      { name: 'Global / Decentralized', weight: 0.197, value: 10676.0 },
    ],
  },
  concentrationScore: 7.1,
  topConcentrations: [
    { symbol: 'MSFT', weight: 0.279, risk: 'moderate' },
    { symbol: 'SPY', weight: 0.272, risk: 'moderate' },
    { symbol: 'AAPL', weight: 0.252, risk: 'moderate' },
    { symbol: 'BTC', weight: 0.143, risk: 'low' },
    { symbol: 'ETH', weight: 0.054, risk: 'low' },
  ],
  correlatedPairs: [
    { symbolA: 'AAPL', symbolB: 'MSFT', correlation: 0.87 },
    { symbolA: 'AAPL', symbolB: 'SPY', correlation: 0.92 },
    { symbolA: 'BTC', symbolB: 'ETH', correlation: 0.81 },
  ],
  generatedAt: new Date().toISOString(),
};

export const riskResolvers = {
  Query: {
    riskReport: () => mockRiskReport,
  },
};
