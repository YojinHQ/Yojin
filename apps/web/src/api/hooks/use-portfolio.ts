import { useQuery, useMutation } from 'urql';

import { PORTFOLIO_QUERY, POSITIONS_QUERY, ENRICHED_SNAPSHOT_QUERY, REFRESH_POSITIONS_MUTATION } from '../documents.js';
import type {
  PortfolioQueryResult,
  PositionsQueryResult,
  EnrichedSnapshotQueryResult,
  RefreshPositionsMutationResult,
  RefreshPositionsVariables,
} from '../types.js';

/** Full portfolio snapshot with positions, totals, and P&L. */
export function usePortfolio() {
  return useQuery<PortfolioQueryResult>({ query: PORTFOLIO_QUERY });
}

/** Flat list of all positions across platforms. */
export function usePositions() {
  return useQuery<PositionsQueryResult>({ query: POSITIONS_QUERY });
}

/** Enriched snapshot — positions augmented with sentiment, analyst data, fundamentals. */
export function useEnrichedSnapshot() {
  return useQuery<EnrichedSnapshotQueryResult>({ query: ENRICHED_SNAPSHOT_QUERY });
}

/** Trigger a position refresh from a specific brokerage platform. */
export function useRefreshPositions() {
  return useMutation<RefreshPositionsMutationResult, RefreshPositionsVariables>(REFRESH_POSITIONS_MUTATION);
}
