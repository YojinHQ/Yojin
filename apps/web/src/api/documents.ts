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
