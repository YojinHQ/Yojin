/**
 * Hook wrapping the `expandSupplyChainGraph` mutation.
 *
 * Exposes a light API so callers (like the graph component) don't have to know
 * about urql internals:
 *   - `expand(sourceNodeId, direction)` → fires the mutation
 *   - `expanding` → true while the mutation is in flight
 *   - `error` → error message or null
 *   - `lastExpansion` → most recent non-null result, for callers that prefer
 *     pulling the result via a ref rather than the promise return.
 *
 * The mutation's Promise never rejects (urql quirk) — errors arrive on
 * `result.error`. We normalize that into a thrown-style shape so callers can
 * `try/catch` if they prefer, while also exposing it via the return type.
 */

import { useCallback, useMemo, useState } from 'react';
import { useMutation } from 'urql';

import { EXPAND_SUPPLY_CHAIN_GRAPH_MUTATION } from '../api/documents.js';
import type {
  ExpandSupplyChainGraphMutationResult,
  ExpandSupplyChainGraphVariables,
  SupplyChainDirection,
  SupplyChainExpansion,
} from '../api/types.js';

export interface UseSupplyChainExpansionResult {
  expand: (
    sourceNodeId: string,
    direction: SupplyChainDirection,
    requestedTicker: string,
    options?: { hopDepth?: number; force?: boolean },
  ) => Promise<SupplyChainExpansion | null>;
  expanding: boolean;
  error: string | null;
  lastExpansion: SupplyChainExpansion | null;
}

export function useSupplyChainExpansion(): UseSupplyChainExpansionResult {
  const [{ fetching }, executeMutation] = useMutation<
    ExpandSupplyChainGraphMutationResult,
    ExpandSupplyChainGraphVariables
  >(EXPAND_SUPPLY_CHAIN_GRAPH_MUTATION);

  const [error, setError] = useState<string | null>(null);
  const [lastExpansion, setLastExpansion] = useState<SupplyChainExpansion | null>(null);

  const expand = useCallback(
    async (
      sourceNodeId: string,
      direction: SupplyChainDirection,
      requestedTicker: string,
      options?: { hopDepth?: number; force?: boolean },
    ): Promise<SupplyChainExpansion | null> => {
      setError(null);
      const result = await executeMutation({
        input: {
          sourceNodeId,
          direction,
          requestedTicker,
          ...(options?.hopDepth !== undefined ? { hopDepth: options.hopDepth } : {}),
          ...(options?.force !== undefined ? { force: options.force } : {}),
        },
      });
      // urql's `useMutation` never rejects — check result.error.
      if (result.error) {
        setError(result.error.message);
        return null;
      }
      const expansion = result.data?.expandSupplyChainGraph ?? null;
      if (expansion) setLastExpansion(expansion);
      return expansion;
    },
    [executeMutation],
  );

  return useMemo(
    () => ({ expand, expanding: fetching, error, lastExpansion }),
    [expand, fetching, error, lastExpansion],
  );
}
