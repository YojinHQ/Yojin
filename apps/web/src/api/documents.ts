/**
 * GraphQL operation documents for the Yojin API.
 *
 * Each constant is a tagged template literal that urql parses into a DocumentNode.
 * Organized by domain: portfolio, risk, alerts, market, subscriptions.
 */

import { gql } from '@urql/core';

// ---------------------------------------------------------------------------
// Fragments (shared field selections)
// ---------------------------------------------------------------------------

export const POSITION_FIELDS = gql`
  fragment PositionFields on Position {
    symbol
    name
    quantity
    costBasis
    currentPrice
    marketValue
    unrealizedPnl
    unrealizedPnlPercent
    dayChange
    dayChangePercent
    preMarketChange
    preMarketChangePercent
    postMarketChange
    postMarketChangePercent
    sparkline
    sector
    assetClass
    platform
    entryDate
  }
`;

export const ALERT_FIELDS = gql`
  fragment AlertFields on Alert {
    id
    rule {
      type
      symbol
      threshold
      direction
    }
    status
    message
    triggeredAt
    dismissedAt
    createdAt
  }
`;

// ---------------------------------------------------------------------------
// Queries — Portfolio
// ---------------------------------------------------------------------------

export const PORTFOLIO_QUERY = gql`
  query Portfolio($historyDays: Int) {
    portfolio {
      id
      positions {
        ...PositionFields
      }
      totalValue
      totalCost
      totalPnl
      totalPnlPercent
      timestamp
      platform
      warnings
      history(days: $historyDays) {
        timestamp
        totalValue
        totalCost
        totalPnl
        totalPnlPercent
      }
      sectorExposure {
        sector
        weight
        value
      }
    }
  }
  ${POSITION_FIELDS}
`;

// ---------------------------------------------------------------------------
// Queries — Risk
// ---------------------------------------------------------------------------

export const RISK_REPORT_QUERY = gql`
  query RiskReport {
    riskReport {
      id
      portfolioValue
      sectorExposure {
        sector
        weight
        value
      }
      concentrationScore
      topConcentrations {
        symbol
        weight
      }
      correlationClusters {
        symbols
        correlation
      }
      maxDrawdown
      valueAtRisk
      timestamp
    }
  }
`;

// Queries — Alerts
// ---------------------------------------------------------------------------

export const ALERTS_QUERY = gql`
  query Alerts($status: AlertStatus) {
    alerts(status: $status) {
      ...AlertFields
    }
  }
  ${ALERT_FIELDS}
`;

// ---------------------------------------------------------------------------
// Queries — Market
// ---------------------------------------------------------------------------

export const QUOTE_QUERY = gql`
  query Quote($symbol: String!) {
    quote(symbol: $symbol) {
      symbol
      price
      change
      changePercent
      volume
      high
      low
      open
      previousClose
      timestamp
    }
  }
`;

export const PRICE_HISTORY_QUERY = gql`
  query PriceHistory($tickers: [String!]!, $range: String) {
    priceHistory(tickers: $tickers, range: $range) {
      ticker
      history {
        date
        open
        high
        low
        close
        volume
      }
    }
  }
`;

export const NEWS_QUERY = gql`
  query News($symbol: String, $limit: Int) {
    news(symbol: $symbol, limit: $limit) {
      id
      title
      source
      url
      publishedAt
      summary
      symbols
      sentiment
    }
  }
`;

// ---------------------------------------------------------------------------
// Queries — Watchlist
// ---------------------------------------------------------------------------

export const WATCHLIST_QUERY = gql`
  query Watchlist {
    watchlist {
      symbol
      name
      assetClass
      addedAt
      price
      change
      changePercent
      enrichedAt
    }
  }
`;

// ---------------------------------------------------------------------------
// Mutations — Watchlist
// ---------------------------------------------------------------------------

export const ADD_TO_WATCHLIST_MUTATION = gql`
  mutation AddToWatchlist($symbol: String!, $name: String!, $assetClass: AssetClass!) {
    addToWatchlist(symbol: $symbol, name: $name, assetClass: $assetClass) {
      success
      error
    }
  }
`;

export const REMOVE_FROM_WATCHLIST_MUTATION = gql`
  mutation RemoveFromWatchlist($symbol: String!) {
    removeFromWatchlist(symbol: $symbol) {
      success
      error
    }
  }
`;

