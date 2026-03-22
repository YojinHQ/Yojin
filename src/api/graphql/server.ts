/**
 * GraphQL server — graphql-yoga mounted on Hono.
 *
 * Creates the yoga instance and exports a function to mount it on a Hono app.
 */

import { createSchema, createYoga } from 'graphql-yoga';
import type { Hono } from 'hono';

import { alertsQuery, createAlertMutation, dismissAlertMutation } from './resolvers/alerts.js';
import { onChatMessageSubscription, sendMessageMutation } from './resolvers/chat.js';
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
import { onAlertSubscription, onPortfolioUpdateSubscription, onPriceMoveSubscription } from './resolvers/live.js';
import { newsQuery, quoteQuery, sectorExposureQuery } from './resolvers/market.js';
import {
  completeMagicLinkMutation,
  completeOnboardingMutation,
  confirmPersonaMutation,
  confirmPositionsMutation,
  detectAiCredentialQuery,
  generatePersonaMutation,
  onboardingStatusQuery,
  parsePortfolioScreenshotMutation,
  resetOnboardingMutation,
  saveBriefingConfigMutation,
  sendMagicLinkMutation,
  validateAiCredentialMutation,
} from './resolvers/onboarding.js';
import {
  addManualPositionMutation,
  enrichedSnapshotQuery,
  portfolioHistoryQuery,
  portfolioQuery,
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
      onboardingStatus: onboardingStatusQuery,
    },
    Mutation: {
      refreshPositions: refreshPositionsMutation,
      addManualPosition: addManualPositionMutation,
      createAlert: createAlertMutation,
      dismissAlert: dismissAlertMutation,
      sendMessage: sendMessageMutation,
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
      sendMagicLink: sendMagicLinkMutation,
      completeMagicLink: completeMagicLinkMutation,
      generatePersona: generatePersonaMutation,
      confirmPersona: confirmPersonaMutation,
      parsePortfolioScreenshot: parsePortfolioScreenshotMutation,
      confirmPositions: confirmPositionsMutation,
      saveBriefingConfig: saveBriefingConfigMutation,
      completeOnboarding: completeOnboardingMutation,
      resetOnboarding: resetOnboardingMutation,
    },
    Subscription: {
      onAlert: onAlertSubscription,
      onPortfolioUpdate: onPortfolioUpdateSubscription,
      onPriceMove: onPriceMoveSubscription,
      onChatMessage: onChatMessageSubscription,
      onConnectionStatus: onConnectionStatusSubscription,
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
