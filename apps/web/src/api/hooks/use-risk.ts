import { useQuery } from 'urql';

import { RISK_REPORT_QUERY } from '../documents.js';
import type { RiskReportQueryResult } from '../types.js';

/** Full risk report: sector exposure, concentration, correlations, drawdown, VaR. */
export function useRiskReport() {
  return useQuery<RiskReportQueryResult>({ query: RISK_REPORT_QUERY });
}
