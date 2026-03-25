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
    AlertRule: () => null, // embedded, not an entity
    SectorWeight: () => null,
    Concentration: () => null,
    CorrelationCluster: () => null,
    PriceEvent: () => null,
    SessionSummary: (data) => data.id as string,
    SessionDetail: (data) => data.id as string,
  },
  updates: {
    Mutation: {
      refreshPositions(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'positions');
        cache.invalidate('Query', 'enrichedSnapshot');
      },
      addManualPosition(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'positions');
        cache.invalidate('Query', 'enrichedSnapshot');
      },
      confirmPositions(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'positions');
        cache.invalidate('Query', 'portfolioHistory');
        cache.invalidate('Query', 'enrichedSnapshot');
      },
      completeOnboarding(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'positions');
        cache.invalidate('Query', 'portfolioHistory');
        cache.invalidate('Query', 'enrichedSnapshot');
        cache.invalidate('Query', 'listConnections');
      },
      editPosition(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'positions');
        cache.invalidate('Query', 'enrichedSnapshot');
      },
      removePosition(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'positions');
        cache.invalidate('Query', 'enrichedSnapshot');
      },
      processInsights(_result, _args, cache) {
        cache.invalidate('Query', 'signals');
        cache.invalidate('Query', 'latestInsightReport');
        cache.invalidate('Query', 'insightReports');
      },
      fetchDataSource(_result, _args, cache) {
        cache.invalidate('Query', 'signals');
      },
      createAlert(_result, _args, cache) {
        cache.invalidate('Query', 'alerts');
      },
      dismissAlert(_result, _args, cache) {
        cache.invalidate('Query', 'alerts');
      },
      createSession(_result, _args, cache) {
        cache.invalidate('Query', 'sessions');
      },
      deleteSession(_result, _args, cache) {
        cache.invalidate('Query', 'sessions');
      },
      clearAppData(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'positions');
        cache.invalidate('Query', 'portfolioHistory');
        cache.invalidate('Query', 'enrichedSnapshot');
        cache.invalidate('Query', 'riskReport');
        cache.invalidate('Query', 'alerts');
        cache.invalidate('Query', 'signals');
        cache.invalidate('Query', 'sessions');
        cache.invalidate('Query', 'latestInsightReport');
        cache.invalidate('Query', 'insightReports');
        cache.invalidate('Query', 'watchlist');
        cache.invalidate('Query', 'deviceInfo');
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
