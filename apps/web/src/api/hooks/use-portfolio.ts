import { useQuery, useMutation } from 'urql';

import {
  PORTFOLIO_QUERY,
  POSITIONS_QUERY,
  PORTFOLIO_HISTORY_QUERY,
  ENRICHED_SNAPSHOT_QUERY,
  REFRESH_POSITIONS_MUTATION,
  ADD_MANUAL_POSITION_MUTATION,
} from '../documents.js';
import type {
  PortfolioQueryResult,
  PositionsQueryResult,
  PortfolioHistoryQueryResult,
  EnrichedSnapshotQueryResult,
  RefreshPositionsMutationResult,
  RefreshPositionsVariables,
  AddManualPositionMutationResult,
  AddManualPositionVariables,
} from '../types.js';

/** Full portfolio snapshot with positions, totals, and P&L. */
export function usePortfolio() {
  return useQuery<PortfolioQueryResult>({ query: PORTFOLIO_QUERY });
}

/** Flat list of all positions across platforms. */
export function usePositions() {
  return useQuery<PositionsQueryResult>({ query: POSITIONS_QUERY });
}

/** Historical portfolio snapshots for charting total value, P&L over time. */
export function usePortfolioHistory() {
  return useQuery<PortfolioHistoryQueryResult>({ query: PORTFOLIO_HISTORY_QUERY });
}

/** Enriched snapshot — positions augmented with sentiment, analyst data, fundamentals. */
export function useEnrichedSnapshot() {
  return useQuery<EnrichedSnapshotQueryResult>({ query: ENRICHED_SNAPSHOT_QUERY });
}

/** Trigger a position refresh from a specific brokerage platform. */
export function useRefreshPositions() {
  return useMutation<RefreshPositionsMutationResult, RefreshPositionsVariables>(REFRESH_POSITIONS_MUTATION);
}

/** Add a manual position to the portfolio. */
export function useAddManualPosition() {
  return useMutation<AddManualPositionMutationResult, AddManualPositionVariables>(ADD_MANUAL_POSITION_MUTATION);
}
