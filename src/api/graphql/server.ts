/**
 * GraphQL server — graphql-yoga mounted on Hono.
 *
 * Creates the yoga instance and exports a function to mount it on a Hono app.
 */

import { createSchema, createYoga } from 'graphql-yoga';
import type { Hono } from 'hono';

import { alertsQuery, createAlertMutation, dismissAlertMutation } from './resolvers/alerts.js';
import {
  activeSessionQuery,
  createSessionMutation,
  deleteSessionMutation,
  onChatMessageSubscription,
  sendMessageMutation,
  sessionQuery,
  sessionsQuery,
} from './resolvers/chat.js';
import {
  connectPlatformResolver,
  detectAvailableTiersResolver,
  disconnectPlatformResolver,
  listConnectionsResolver,
  onConnectionStatusSubscription,
} from './resolvers/connections.js';
import {
  addDataSourceResolver,
  checkCliCommandsResolver,
  checkDataSourceHealthResolver,
  listDataSourcesResolver,
  removeDataSourceResolver,
  toggleDataSourceResolver,
} from './resolvers/data-sources.js';
import { fetchDataSourceResolver } from './resolvers/fetch-data-source.js';
import {
  getInsightsWorkflowStatus,
  insightReportQuery,
  insightReportsQuery,
  latestInsightReportQuery,
  processInsightsMutation,
} from './resolvers/insights.js';
import {
  onAlertSubscription,
  onPortfolioUpdateSubscription,
  onPriceMoveSubscription,
  onWorkflowProgressSubscription,
} from './resolvers/live.js';
import { newsQuery, quoteQuery, sectorExposureQuery } from './resolvers/market.js';
import {
  completeMagicLinkMutation,
  completeOAuthFlowMutation,
  completeOnboardingMutation,
  confirmPersonaMutation,
  confirmPositionsMutation,
  detectAiCredentialQuery,
  detectKeychainTokenQuery,
  generatePersonaMutation,
  onboardingStatusQuery,
  parsePortfolioScreenshotMutation,
  resetOnboardingMutation,
  saveBriefingConfigMutation,
  sendMagicLinkMutation,
  startOAuthFlowMutation,
  validateAiCredentialMutation,
  validateJintelKeyMutation,
} from './resolvers/onboarding.js';
import {
  addManualPositionMutation,
  enrichedSnapshotQuery,
  portfolioHistoryQuery,
  portfolioQuery,
  positionFieldResolvers,
  positionsQuery,
  refreshPositionsMutation,
} from './resolvers/portfolio.js';
import { deviceInfoResolver } from './resolvers/profile.js';
import { riskReportQuery } from './resolvers/risk.js';
import { signalsResolver } from './resolvers/signals.js';
import {
  addVaultSecretMutation,
  changeVaultPassphraseMutation,
  deleteVaultSecretMutation,
  listVaultSecretsQuery,
  setVaultPassphraseMutation,
  unlockVaultMutation,
  updateVaultSecretMutation,
  vaultStatusQuery,
} from './resolvers/vault.js';
import { addToWatchlistMutation, removeFromWatchlistMutation, watchlistQuery } from './resolvers/watchlist.js';
import { typeDefs } from './schema.js';

const schema = createSchema({
  typeDefs,
  resolvers: {
    Query: {
      portfolio: portfolioQuery,
      positions: positionsQuery,
      portfolioHistory: portfolioHistoryQuery,
      enrichedSnapshot: enrichedSnapshotQuery,
      riskReport: riskReportQuery,
      alerts: alertsQuery,
      news: newsQuery,
      quote: quoteQuery,
      sectorExposure: sectorExposureQuery,
      listDataSources: listDataSourcesResolver,
      checkDataSourceHealth: checkDataSourceHealthResolver,
      checkCliCommands: checkCliCommandsResolver,
      signals: signalsResolver,
      listConnections: listConnectionsResolver,
      detectAvailableTiers: detectAvailableTiersResolver,
      deviceInfo: deviceInfoResolver,
      vaultStatus: vaultStatusQuery,
      listVaultSecrets: listVaultSecretsQuery,
      detectAiCredential: detectAiCredentialQuery,
      detectKeychainToken: detectKeychainTokenQuery,
      onboardingStatus: onboardingStatusQuery,
      sessions: sessionsQuery,
      session: sessionQuery,
      activeSession: activeSessionQuery,
      latestInsightReport: latestInsightReportQuery,
      insightReports: insightReportsQuery,
      insightReport: insightReportQuery,
      watchlist: watchlistQuery,
      insightsWorkflowStatus: () => getInsightsWorkflowStatus(),
    },
    Position: positionFieldResolvers,
    Mutation: {
      refreshPositions: refreshPositionsMutation,
      addManualPosition: addManualPositionMutation,
      createAlert: createAlertMutation,
      dismissAlert: dismissAlertMutation,
      sendMessage: sendMessageMutation,
      createSession: createSessionMutation,
      deleteSession: deleteSessionMutation,
      fetchDataSource: fetchDataSourceResolver,
      addDataSource: addDataSourceResolver,
      removeDataSource: removeDataSourceResolver,
      toggleDataSource: toggleDataSourceResolver,
      connectPlatform: connectPlatformResolver,
      disconnectPlatform: disconnectPlatformResolver,
      unlockVault: unlockVaultMutation,
      setVaultPassphrase: setVaultPassphraseMutation,
      changeVaultPassphrase: changeVaultPassphraseMutation,
      addVaultSecret: addVaultSecretMutation,
      updateVaultSecret: updateVaultSecretMutation,
      deleteVaultSecret: deleteVaultSecretMutation,
      validateAiCredential: validateAiCredentialMutation,
      startOAuthFlow: startOAuthFlowMutation,
      completeOAuthFlow: completeOAuthFlowMutation,
      sendMagicLink: sendMagicLinkMutation,
      completeMagicLink: completeMagicLinkMutation,
      generatePersona: generatePersonaMutation,
      confirmPersona: confirmPersonaMutation,
      parsePortfolioScreenshot: parsePortfolioScreenshotMutation,
      confirmPositions: confirmPositionsMutation,
      saveBriefingConfig: saveBriefingConfigMutation,
      completeOnboarding: completeOnboardingMutation,
      resetOnboarding: resetOnboardingMutation,
      validateJintelKey: validateJintelKeyMutation,
      processInsights: processInsightsMutation,
      addToWatchlist: addToWatchlistMutation,
      removeFromWatchlist: removeFromWatchlistMutation,
    },
    Subscription: {
      onAlert: onAlertSubscription,
      onPortfolioUpdate: onPortfolioUpdateSubscription,
      onPriceMove: onPriceMoveSubscription,
      onChatMessage: onChatMessageSubscription,
      onConnectionStatus: onConnectionStatusSubscription,
      onWorkflowProgress: onWorkflowProgressSubscription,
    },
  },
});

const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  graphiql: process.env.NODE_ENV !== 'production',
  // CORS handled by Hono middleware in the web channel — no duplicate headers
  cors: false,
});

/**
 * Mount the GraphQL yoga handler on a Hono app.
 */
export function mountGraphQL(app: Hono): void {
  app.on(['GET', 'POST', 'OPTIONS'], '/graphql', async (c) => {
    const response = await yoga.handle(c.req.raw, {});
    return response;
  });
}

export { schema, yoga };
