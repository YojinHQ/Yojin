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
 * - Position is keyed by `symbol:platform` (no `id` field).
 * - SectorWeight, Concentration, CorrelationCluster are embedded values (no key).
 *
 * Cache updates:
 * - refreshPositions → invalidates portfolio + positions queries.
 * - createAlert / dismissAlert → updates the alerts list.
 */
const cache = cacheExchange({
  keys: {
    Position: (data) => `${data.symbol as string}:${data.platform as string}`,
    AlertRule: () => null, // embedded, not an entity
    PortfolioHistoryPoint: () => null, // embedded — nested under PortfolioSnapshot
    SectorWeight: () => null,
    Concentration: () => null,
    CorrelationCluster: () => null,
    PriceEvent: () => null,
    SignalSource: () => null, // embedded — same source id appears on many signals
    CuratedSignal: () => null, // embedded — wraps Signal with scores
    CuratedSignalAssessment: () => null, // embedded — nested under CuratedSignal
    PortfolioRelevanceScore: () => null, // embedded
    AiConfig: () => null, // singleton — no id field
    SaveAiCredentialResult: () => null, // mutation response — no id field
    OnboardingStatusResult: () => null, // singleton — no id field
    WorkflowStatus: () => null, // embedded — singleton status object
    PositionInsight: () => null, // embedded — nested under InsightReport
    SignalSummary: () => null, // embedded — nested under PositionInsight
    PortfolioInsight: () => null, // embedded — nested under InsightReport
    PortfolioItem: () => null, // embedded — nested under PortfolioInsight
    SnapActionItem: () => null, // embedded — nested under Snap
    AssetSnap: () => null, // embedded — nested under Snap
    MicroInsight: (data) => data.id as string,
    EmotionState: () => null, // embedded — nested under InsightReport
    RefreshIntelFeedResult: () => null, // embedded — mutation result
    TickerProfileEntry: (data) => data.id as string,
    TickerProfile: (data) => data.ticker as string,
    TickerProfileBrief: () => null, // embedded — nested under TickerProfile
    SentimentPoint: () => null, // embedded — nested under TickerProfileBrief
    PricePoint: () => null, // embedded — nested under TickerPriceHistory
    TickerPriceHistory: () => null, // embedded — keyed by ticker in array
    Channel: (data) => data.id as string,
    NotificationPreferences: (data) => data.channelId as string,
    ChannelResult: () => null, // embedded — mutation result, no stable identity
    PairingResult: () => null,
    PairingEvent: () => null,
    SessionSummary: (data) => data.id as string,
    SessionDetail: (data) => data.id as string,
    Skill: (data) => data.id as string,
    SkillTrigger: () => null, // embedded — nested under Skill
  },
  updates: {
    Mutation: {
      refreshPositions(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
      },
      addManualPosition(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'signals');
        cache.invalidate('Query', 'curatedSignals');
      },
      confirmPositions(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'signals');
        cache.invalidate('Query', 'curatedSignals');
      },
      validateJintelKey(_result, _args, cache) {
        cache.invalidate('Query', 'onboardingStatus');
      },
      completeOnboarding(_result, _args, cache) {
        cache.invalidate('Query', 'onboardingStatus');
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'listConnections');
        cache.invalidate('Query', 'signals');
        cache.invalidate('Query', 'curatedSignals');
      },
      editPosition(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'signals');
        cache.invalidate('Query', 'curatedSignals');
      },
      removePosition(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'signals');
        cache.invalidate('Query', 'curatedSignals');
      },
      processInsights(_result, _args, cache) {
        cache.invalidate('Query', 'signals');
        cache.invalidate('Query', 'latestInsightReport');
        cache.invalidate('Query', 'insightReports');
      },
      fetchDataSource(_result, _args, cache) {
        cache.invalidate('Query', 'signals');
        cache.invalidate('Query', 'curatedSignals');
      },
      runFullCuration(_result, _args, cache) {
        cache.invalidate('Query', 'signals');
        cache.invalidate('Query', 'curatedSignals');
      },
      connectChannel(_result, _args, cache) {
        cache.invalidate('Query', 'listChannels');
      },
      initiateChannelPairing(_result, _args, cache) {
        cache.invalidate('Query', 'listChannels');
      },
      disconnectChannel(_result, _args, cache) {
        cache.invalidate('Query', 'listChannels');
      },
      saveNotificationPreferences(_result, _args, cache) {
        cache.invalidate('Query', 'notificationPreferences');
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
      resetOnboarding(_result, _args, cache) {
        cache.invalidate('Query', 'onboardingStatus');
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'briefingConfig');
        cache.invalidate('Query', 'listConnections');
        cache.invalidate('Query', 'signals');
        cache.invalidate('Query', 'curatedSignals');
      },
      clearAppData(_result, _args, cache) {
        cache.invalidate('Query', 'portfolio');
        cache.invalidate('Query', 'riskReport');
        cache.invalidate('Query', 'alerts');
        cache.invalidate('Query', 'signals');
        cache.invalidate('Query', 'curatedSignals');
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
