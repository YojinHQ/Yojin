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
    AssetSnap: () => null, // embedded — nested under Snap
    MicroInsight: (data) => data.id as string,
    Summary: (data) => data.id as string,
    SummarySourceSignal: () => null, // embedded — nested under Summary
    Action: (data) => data.id as string,
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
    Strategy: (data) => data.id as string,
    StrategyTrigger: () => null, // embedded — nested under Strategy
    TriggerGroup: () => null, // embedded — nested under Strategy
    StrategySource: (data) => data.id as string,
    StrategySyncResult: () => null, // embedded — mutation result
    SymbolSearchResult: () => null, // embedded — search result, no stable identity
    WatchlistEntry: () => null, // embedded — nested under watchlist query array
    KeychainTokenResult: () => null, // query result — singleton per provider
    BriefingConfig: () => null, // singleton — no id field
    SchedulerStatus: () => null, // singleton — no id field
    SchedulerAssetStatus: () => null, // embedded — keyed by symbol+source in parent
    DeepAnalysisEvent: () => null, // subscription event — no stable identity
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
      addToWatchlist(_result, _args, cache) {
        cache.invalidate('Query', 'watchlist');
        cache.invalidate('Query', 'curatedSignals');
      },
      removeFromWatchlist(_result, _args, cache) {
        cache.invalidate('Query', 'watchlist');
        cache.invalidate('Query', 'curatedSignals');
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
      createStrategy(_result, _args, cache) {
        cache.invalidate('Query', 'strategies');
      },
      updateStrategy(_result, _args, cache) {
        cache.invalidate('Query', 'strategies');
      },
      deleteStrategy(_result, _args, cache) {
        cache.invalidate('Query', 'strategies');
      },
      importStrategy(_result, _args, cache) {
        cache.invalidate('Query', 'strategies');
      },
      toggleStrategy(_result, _args, cache) {
        cache.invalidate('Query', 'strategies');
      },
      addStrategySource(_result, _args, cache) {
        cache.invalidate('Query', 'strategySources');
        cache.invalidate('Query', 'strategies');
      },
      removeStrategySource(_result, _args, cache) {
        cache.invalidate('Query', 'strategySources');
      },
      toggleStrategySource(_result, _args, cache) {
        cache.invalidate('Query', 'strategySources');
      },
      syncStrategies(_result, _args, cache) {
        cache.invalidate('Query', 'strategySources');
        cache.invalidate('Query', 'strategies');
      },
      syncStrategySource(_result, _args, cache) {
        cache.invalidate('Query', 'strategySources');
        cache.invalidate('Query', 'strategies');
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
        cache.invalidate('Query', 'summaries');
        cache.invalidate('Query', 'actions');
      },
      approveAction(_result, _args, cache) {
        cache.invalidate('Query', 'actions');
      },
      rejectAction(_result, _args, cache) {
        cache.invalidate('Query', 'actions');
      },
      dismissAction(_result, _args, cache) {
        cache.invalidate('Query', 'actions');
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
