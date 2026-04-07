/**
 * GraphQL server — graphql-yoga mounted on Hono.
 *
 * Creates the yoga instance and exports a function to mount it on a Hono app.
 */

import { createSchema, createYoga } from 'graphql-yoga';
import type { Hono } from 'hono';

import { actionResolver, actionsResolver, approveActionMutation, rejectActionMutation } from './resolvers/actions.js';
import { activityLogQuery } from './resolvers/activity-log.js';
import {
  aiConfigQuery,
  removeAiCredentialMutation,
  saveAiConfigMutation,
  saveAiCredentialMutation,
} from './resolvers/ai-config.js';
import { alertsQuery, createAlertMutation, dismissAlertMutation } from './resolvers/alerts.js';
import {
  cancelChannelPairingMutation,
  connectChannelMutation,
  disconnectChannelMutation,
  initiateChannelPairingMutation,
  listChannelsQuery,
  notificationPreferencesQuery,
  onChannelPairingSubscription,
  saveNotificationPreferencesMutation,
  validateChannelTokenMutation,
} from './resolvers/channels.js';
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
  curatedSignalsResolver,
  curationStatusResolver,
  dismissSignalResolver,
  getCurationWorkflowStatus,
  refreshIntelFeedResolver,
  runFullCurationResolver,
} from './resolvers/curated-signals.js';
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
import { marketStatusQuery, newsQuery, priceHistoryQuery, quoteQuery, searchSymbolsQuery } from './resolvers/market.js';
import { microInsightQuery, microInsightsQuery } from './resolvers/micro-insights.js';
import {
  briefingConfigQuery,
  completeMagicLinkMutation,
  completeOAuthFlowMutation,
  completeOnboardingMutation,
  confirmPersonaMutation,
  confirmPositionsMutation,
  detectAiCredentialQuery,
  detectCodexTokenQuery,
  detectKeychainTokenQuery,
  generatePersonaMutation,
  onboardingStatusQuery,
  parsePortfolioScreenshotMutation,
  resetOnboardingMutation,
  saveBriefingConfigMutation,
  sendMagicLinkMutation,
  startOAuthFlowMutation,
  validateJintelKeyMutation,
} from './resolvers/onboarding.js';
import {
  addManualPositionMutation,
  editPositionMutation,
  portfolioQuery,
  portfolioSnapshotFieldResolvers,
  positionFieldResolvers,
  refreshPositionsMutation,
  removePositionMutation,
} from './resolvers/portfolio.js';
import { clearAppDataMutation, deviceInfoResolver } from './resolvers/profile.js';
import { tickerProfileQuery, tickerProfilesQuery } from './resolvers/profiles.js';
import { riskReportQuery } from './resolvers/risk.js';
import { schedulerStatusQuery } from './resolvers/scheduler.js';
import { assessmentStatusResolver, signalAssessmentsResolver } from './resolvers/signal-assessments.js';
import { signalGroupFieldResolvers, signalGroupResolver, signalGroupsResolver } from './resolvers/signal-groups.js';
import { signalsByIdsResolver } from './resolvers/signals.js';
import {
  resolveCreateSkill,
  resolveDeleteSkill,
  resolveExportSkill,
  resolveImportSkill,
  resolveSkill,
  resolveSkills,
  resolveToggleSkill,
  resolveUpdateSkill,
} from './resolvers/skills.js';
import { snapQuery } from './resolvers/snap.js';
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
      riskReport: riskReportQuery,
      alerts: alertsQuery,
      news: newsQuery,
      quote: quoteQuery,
      searchSymbols: searchSymbolsQuery,
      priceHistory: priceHistoryQuery,
      marketStatus: marketStatusQuery,
      listDataSources: listDataSourcesResolver,
      checkDataSourceHealth: checkDataSourceHealthResolver,
      checkCliCommands: checkCliCommandsResolver,
      signalsByIds: signalsByIdsResolver,
      signalGroups: signalGroupsResolver,
      curatedSignals: curatedSignalsResolver,
      curationStatus: curationStatusResolver,
      curationWorkflowStatus: () => getCurationWorkflowStatus(),
      signalAssessments: signalAssessmentsResolver,
      assessmentStatus: assessmentStatusResolver,
      signalGroup: signalGroupResolver,
      listConnections: listConnectionsResolver,
      detectAvailableTiers: detectAvailableTiersResolver,
      deviceInfo: deviceInfoResolver,
      vaultStatus: vaultStatusQuery,
      listVaultSecrets: listVaultSecretsQuery,
      detectAiCredential: detectAiCredentialQuery,
      detectKeychainToken: detectKeychainTokenQuery,
      detectCodexToken: detectCodexTokenQuery,
      onboardingStatus: onboardingStatusQuery,
      sessions: sessionsQuery,
      session: sessionQuery,
      activeSession: activeSessionQuery,
      latestInsightReport: latestInsightReportQuery,
      insightReports: insightReportsQuery,
      insightReport: insightReportQuery,
      watchlist: watchlistQuery,
      insightsWorkflowStatus: () => getInsightsWorkflowStatus(),
      briefingConfig: briefingConfigQuery,
      schedulerStatus: schedulerStatusQuery,
      listChannels: listChannelsQuery,
      notificationPreferences: notificationPreferencesQuery,
      snap: snapQuery,
      activityLog: activityLogQuery,
      actions: actionsResolver,
      action: actionResolver,
      skills: resolveSkills,
      skill: resolveSkill,
      exportSkill: resolveExportSkill,
      tickerProfile: tickerProfileQuery,
      tickerProfiles: tickerProfilesQuery,
      microInsight: microInsightQuery,
      microInsights: microInsightsQuery,
      aiConfig: aiConfigQuery,
    },
    PortfolioSnapshot: portfolioSnapshotFieldResolvers,
    Position: positionFieldResolvers,
    SignalGroup: signalGroupFieldResolvers,
    Mutation: {
      refreshPositions: refreshPositionsMutation,
      addManualPosition: addManualPositionMutation,
      editPosition: editPositionMutation,
      removePosition: removePositionMutation,
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
      startOAuthFlow: startOAuthFlowMutation,
      completeOAuthFlow: completeOAuthFlowMutation,
      sendMagicLink: sendMagicLinkMutation,
      completeMagicLink: completeMagicLinkMutation,
      generatePersona: generatePersonaMutation,
      confirmPersona: confirmPersonaMutation,
      parsePortfolioScreenshot: parsePortfolioScreenshotMutation,
      confirmPositions: confirmPositionsMutation,
      saveBriefingConfig: saveBriefingConfigMutation,
      connectChannel: connectChannelMutation,
      disconnectChannel: disconnectChannelMutation,
      validateChannelToken: validateChannelTokenMutation,
      initiateChannelPairing: initiateChannelPairingMutation,
      cancelChannelPairing: cancelChannelPairingMutation,
      saveNotificationPreferences: saveNotificationPreferencesMutation,
      completeOnboarding: completeOnboardingMutation,
      resetOnboarding: resetOnboardingMutation,
      validateJintelKey: validateJintelKeyMutation,
      processInsights: processInsightsMutation,
      runFullCuration: runFullCurationResolver,
      refreshIntelFeed: refreshIntelFeedResolver,
      dismissSignal: dismissSignalResolver,
      addToWatchlist: addToWatchlistMutation,
      removeFromWatchlist: removeFromWatchlistMutation,
      approveAction: approveActionMutation,
      rejectAction: rejectActionMutation,
      toggleSkill: resolveToggleSkill,
      createSkill: resolveCreateSkill,
      updateSkill: resolveUpdateSkill,
      deleteSkill: resolveDeleteSkill,
      importSkill: resolveImportSkill,
      clearAppData: clearAppDataMutation,
      saveAiConfig: saveAiConfigMutation,
      saveAiCredential: saveAiCredentialMutation,
      removeAiCredential: removeAiCredentialMutation,
    },
    Subscription: {
      onAlert: onAlertSubscription,
      onPortfolioUpdate: onPortfolioUpdateSubscription,
      onPriceMove: onPriceMoveSubscription,
      onChatMessage: onChatMessageSubscription,
      onConnectionStatus: onConnectionStatusSubscription,
      onWorkflowProgress: onWorkflowProgressSubscription,
      onChannelPairing: onChannelPairingSubscription,
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
