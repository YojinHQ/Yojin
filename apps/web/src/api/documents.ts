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
      totalDayChange
      totalDayChangePercent
      timestamp
      platform
      warnings
      history(days: $historyDays) {
        timestamp
        totalValue
        totalCost
        totalPnl
        totalPnlPercent
        periodPnl
        periodPnlPercent
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
      name
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

export const SEARCH_SYMBOLS_QUERY = gql`
  query SearchSymbols($query: String!, $limit: Int) {
    searchSymbols(query: $query, limit: $limit) {
      symbol
      name
      assetClass
    }
  }
`;

export const PRICE_HISTORY_QUERY = gql`
  query PriceHistory($tickers: [String!]!, $range: String, $interval: String) {
    priceHistory(tickers: $tickers, range: $range, interval: $interval) {
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

export const MARKET_STATUS_QUERY = gql`
  query MarketStatus {
    marketStatus {
      isOpen
      isTradingDay
      session
      holiday
      date
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
      preMarketPrice
      preMarketChange
      preMarketChangePercent
      postMarketPrice
      postMarketChange
      postMarketChangePercent
      sparkline
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
      microLlmIntervalHours
    }
  }
`;

export const SAVE_BRIEFING_CONFIG_MUTATION = gql`
  mutation SaveBriefingConfig($input: BriefingConfigInput!) {
    saveBriefingConfig(input: $input)
  }
`;

// ---------------------------------------------------------------------------
// Scheduler status
// ---------------------------------------------------------------------------

export const SCHEDULER_STATUS_QUERY = gql`
  query SchedulerStatus {
    schedulerStatus {
      microLlmIntervalHours
      pendingCount
      throttledCount
      assets {
        symbol
        source
        lastSignalFetchAt
        lastLlmAt
        nextLlmEligibleAt
        pendingAnalysis
      }
    }
  }
`;

export const TRIGGER_MICRO_ANALYSIS_MUTATION = gql`
  mutation TriggerMicroAnalysis {
    triggerMicroAnalysis
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
      statusMessage
      description
      requiredCredentials
    }
  }
`;

export const CONNECT_CHANNEL_MUTATION = gql`
  mutation ConnectChannel($id: ID!, $credentials: [KeyValueInput!]!) {
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
  mutation ValidateChannelToken($id: ID!, $credentials: [KeyValueInput!]!) {
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
      hasAnthropicKey
      hasAnthropicApiKey
      hasOpenaiKey
    }
  }
`;

export const SAVE_AI_CONFIG_MUTATION = gql`
  mutation SaveAiConfig($input: AiConfigInput!) {
    saveAiConfig(input: $input) {
      defaultModel
      defaultProvider
      hasAnthropicKey
      hasAnthropicApiKey
      hasOpenaiKey
    }
  }
`;

export const SAVE_AI_CREDENTIAL_MUTATION = gql`
  mutation SaveAiCredential($provider: String!, $apiKey: String!) {
    saveAiCredential(provider: $provider, apiKey: $apiKey) {
      success
      error
    }
  }