// ---------------------------------------------------------------------------
// Queries — Onboarding
// ---------------------------------------------------------------------------

export const ONBOARDING_STATUS_QUERY = gql`
  query OnboardingStatus {
    onboardingStatus {
      completed
      personaExists
      aiCredentialConfigured
      connectedPlatforms
      briefingConfigured
      jintelConfigured
    }
  }
`;

export const VALIDATE_JINTEL_KEY_MUTATION = gql`
  mutation ValidateJintelKey($apiKey: String!) {
    validateJintelKey(apiKey: $apiKey) {
      success
      error
    }
  }
`;

export const DETECT_AI_CREDENTIAL_QUERY = gql`
  query DetectAiCredential {
    detectAiCredential {
      method
      model
    }
  }
`;

export const DETECT_KEYCHAIN_TOKEN_QUERY = gql`
  query DetectKeychainToken {
    detectKeychainToken {
      found
      model
      error
    }
  }
`;

export const DETECT_CODEX_TOKEN_QUERY = gql`
  query DetectCodexToken {
    detectCodexToken {
      found
      model
      error
    }
  }
`;

export const GENERATE_PERSONA_MUTATION = gql`
  mutation GeneratePersona($input: PersonaInput!) {
    generatePersona(input: $input) {
      markdown
    }
  }
`;

export const CONFIRM_PERSONA_MUTATION = gql`
  mutation ConfirmPersona($markdown: String!) {
    confirmPersona(markdown: $markdown)
  }
`;

export const PARSE_PORTFOLIO_SCREENSHOT_MUTATION = gql`
  mutation ParsePortfolioScreenshot($input: ScreenshotInput!) {
    parsePortfolioScreenshot(input: $input) {
      success
      positions {
        symbol
        name
        quantity
        avgEntry
        marketPrice
        marketValue
      }
      confidence
      warnings
      error
    }
  }
`;

export const CONFIRM_POSITIONS_MUTATION = gql`
  mutation ConfirmPositions($input: ConfirmPositionsInput!) {
    confirmPositions(input: $input)
  }
`;

export const COMPLETE_ONBOARDING_MUTATION = gql`
  mutation CompleteOnboarding {
    completeOnboarding
  }
`;

export const RESET_ONBOARDING_MUTATION = gql`
  mutation ResetOnboarding {
    resetOnboarding
  }
`;

export const CLEAR_APP_DATA_MUTATION = gql`
  mutation ClearAppData {
    clearAppData
  }
`;

// ---------------------------------------------------------------------------
// Briefing config
// ---------------------------------------------------------------------------

export const BRIEFING_CONFIG_QUERY = gql`
  query BriefingConfig {
    briefingConfig {
      time
      timezone
      sections
      enabled
    }
  }
`;

export const SAVE_BRIEFING_CONFIG_MUTATION = gql`
  mutation SaveBriefingConfig($input: BriefingConfigInput!) {
    saveBriefingConfig(input: $input)
  }
`;

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const LIST_CHANNELS_QUERY = gql`
  query ListChannels {
    listChannels {
      id
      name
      status
      description
      requiredCredentials
    }
  }
`;

export const CONNECT_CHANNEL_MUTATION = gql`
  mutation ConnectChannel($id: ID!, $credentials: [CredentialInput!]!) {
    connectChannel(id: $id, credentials: $credentials) {
      success
      error
    }
  }
`;

export const DISCONNECT_CHANNEL_MUTATION = gql`
  mutation DisconnectChannel($id: ID!) {
    disconnectChannel(id: $id) {
      success
      error
    }
  }
`;

export const VALIDATE_CHANNEL_TOKEN_MUTATION = gql`
  mutation ValidateChannelToken($id: ID!, $credentials: [CredentialInput!]!) {
    validateChannelToken(id: $id, credentials: $credentials) {
      success
      error
    }
  }
`;

// ---------------------------------------------------------------------------
// Notification Preferences
// ---------------------------------------------------------------------------

export const NOTIFICATION_PREFERENCES_QUERY = gql`
  query NotificationPreferences {
    notificationPreferences {
      channelId
      enabledTypes
    }
  }
`;

