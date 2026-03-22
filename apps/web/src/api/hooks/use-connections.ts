import { useQuery, useMutation, useSubscription } from 'urql';

import {
  LIST_CONNECTIONS_QUERY,
  DETECT_AVAILABLE_TIERS_QUERY,
  CONNECT_PLATFORM_MUTATION,
  DISCONNECT_PLATFORM_MUTATION,
  ON_CONNECTION_STATUS_SUBSCRIPTION,
} from '../documents.js';
import type {
  ListConnectionsQueryResult,
  DetectAvailableTiersQueryResult,
  DetectAvailableTiersVariables,
  ConnectPlatformMutationResult,
  ConnectPlatformVariables,
  DisconnectPlatformMutationResult,
  DisconnectPlatformVariables,
  OnConnectionStatusSubscriptionResult,
  OnConnectionStatusVariables,
} from '../types.js';

/** All platform connections. */
export function useListConnections() {
  return useQuery<ListConnectionsQueryResult>({ query: LIST_CONNECTIONS_QUERY });
}

/** Available integration tiers for a given platform. */
export function useDetectAvailableTiers(platform: string) {
  return useQuery<DetectAvailableTiersQueryResult, DetectAvailableTiersVariables>({
    query: DETECT_AVAILABLE_TIERS_QUERY,
    variables: { platform },
    pause: !platform,
  });
}

/** Connect a platform (optionally with a specific tier). */
export function useConnectPlatform() {
  return useMutation<ConnectPlatformMutationResult, ConnectPlatformVariables>(CONNECT_PLATFORM_MUTATION);
}

/** Disconnect a platform. */
export function useDisconnectPlatform() {
  return useMutation<DisconnectPlatformMutationResult, DisconnectPlatformVariables>(DISCONNECT_PLATFORM_MUTATION);
}

/** Subscribe to connection status events for a platform. */
export function useOnConnectionStatus(platform: string) {
  return useSubscription<OnConnectionStatusSubscriptionResult, OnConnectionStatusVariables>({
    query: ON_CONNECTION_STATUS_SUBSCRIPTION,
    variables: { platform },
    pause: !platform,
  });
}
