import { useEffect } from 'react';
import { useQuery, useMutation, useSubscription } from 'urql';

import {
  PORTFOLIO_QUERY,
  REFRESH_POSITIONS_MUTATION,
  ADD_MANUAL_POSITION_MUTATION,
  EDIT_POSITION_MUTATION,
  REMOVE_POSITION_MUTATION,
  ON_PORTFOLIO_UPDATE_SUBSCRIPTION,
} from '../documents.js';
import type {
  PortfolioQueryResult,
  PortfolioQueryVariables,
  RefreshPositionsMutationResult,
  RefreshPositionsVariables,
  AddManualPositionMutationResult,
  AddManualPositionVariables,
  EditPositionMutationResult,
  EditPositionVariables,
  RemovePositionMutationResult,
  RemovePositionVariables,
} from '../types.js';

/** Full portfolio snapshot with positions, history, sector exposure, and P&L. */
export function usePortfolio(variables?: PortfolioQueryVariables, opts?: { pollInterval?: number }) {
  const [result, reexecute] = useQuery<PortfolioQueryResult, PortfolioQueryVariables>({
    query: PORTFOLIO_QUERY,
    variables,
    requestPolicy: 'cache-and-network',
  });

  // Re-fetch when portfolio is updated from any source (chat, scraper, etc.)
  const [subResult] = useSubscription({ query: ON_PORTFOLIO_UPDATE_SUBSCRIPTION });
  useEffect(() => {
    if (subResult.data) {
      reexecute({ requestPolicy: 'network-only' });
    }
  }, [subResult.data, reexecute]);

  useEffect(() => {
    if (!opts?.pollInterval) return;
    const id = setInterval(() => reexecute({ requestPolicy: 'network-only' }), opts.pollInterval);
    return () => clearInterval(id);
  }, [opts?.pollInterval, reexecute]);

  return [result, reexecute] as const;
}

/** Trigger a position refresh from a specific brokerage platform. */
export function useRefreshPositions() {
  return useMutation<RefreshPositionsMutationResult, RefreshPositionsVariables>(REFRESH_POSITIONS_MUTATION);
}

/** Add a manual position to the portfolio. */
export function useAddManualPosition() {
  return useMutation<AddManualPositionMutationResult, AddManualPositionVariables>(ADD_MANUAL_POSITION_MUTATION);
}

/** Edit an existing position in the portfolio. */
export function useEditPosition() {
  return useMutation<EditPositionMutationResult, EditPositionVariables>(EDIT_POSITION_MUTATION);
}

/** Remove a position from the portfolio. */
export function useRemovePosition() {
  return useMutation<RemovePositionMutationResult, RemovePositionVariables>(REMOVE_POSITION_MUTATION);
}