export const SAVE_NOTIFICATION_PREFERENCES_MUTATION = gql`
  mutation SaveNotificationPreferences($channelId: ID!, $enabledTypes: [String!]!) {
    saveNotificationPreferences(channelId: $channelId, enabledTypes: $enabledTypes)
  }
`;

export const INITIATE_CHANNEL_PAIRING_MUTATION = gql`
  mutation InitiateChannelPairing($id: ID!) {
    initiateChannelPairing(id: $id) {
      success
      error
      qrData
    }
  }
`;

export const CANCEL_CHANNEL_PAIRING_MUTATION = gql`
  mutation CancelChannelPairing($id: ID!) {
    cancelChannelPairing(id: $id) {
      success
    }
  }
`;

export const ON_CHANNEL_PAIRING_SUBSCRIPTION = gql`
  subscription OnChannelPairing($id: ID!) {
    onChannelPairing(id: $id) {
      status
      qrData
      error
    }
  }
`;

export const AI_CONFIG_QUERY = gql`
  query AiConfig {
    aiConfig {
      defaultModel
      defaultProvider
    }
  }
`;

export const SAVE_AI_CONFIG_MUTATION = gql`
  mutation SaveAiConfig($input: AiConfigInput!) {
    saveAiConfig(input: $input) {
      defaultModel
      defaultProvider
    }
  }
`;

// ---------------------------------------------------------------------------
// Queries — Connections
// ---------------------------------------------------------------------------

export const LIST_CONNECTIONS_QUERY = gql`
  query ListConnections {
    listConnections {
      platform
      tier
      status
      lastSync
      lastError
      syncInterval
      autoRefresh
    }
  }
`;

export const DETECT_AVAILABLE_TIERS_QUERY = gql`
  query DetectAvailableTiers($platform: String!) {
    detectAvailableTiers(platform: $platform) {
      tier
      available
      requiresCredentials
    }
  }
`;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const REFRESH_POSITIONS_MUTATION = gql`
  mutation RefreshPositions($platform: String!) {
    refreshPositions(platform: $platform) {
      id
      positions {
        ...PositionFields
      }
      totalValue
      totalCost
      totalPnl
      totalPnlPercent
      timestamp
      platform
      warnings
    }
  }
  ${POSITION_FIELDS}
`;

export const CREATE_ALERT_MUTATION = gql`
  mutation CreateAlert($rule: AlertRuleInput!) {
    createAlert(rule: $rule) {
      ...AlertFields
    }
  }
  ${ALERT_FIELDS}
`;

export const DISMISS_ALERT_MUTATION = gql`
  mutation DismissAlert($id: ID!) {
    dismissAlert(id: $id) {
      ...AlertFields
    }
  }
  ${ALERT_FIELDS}
`;

export const ADD_MANUAL_POSITION_MUTATION = gql`
  mutation AddManualPosition($input: ManualPositionInput!) {
    addManualPosition(input: $input) {
      id
      positions {
        ...PositionFields
      }
      totalValue
      totalCost
      totalPnl
      totalPnlPercent
      timestamp
      platform
      warnings
    }
  }
  ${POSITION_FIELDS}
`;

export const EDIT_POSITION_MUTATION = gql`
  mutation EditPosition($symbol: String!, $platform: String!, $input: ManualPositionInput!) {
    editPosition(symbol: $symbol, platform: $platform, input: $input) {
      id
      positions {
        ...PositionFields
      }
      totalValue
      totalCost
      totalPnl
      totalPnlPercent
      timestamp
      platform
      warnings
    }
  }
  ${POSITION_FIELDS}
`;

export const REMOVE_POSITION_MUTATION = gql`
  mutation RemovePosition($symbol: String!, $platform: String!) {
    removePosition(symbol: $symbol, platform: $platform) {
      id
      positions {
        ...PositionFields
      }
      totalValue
      totalCost
      totalPnl
      totalPnlPercent
      timestamp
      platform
      warnings
    }
  }
  ${POSITION_FIELDS}
`;

// ---------------------------------------------------------------------------
// Device Identity
// ---------------------------------------------------------------------------

export const DEVICE_INFO_QUERY = gql`
  query DeviceInfo {
    deviceInfo {
      deviceId
      shortId
      createdAt
    }
  }
`;

