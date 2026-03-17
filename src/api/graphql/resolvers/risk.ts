/**
 * Risk resolvers — riskReport.
 */

import type { RiskReport } from '../types.js';

// ---------------------------------------------------------------------------
// Stub data
// ---------------------------------------------------------------------------

const stubRiskReport: RiskReport = {
  id: 'risk-001',
  portfolioValue: 55131.0,
  sectorExposure: [
    { sector: 'Technology', weight: 0.388, value: 21381.0 },
    { sector: 'Crypto', weight: 0.612, value: 33750.0 },
  ],
  concentrationScore: 0.72,
  topConcentrations: [
    { symbol: 'BTC', weight: 0.612 },
    { symbol: 'MSFT', weight: 0.226 },
    { symbol: 'AAPL', weight: 0.162 },
  ],
  correlationClusters: [{ symbols: ['AAPL', 'MSFT'], correlation: 0.82 }],
  maxDrawdown: -0.18,
  valueAtRisk: -4410.5,
  timestamp: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export function riskReportQuery(): RiskReport {
  return { ...stubRiskReport, timestamp: new Date().toISOString() };
}
