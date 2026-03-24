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
    sparkline
    sector
    assetClass
    platform
  }
`;

export const ENRICHED_POSITION_FIELDS = gql`
  fragment EnrichedPositionFields on EnrichedPosition {
    symbol
    name
    quantity
    costBasis
    currentPrice
    marketValue
    unrealizedPnl
    unrealizedPnlPercent
    sector
    assetClass
    platform
    sentimentScore
    sentimentLabel
    analystRating
    targetPrice
    peRatio
    dividendYield
    beta
    fiftyTwoWeekHigh
    fiftyTwoWeekLow
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
  query Portfolio {
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
    }
  }
  ${POSITION_FIELDS}
`;

export const POSITIONS_QUERY = gql`
  query Positions {
    positions {
      ...PositionFields
    }
  }
  ${POSITION_FIELDS}
`;

export const PORTFOLIO_HISTORY_QUERY = gql`
  query PortfolioHistory {
    portfolioHistory {
      timestamp
      totalValue
      totalCost
      totalPnl
      totalPnlPercent
    }
  }
`;

export const ENRICHED_SNAPSHOT_QUERY = gql`
  query EnrichedSnapshot {
    enrichedSnapshot {
      id
      positions {
        ...EnrichedPositionFields
      }
      totalValue
      totalCost
      totalPnl
      totalPnlPercent
      timestamp
      enrichedAt
    }
  }
  ${ENRICHED_POSITION_FIELDS}
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

export const SECTOR_EXPOSURE_QUERY = gql`
  query SectorExposure {
    sectorExposure {
      sector
      weight
      value
    }
  }
`;

// ---------------------------------------------------------------------------
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
    }
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
    $type: String
    $ticker: String
    $sourceId: String
    $since: String
    $until: String
    $search: String
    $minConfidence: Float
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
      limit: $limit
    ) {
      id
      type
      title
      content
      publishedAt
      ingestedAt
      confidence
      tickers
      sourceId
      sourceName
      link
    }
  }
`;

// ---------------------------------------------------------------------------
// Queries — Vault
// ---------------------------------------------------------------------------

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
        }
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
        topRisks
        topOpportunities
        actionItems
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
// Mutations — Insights
// ---------------------------------------------------------------------------

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
        }
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
        topRisks
        topOpportunities
        actionItems
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