`;

export const REMOVE_AI_CREDENTIAL_MUTATION = gql`
  mutation RemoveAiCredential($provider: String!) {
    removeAiCredential(provider: $provider) {
      success
      error
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
    curatedSignals(
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
      severity
      feedTarget
      assessment {
        verdict
        thesisAlignment
        actionability
      }
      convergenceBoost
      engagementScore
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
  query CuratedSignals($ticker: String, $since: String, $limit: Int, $feedTarget: FeedTarget) {
    curatedSignals(ticker: $ticker, since: $since, limit: $limit, feedTarget: $feedTarget) {
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
        ticker
        compositeScore
      }
      feedTarget
      severity
      assessment {
        verdict
        thesisAlignment
        actionability
      }
      convergenceBoost
      engagementScore
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
  mutation AddVaultSecret($input: KeyValueInput!) {
    addVaultSecret(input: $input) {
      success
      error
    }
  }
`;

export const UPDATE_VAULT_SECRET_MUTATION = gql`
  mutation UpdateVaultSecret($input: KeyValueInput!) {
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
        carriedForward
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
// Mutations + Subscriptions — Deep Analysis
// ---------------------------------------------------------------------------

export const DEEP_ANALYZE_POSITION_MUTATION = gql`
  mutation DeepAnalyzePosition($symbol: String!, $insightReportId: ID!) {
    deepAnalyzePosition(symbol: $symbol, insightReportId: $insightReportId)
  }
`;

export const ON_DEEP_ANALYSIS_SUBSCRIPTION = gql`
  subscription OnDeepAnalysis($symbol: String!) {
    onDeepAnalysis(symbol: $symbol) {
      type
      symbol
      delta
      content
      error
    }
  }
`;

// ---------------------------------------------------------------------------
// Queries — Snap (Strategist brief)
// ---------------------------------------------------------------------------

// Snap.actionItems is intentionally NOT fetched. The Summaries card reads from
// the `summaries` query, which owns the summary bullet list. Keeping
// snap.actionItems out of this query avoids duplicate information on the
// dashboard and shrinks the payload.
export const SNAP_QUERY = gql`
  query Snap {
    snap {
      id
      generatedAt
      intelSummary
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
      topSignalIds
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
      topSignalIds
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
      totalDayChange
      totalDayChangePercent
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
  query IntelFeed($limit: Int, $offset: Int, $feedTarget: FeedTarget) {
    curatedSignals(limit: $limit, offset: $offset, feedTarget: $feedTarget) {
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
        content
        tier1
        tier2
      }
      scores {
        ticker
        compositeScore
      }
      feedTarget
      severity
      assessment {
        verdict
        thesisAlignment
        actionability
      }
      convergenceBoost
      engagementScore
    }
  }
`;

export const DISMISS_SIGNAL_MUTATION = gql`
  mutation DismissSignal($signalId: ID!) {
    dismissSignal(signalId: $signalId)
  }
`;

export const BATCH_DISMISS_SIGNALS_MUTATION = gql`
  mutation BatchDismissSignals($signalIds: [ID!]!) {
    batchDismissSignals(signalIds: $signalIds)
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

// ---------------------------------------------------------------------------
// Queries — Strategies
// ---------------------------------------------------------------------------

export const STRATEGIES_QUERY = gql`
  query Strategies($category: StrategyCategory, $style: StrategyStyle, $active: Boolean, $query: String) {
    strategies(category: $category, style: $style, active: $active, query: $query) {
      id
      name
      description
      category
      style
      requires
      active
      source
      createdBy
      createdAt
      content
      triggerGroups {
        label
        conditions {
          type
          description
          params
        }
      }
      maxPositionSize
      tickers
    }
  }
`;

export const STRATEGY_QUERY = gql`
  query Strategy($id: ID!) {
    strategy(id: $id) {
      id
      name
      description
      category
      style
      requires
      active
      source
      createdBy
      createdAt
      content
      triggerGroups {
        label
        conditions {
          type
          description
          params
        }
      }
      maxPositionSize
      tickers
    }
  }
`;

export const EXPORT_STRATEGY_QUERY = gql`
  query ExportStrategy($id: ID!) {
    exportStrategy(id: $id)
  }
`;

// ---------------------------------------------------------------------------
// Mutations — Strategies
// ---------------------------------------------------------------------------

export const TOGGLE_STRATEGY_MUTATION = gql`
  mutation ToggleStrategy($id: ID!, $active: Boolean!) {
    toggleStrategy(id: $id, active: $active) {
      id
      active
    }
  }
`;

export const CREATE_STRATEGY_MUTATION = gql`
  mutation CreateStrategy($input: CreateStrategyInput!) {
    createStrategy(input: $input) {
      id
      name
    }
  }
`;

export const UPDATE_STRATEGY_MUTATION = gql`
  mutation UpdateStrategy($id: ID!, $input: UpdateStrategyInput!) {
    updateStrategy(id: $id, input: $input) {
      id
      name
    }
  }
`;

export const DELETE_STRATEGY_MUTATION = gql`
  mutation DeleteStrategy($id: ID!) {
    deleteStrategy(id: $id)
  }
`;

export const IMPORT_STRATEGY_MUTATION = gql`
  mutation ImportStrategy($markdown: String!) {
    importStrategy(markdown: $markdown) {
      id
      name
      description
      category
      style
      requires
      source
    }
  }
`;

// ---------------------------------------------------------------------------
// Summaries — the TLDR/priority surface. Ranked by severity and gated by the
// micro-runner's supersede logic; new critical items auto-evict weaker ones
// for the same ticker. See src/insights/micro-runner.ts.
// ---------------------------------------------------------------------------

// Summaries are neutral intel observations (macro + micro flows). Read-only;
// no approval lifecycle — the opinionated layer lives in `Action` below.
export const SUMMARY_FIELDS = gql`
  fragment SummaryFields on Summary {
    id
    ticker
    what
    flow
    severity
    severityLabel
    sourceSignals {
      id
      type
      title
      link
      sourceName
    }
    contentHash
    createdAt
  }
`;

export const SUMMARIES_QUERY = gql`
  query Summaries($ticker: String, $flow: SummaryFlow, $since: String, $limit: Int) {
    summaries(ticker: $ticker, flow: $flow, since: $since, limit: $limit) {
      ...SummaryFields
    }
  }
  ${SUMMARY_FIELDS}
`;

export const SUMMARY_QUERY = gql`
  query Summary($id: ID!) {
    summary(id: $id) {
      ...SummaryFields
    }
  }
  ${SUMMARY_FIELDS}
`;

// Actions are BUY/SELL/REVIEW outcomes produced by Strategy/Strategy triggers.
// PENDING → APPROVED | REJECTED | EXPIRED lifecycle, with user approval.
export const ACTION_FIELDS = gql`
  fragment ActionFields on Action {
    id
    strategyId
    strategyName
    triggerId
    triggerType
    verdict
    what
    why
    tickers
    riskContext
    severity
    confidence
    severityLabel
    status
    expiresAt
    createdAt
    resolvedAt
    resolvedBy
    dismissedAt
  }
`;

export const ACTIONS_QUERY = gql`
  query Actions($status: ActionStatus, $since: String, $limit: Int, $dismissed: Boolean) {
    actions(status: $status, since: $since, limit: $limit, dismissed: $dismissed) {
      ...ActionFields
    }
  }
  ${ACTION_FIELDS}
`;

export const ACTION_QUERY = gql`
  query Action($id: ID!) {
    action(id: $id) {
      ...ActionFields
    }
  }
  ${ACTION_FIELDS}
`;

export const APPROVE_ACTION_MUTATION = gql`
  mutation ApproveAction($id: ID!) {
    approveAction(id: $id) {
      ...ActionFields
    }
  }
  ${ACTION_FIELDS}
`;

export const REJECT_ACTION_MUTATION = gql`
  mutation RejectAction($id: ID!) {
    rejectAction(id: $id) {
      ...ActionFields
    }
  }
  ${ACTION_FIELDS}
`;

export const DISMISS_ACTION_MUTATION = gql`
  mutation DismissAction($id: ID!) {
    dismissAction(id: $id) {
      ...ActionFields
    }
  }
  ${ACTION_FIELDS}
`;

export const STRATEGY_SOURCE_FIELDS = gql`
  fragment StrategySourceFields on StrategySource {
    id
    owner
    repo
    path
    ref
    enabled
    lastSyncedAt
    label
    isDefault
  }
`;

export const STRATEGY_SOURCES_QUERY = gql`
  query StrategySources {
    strategySources {
      ...StrategySourceFields
    }
  }
  ${STRATEGY_SOURCE_FIELDS}
`;

export const ADD_STRATEGY_SOURCE_MUTATION = gql`
  mutation AddStrategySource($url: String!) {
    addStrategySource(url: $url) {
      ...StrategySourceFields
    }
  }
  ${STRATEGY_SOURCE_FIELDS}
`;

export const REMOVE_STRATEGY_SOURCE_MUTATION = gql`
  mutation RemoveStrategySource($id: ID!) {
    removeStrategySource(id: $id)
  }
`;

export const TOGGLE_STRATEGY_SOURCE_MUTATION = gql`
  mutation ToggleStrategySource($id: ID!, $enabled: Boolean!) {
    toggleStrategySource(id: $id, enabled: $enabled) {
      id
      enabled
    }
  }
`;

export const SYNC_STRATEGIES_MUTATION = gql`
  mutation SyncStrategies {
    syncStrategies {
      added
      skipped
      failed
      errors
    }
  }
`;
