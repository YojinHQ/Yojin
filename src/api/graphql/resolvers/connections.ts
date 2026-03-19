/**
 * Connection resolvers — listConnections, detectAvailableTiers,
 * connectPlatform, disconnectPlatform, onConnectionStatus.
 *
 * Module-level state pattern: setConnectionManager is called once during
 * server startup to inject the ConnectionManager instance.
 */

import type { ConnectionManager } from '../../../scraper/connection-manager.js';
import type { Connection, ConnectionResult, IntegrationTier, TierAvailability } from '../../../scraper/types.js';
import { pubsub } from '../pubsub.js';
import type { Platform } from '../types.js';

let connectionManager: ConnectionManager | undefined;

/** Called once during server startup to inject the manager. */
export function setConnectionManager(manager: ConnectionManager): void {
  connectionManager = manager;
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function listConnectionsResolver(): Promise<Connection[]> {
  if (!connectionManager) return [];
  return connectionManager.listConnections();
}

export async function detectAvailableTiersResolver(
  _parent: unknown,
  args: { platform: Platform },
): Promise<TierAvailability[]> {
  if (!connectionManager) throw new Error('ConnectionManager not initialized');
  return connectionManager.detectAvailableTiers(args.platform);
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

export async function connectPlatformResolver(
  _parent: unknown,
  args: { input: { platform: Platform; tier?: IntegrationTier } },
): Promise<ConnectionResult> {
  if (!connectionManager) throw new Error('ConnectionManager not initialized');
  const { platform, tier } = args.input;
  return connectionManager.connectPlatform({ platform, tier });
}

export async function disconnectPlatformResolver(
  _parent: unknown,
  args: { platform: Platform; removeCredentials?: boolean },
): Promise<ConnectionResult> {
  if (!connectionManager) throw new Error('ConnectionManager not initialized');
  return connectionManager.disconnectPlatform(args.platform, { removeCredentials: args.removeCredentials ?? false });
}

// ---------------------------------------------------------------------------
// Subscription resolver
// ---------------------------------------------------------------------------

export const onConnectionStatusSubscription = {
  subscribe: (_parent: unknown, args: { platform: Platform }) => {
    return pubsub.subscribe(`connectionStatus:${args.platform}` as `connectionStatus:${string}`);
  },
  resolve: (payload: unknown) => payload,
};
