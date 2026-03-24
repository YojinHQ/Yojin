import { useQuery, useMutation } from 'urql';

import { WATCHLIST_QUERY, ADD_TO_WATCHLIST_MUTATION, REMOVE_FROM_WATCHLIST_MUTATION } from '../documents.js';
import type {
  WatchlistQueryResult,
  AddToWatchlistMutationResult,
  AddToWatchlistVariables,
  RemoveFromWatchlistMutationResult,
  RemoveFromWatchlistVariables,
} from '../types.js';

/** All watchlist entries. */
export function useWatchlist() {
  return useQuery<WatchlistQueryResult>({ query: WATCHLIST_QUERY });
}

/** Add a symbol to the watchlist. */
export function useAddToWatchlist() {
  return useMutation<AddToWatchlistMutationResult, AddToWatchlistVariables>(ADD_TO_WATCHLIST_MUTATION);
}

/** Remove a symbol from the watchlist. */
export function useRemoveFromWatchlist() {
  return useMutation<RemoveFromWatchlistMutationResult, RemoveFromWatchlistVariables>(REMOVE_FROM_WATCHLIST_MUTATION);
}
