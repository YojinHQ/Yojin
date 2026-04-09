import { useMutation, useQuery } from 'urql';

import { ACTIONS_QUERY, APPROVE_ACTION_MUTATION, REJECT_ACTION_MUTATION } from '../documents.js';
import type {
  ActionsQueryResult,
  ActionsQueryVariables,
  ApproveActionMutationResult,
  ApproveActionVariables,
  RejectActionMutationResult,
  RejectActionVariables,
} from '../types.js';

/**
 * Fetch actions (severity-ranked TLDR of the signal pipeline).
 *
 * Defaults to PENDING only — these are the items currently vying for the
 * user's attention. Uses `cache-and-network` so the UI paints from cache
 * immediately, then reconciles against the server on each poll cycle.
 */
export function useActions(variables?: ActionsQueryVariables & { pause?: boolean }) {
  const { pause, ...rest } = variables ?? {};
  const queryVars: ActionsQueryVariables =
    Object.keys(rest).length > 0 ? (rest as ActionsQueryVariables) : { status: 'PENDING', limit: 50 };
  return useQuery<ActionsQueryResult, ActionsQueryVariables>({
    query: ACTIONS_QUERY,
    variables: queryVars,
    requestPolicy: 'cache-and-network',
    pause,
  });
}

export function useApproveAction() {
  return useMutation<ApproveActionMutationResult, ApproveActionVariables>(APPROVE_ACTION_MUTATION);
}

export function useRejectAction() {
  return useMutation<RejectActionMutationResult, RejectActionVariables>(REJECT_ACTION_MUTATION);
}