export const CONNECT_PLATFORM_MUTATION = gql`
  mutation ConnectPlatform($input: ConnectPlatformInput!) {
    connectPlatform(input: $input) {
      success
      connection {
        platform
        tier
        status
        lastSync
        lastError
        syncInterval
        autoRefresh
      }
      error
    }
  }
`;

export const DISCONNECT_PLATFORM_MUTATION = gql`
  mutation DisconnectPlatform($platform: String!, $removeCredentials: Boolean) {
    disconnectPlatform(platform: $platform, removeCredentials: $removeCredentials) {
      success
      error
    }
  }
`;

// ---------------------------------------------------------------------------
// Queries — Data Sources
// ---------------------------------------------------------------------------

export const LIST_DATA_SOURCES_QUERY = gql`
  query ListDataSources {
    listDataSources {
      id
      name
      type
      capabilities {
        id
        description
      }
      enabled
      status
      lastError
      lastFetchedAt
      priority
      builtin
    }
  }
`;

// ---------------------------------------------------------------------------
// Mutations — Data Sources
// ---------------------------------------------------------------------------

export const ADD_DATA_SOURCE_MUTATION = gql`
  mutation AddDataSource($input: DataSourceInput!) {
    addDataSource(input: $input) {
      success
      dataSource {
        id
        name
        type
        capabilities {
          id
        }
        enabled
        status
        priority
      }
      error
    }
  }
`;

export const REMOVE_DATA_SOURCE_MUTATION = gql`
  mutation RemoveDataSource($id: String!) {
    removeDataSource(id: $id) {
      success
      error
    }
  }
`;

export const TOGGLE_DATA_SOURCE_MUTATION = gql`
  mutation ToggleDataSource($id: String!, $enabled: Boolean!) {
    toggleDataSource(id: $id, enabled: $enabled) {
      success
      error
    }
  }
`;

export const FETCH_DATA_SOURCE_MUTATION = gql`
  mutation FetchDataSource($id: String!, $url: String) {
    fetchDataSource(id: $id, url: $url) {
      success
      signalsIngested
      duplicates
      error
    }
  }
`;

export const CHECK_CLI_COMMANDS_QUERY = gql`
  query CheckCliCommands($commands: [String!]!) {
    checkCliCommands(commands: $commands) {
      command
      available
    }
  }
`;

// ---------------------------------------------------------------------------
// Queries — Signals
// ---------------------------------------------------------------------------

export const SIGNALS_QUERY = gql`
  query Signals(
    $type: SignalType
    $ticker: String
    $sourceId: String
    $since: String
    $until: String
    $search: String
    $minConfidence: Float
    $outputType: SignalOutputType
    $limit: Int
  ) {
    signals(
      type: $type
      ticker: $ticker
      sourceId: $sourceId
      since: $since
      until: $until
      search: $search
      minConfidence: $minConfidence
      outputType: $outputType
      limit: $limit
    ) {
      id
      type
      title
      content
      publishedAt
      ingestedAt
      confidence
      contentHash
      tickers
      sources {
        id
        name
        type
        reliability
      }
      sourceCount
      link
      tier1
      tier2
      sentiment
      outputType
      groupId
      version
    }
  }
`;

export const SIGNALS_BY_IDS_QUERY = gql`
  query SignalsByIds($ids: [ID!]!) {
    signalsByIds(ids: $ids) {
      id
      type
      title
      content
      publishedAt
      confidence
      tickers
      sources {
        id
        name
        type
        reliability
      }
      sourceCount
      link
      tier1
      tier2
      sentiment
      outputType
    }
  }
`;

export const CURATED_SIGNALS_QUERY = gql`
  query CuratedSignals($ticker: String, $since: String, $limit: Int) {
    curatedSignals(ticker: $ticker, since: $since, limit: $limit) {
      signal {
        id
        type
        title
        content
        publishedAt
        ingestedAt
        confidence
        contentHash
        tickers
        sources {
          id
          name
          type
          reliability
        }
        sourceCount
        link
        tier1
        tier2
        sentiment
        outputType
        groupId
        version
      }
      scores {
        signalId
        ticker
        exposureWeight
        typeRelevance
        compositeScore
      }
      curatedAt
    }
  }
`;

export const VAULT_STATUS_QUERY = gql`
  query VaultStatus {
    vaultStatus {
      isUnlocked
      hasPassphrase
      secretCount
    }
  }
`;

