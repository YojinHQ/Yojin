import { Client, fetchExchange, subscriptionExchange } from 'urql';
import { cacheExchange } from '@urql/exchange-graphcache';
import { createClient as createSSEClient } from 'graphql-sse';

const graphqlUrl = (import.meta.env.VITE_GRAPHQL_URL as string | undefined) ?? '/graphql';

const sseClient = createSSEClient({
  url: graphqlUrl,
});

/**
 * Normalized cache configuration.
 *
 * graphcache stores entities by __typename + key, so the same Position
 * referenced by multiple queries stays in sync automatically.
 *
 * Key resolution:
 * - Most types use `id` (default).
 * - Position / EnrichedPosition are keyed by `symbol` (no `id` field).
 * - SectorWeight, Concentration, CorrelationCluster are embedded values (no key).
 *
 * Cache updates:
 * - refreshPositions → invalidates portfolio + positions queries.
 * - createAlert / dismissAlert → updates the alerts list.
 */
const cache = cacheExchange({
  keys: {
    Position: (data) => `${data.symbol as string}:${data.platform as string}`,
    EnrichedPosition: (data) => `${data.symbol as string}:${data.platform as string}`,
    Connection: (data) => data.platform as string,
    AlertRule: () => null, // embedded, not an entity
    SectorWeight: () => null,
    Concentration: () => null,
    CorrelationCluster: () => null,
    PriceEvent: () => null,
    TierAvailability: () => null,
    ConnectionResult: () => null,
    ConnectionEvent: () => null,
  },
  updates: {
    Mutation: {
      refreshPositions(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'positions');
        cache.invalidate('Query', 'enrichedSnapshot');
        cache.invalidate('Query', 'listConnections');
      },
      addManualPosition(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'positions');
        cache.invalidate('Query', 'enrichedSnapshot');
      },
      createAlert(_result, _args, cache) {
        cache.invalidate('Query', 'alerts');
      },
      dismissAlert(_result, _args, cache) {
        cache.invalidate('Query', 'alerts');
      },
      connectPlatform(result: { connectPlatform?: { success?: boolean } }, _args, cache) {
        if (result.connectPlatform?.success) {
          cache.invalidate('Query', 'listConnections');
        }
      },
      disconnectPlatform(result: { disconnectPlatform?: { success?: boolean } }, _args, cache) {
        if (result.disconnectPlatform?.success) {
          cache.invalidate('Query', 'listConnections');
        }
      },
    },
  },
});

/**
 * Exchange pipeline (order matters):
 *
 * 1. cache          — normalized graphcache, deduplicates in-flight requests
 * 2. fetch          — HTTP transport
 * 3. subscription   — SSE transport for real-time streaming
 */
export const graphqlClient = new Client({
  url: graphqlUrl,
  exchanges: [
    cache,
    fetchExchange,
    subscriptionExchange({
      forwardSubscription(request) {
        return {
          subscribe(sink) {
            const unsubscribe = sseClient.subscribe({ ...request, query: request.query ?? '' }, sink);
            return { unsubscribe };
          },
        };
      },
    }),
  ],
});
