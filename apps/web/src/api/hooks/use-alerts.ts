import { useQuery, useMutation, useSubscription } from 'urql';

import { ALERTS_QUERY, DISMISS_ALERT_MUTATION, ON_ALERT_SUBSCRIPTION } from '../documents.js';
import type {
  AlertsQueryResult,
  AlertsQueryVariables,
  DismissAlertMutationResult,
  DismissAlertVariables,
  OnAlertSubscriptionResult,
  Alert,
} from '../types.js';

/** Fetch alerts, optionally filtered by status. */
export function useAlerts(variables?: AlertsQueryVariables) {
  return useQuery<AlertsQueryResult, AlertsQueryVariables>({
    query: ALERTS_QUERY,
    variables: variables ?? {},
  });
}

/** Dismiss an existing alert by ID. */
export function useDismissAlert() {
  return useMutation<DismissAlertMutationResult, DismissAlertVariables>(DISMISS_ALERT_MUTATION);
}

/**
 * Subscribe to real-time alert events.
 *
 * Accumulates alerts into an array via the reducer so components can render
 * a live-updating feed. Pass your own handler to customize accumulation.
 */
export function useOnAlert(handler?: (alerts: Alert[], newAlert: Alert) => Alert[]) {
  const defaultHandler = (prev: Alert[] = [], response: OnAlertSubscriptionResult): Alert[] => [
    response.onAlert,
    ...prev,
  ];

  const customHandler = handler
    ? (prev: Alert[] = [], response: OnAlertSubscriptionResult): Alert[] => handler(prev, response.onAlert)
    : defaultHandler;

  return useSubscription<OnAlertSubscriptionResult, Alert[]>({ query: ON_ALERT_SUBSCRIPTION }, customHandler);
}