export const LIST_VAULT_SECRETS_QUERY = gql`
  query ListVaultSecrets {
    listVaultSecrets {
      key
      createdAt
      updatedAt
    }
  }
`;

// ---------------------------------------------------------------------------
// Mutations — Vault
// ---------------------------------------------------------------------------

export const UNLOCK_VAULT_MUTATION = gql`
  mutation UnlockVault($passphrase: String!) {
    unlockVault(passphrase: $passphrase) {
      success
      error
    }
  }
`;

export const SET_VAULT_PASSPHRASE_MUTATION = gql`
  mutation SetVaultPassphrase($newPassphrase: String!) {
    setVaultPassphrase(newPassphrase: $newPassphrase) {
      success
      error
    }
  }
`;

export const CHANGE_VAULT_PASSPHRASE_MUTATION = gql`
  mutation ChangeVaultPassphrase($currentPassphrase: String!, $newPassphrase: String!) {
    changeVaultPassphrase(currentPassphrase: $currentPassphrase, newPassphrase: $newPassphrase) {
      success
      error
    }
  }
`;

export const ADD_VAULT_SECRET_MUTATION = gql`
  mutation AddVaultSecret($input: VaultSecretInput!) {
    addVaultSecret(input: $input) {
      success
      error
    }
  }
`;

export const UPDATE_VAULT_SECRET_MUTATION = gql`
  mutation UpdateVaultSecret($input: VaultSecretInput!) {
    updateVaultSecret(input: $input) {
      success
      error
    }
  }
`;

export const DELETE_VAULT_SECRET_MUTATION = gql`
  mutation DeleteVaultSecret($key: String!) {
    deleteVaultSecret(key: $key) {
      success
      error
    }
  }
`;

// ---------------------------------------------------------------------------
// Queries — Insights
// ---------------------------------------------------------------------------

export const LATEST_INSIGHT_REPORT_QUERY = gql`
  query LatestInsightReport {
    latestInsightReport {
      id
      snapshotId
      positions {
        symbol
        name
        rating
        conviction
        thesis
        keySignals {
          signalId
          type
          title
          impact
          confidence
          url
          sourceCount
          detail
          outputType
        }
        allSignalIds
        risks
        opportunities
        memoryContext
        priceTarget
      }
      portfolio {
        overallHealth
        summary
        sectorThemes
        macroContext
        topRisks {
          text
          signalIds
        }
        topOpportunities {
          text
          signalIds
        }
        actionItems {
          text
          signalIds
        }
      }
      emotionState {
        confidence
        riskAppetite
        reason
      }
      createdAt
      durationMs
    }
  }
`;

export const INSIGHT_REPORTS_QUERY = gql`
  query InsightReports($limit: Int) {
    insightReports(limit: $limit) {
      id
      snapshotId
      portfolio {
        overallHealth
        summary
      }
      positions {
        symbol
        rating
      }
      emotionState {
        confidence
        riskAppetite
        reason
      }
      createdAt
      durationMs
    }
  }
`;

// ---------------------------------------------------------------------------
// Queries — Snap (Strategist brief)
// ---------------------------------------------------------------------------

export const SNAP_QUERY = gql`
  query Snap {
    snap {
      id
      generatedAt
      intelSummary
      actionItems {
        text
        signalIds
      }
      assetSnaps {
        symbol
        snap
        rating
        generatedAt
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Micro Insights
// ---------------------------------------------------------------------------

export const MICRO_INSIGHT_QUERY = gql`
  query MicroInsight($symbol: String!) {
    microInsight(symbol: $symbol) {
      id
      symbol
      name
      source
      rating
      conviction
      thesis
      keyDevelopments
      risks
      opportunities
      sentiment
      signalCount
      assetSnap
      assetActions
      generatedAt
      durationMs
    }
  }
`;

export const MICRO_INSIGHTS_QUERY = gql`
  query MicroInsights {
    microInsights {
      id
      symbol
      name
      source
      rating
      conviction
      thesis
      keyDevelopments
      risks
      opportunities
      sentiment
      signalCount
      assetSnap
      assetActions
      generatedAt
      durationMs
    }
  }
