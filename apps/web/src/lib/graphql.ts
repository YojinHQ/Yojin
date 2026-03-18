import { Client, fetchExchange } from 'urql';
import { cacheExchange } from '@urql/exchange-graphcache';

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
    Position: (data) => data.symbol as string,
    EnrichedPosition: (data) => data.symbol as string,
    AlertRule: () => null, // embedded, not an entity
    SectorWeight: () => null,
    Concentration: () => null,
    CorrelationCluster: () => null,
    PriceEvent: () => null,
  },
  updates: {
    Mutation: {
      refreshPositions(_result, _args, cache) {
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
    },
  },
});

/**
 * Exchange pipeline (order matters):
 *
 * 1. cache  — normalized cache, deduplicates in-flight requests
 * 2. fetch  — HTTP transport
 *
 * To extend later:
 * - Insert `retryExchange` before fetch for transient failure resilience
 * - Insert `subscriptionExchange` (SSE) after fetch for real-time data
 * - Insert `authExchange` before fetch for token management
 */
export const graphqlClient = new Client({
  url: import.meta.env.VITE_GRAPHQL_URL ?? '/graphql',
  exchanges: [cache, fetchExchange],
});
