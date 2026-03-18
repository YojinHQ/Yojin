import { useQuery } from 'urql';

import { RISK_REPORT_QUERY, SECTOR_EXPOSURE_QUERY } from '../documents.js';
import type { RiskReportQueryResult, SectorExposureQueryResult } from '../types.js';

/** Full risk report: sector exposure, concentration, correlations, drawdown, VaR. */
export function useRiskReport() {
  return useQuery<RiskReportQueryResult>({ query: RISK_REPORT_QUERY });
}

/** Sector allocation breakdown (subset of risk report). */
export function useSectorExposure() {
  return useQuery<SectorExposureQueryResult>({ query: SECTOR_EXPOSURE_QUERY });
}