`;

// ---------------------------------------------------------------------------
// Mutations — Insights
// ---------------------------------------------------------------------------

export const INSIGHTS_WORKFLOW_STATUS_QUERY = gql`
  query InsightsWorkflowStatus {
    insightsWorkflowStatus {
      running
      startedAt
    }
  }
`;

export const PROCESS_INSIGHTS_MUTATION = gql`
  mutation ProcessInsights {
    processInsights {
      id
      snapshotId
      positions {
        symbol
        name
        rating
        conviction
        thesis
        keySignals {
          signalId
          type
          title
          impact
          confidence
          url
          sourceCount
          detail
          outputType
        }
        allSignalIds
        risks
        opportunities
        memoryContext
        priceTarget
      }
      portfolio {
        overallHealth
        summary
        sectorThemes
        macroContext
        topRisks {
          text
          signalIds
        }
        topOpportunities {
          text
          signalIds
        }
        actionItems {
          text
          signalIds
        }
      }
      emotionState {
        confidence
        riskAppetite
        reason
      }
      createdAt
      durationMs
    }
  }
`;

// ---------------------------------------------------------------------------
// Mutations — Curation
// ---------------------------------------------------------------------------

export const RUN_FULL_CURATION_MUTATION = gql`
  mutation RunFullCuration {
    runFullCuration
  }
`;

export const CURATION_WORKFLOW_STATUS_QUERY = gql`
  query CurationWorkflowStatus {
    curationWorkflowStatus {
      running
      startedAt
    }
  }
`;

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const ON_ALERT_SUBSCRIPTION = gql`
  subscription OnAlert {
    onAlert {
      ...AlertFields
    }
  }
  ${ALERT_FIELDS}
`;

export const ON_PORTFOLIO_UPDATE_SUBSCRIPTION = gql`
  subscription OnPortfolioUpdate {
    onPortfolioUpdate {
      id
      positions {
        ...PositionFields
      }
      totalValue
      totalCost
      totalPnl
      totalPnlPercent
      timestamp
      platform
      warnings
    }
  }
  ${POSITION_FIELDS}
`;

export const ON_CONNECTION_STATUS_SUBSCRIPTION = gql`
  subscription OnConnectionStatus($platform: String!) {
    onConnectionStatus(platform: $platform) {
      platform
      step
      message
      tier
      error
    }
  }
`;

export const ON_PRICE_MOVE_SUBSCRIPTION = gql`
  subscription OnPriceMove($symbol: String!, $threshold: Float!) {
    onPriceMove(symbol: $symbol, threshold: $threshold) {
      symbol
      price
      change
      changePercent
      timestamp
    }
  }
`;

export const ON_WORKFLOW_PROGRESS_SUBSCRIPTION = gql`
  subscription OnWorkflowProgress($workflowId: String!) {
    onWorkflowProgress(workflowId: $workflowId) {
      workflowId
      stage
      stageIndex
      totalStages
      agentIds
      error
      message
      timestamp
    }
  }
`;

// ---------------------------------------------------------------------------
// Queries — Intel Feed
// ---------------------------------------------------------------------------

export const INTEL_FEED_QUERY = gql`
  query IntelFeed($limit: Int, $offset: Int) {
    curatedSignals(limit: $limit, offset: $offset) {
      signal {
        id
        title
        type
        sentiment
        outputType
        tickers
        publishedAt
        ingestedAt
        confidence
        link
        sources {
          name
          reliability
        }
        tier1
        tier2
      }
      scores {
        ticker
        compositeScore
      }
      curatedAt
      verdict
      thesisAlignment
      actionability
    }
  }
`;

export const DISMISS_SIGNAL_MUTATION = gql`
  mutation DismissSignal($signalId: ID!) {
    dismissSignal(signalId: $signalId)
  }
`;

export const REFRESH_INTEL_FEED_MUTATION = gql`
  mutation RefreshIntelFeed {
    refreshIntelFeed {
      signalsFetched
      signalsCurated
      error
    }
  }
`;

// ---------------------------------------------------------------------------
// Queries — Activity Log
// ---------------------------------------------------------------------------

export const ACTIVITY_LOG_QUERY = gql`
  query ActivityLog($types: [ActivityEventType!], $since: String, $limit: Int) {
    activityLog(types: $types, since: $since, limit: $limit) {
      id
      type
      message
      timestamp
      ticker
      metadata
    }
  }
`;
