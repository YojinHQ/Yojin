/**
 * GraphQL schema definition (SDL).
 */

export const typeDefs = /* GraphQL */ `
  # ---------------------------------------------------------------------------
  # Enums
  # ---------------------------------------------------------------------------

  enum AssetClass {
    EQUITY
    CRYPTO
    BOND
    COMMODITY
    CURRENCY
    OTHER
  }

  # Platform is a String (not an enum) to support custom user-defined platforms.
  # Known platforms: INTERACTIVE_BROKERS, ROBINHOOD, COINBASE, SCHWAB, BINANCE,
  # FIDELITY, POLYMARKET, PHANTOM, MANUAL.
  # Any other value is treated as a custom platform.

  enum AlertStatus {
    ACTIVE
    TRIGGERED
    DISMISSED
  }

  enum AlertRuleType {
    PRICE_MOVE
    SENTIMENT_SHIFT
    EARNINGS_PROXIMITY
    CONCENTRATION_DRIFT
    CORRELATION_WARNING
  }

  enum Direction {
    UP
    DOWN
    BOTH
  }

  # ---------------------------------------------------------------------------
  # Portfolio
  # ---------------------------------------------------------------------------

  type Position {
    symbol: String!
    name: String!
    quantity: Float!
    costBasis: Float!
    currentPrice: Float!
    marketValue: Float!
    unrealizedPnl: Float!
    unrealizedPnlPercent: Float!
    sector: String
    assetClass: AssetClass!
    platform: String!
  }

  type PortfolioSnapshot {
    id: ID!
    positions: [Position!]!
    totalValue: Float!
    totalCost: Float!
    totalPnl: Float!
    totalPnlPercent: Float!
    timestamp: String!
    platform: String
  }

  # ---------------------------------------------------------------------------
  # Enriched
  # ---------------------------------------------------------------------------

  type EnrichedPosition {
    symbol: String!
    name: String!
    quantity: Float!
    costBasis: Float!
    currentPrice: Float!
    marketValue: Float!
    unrealizedPnl: Float!
    unrealizedPnlPercent: Float!
    sector: String
    assetClass: AssetClass!
    platform: String!
    sentimentScore: Float
    sentimentLabel: String
    analystRating: String
    targetPrice: Float
    peRatio: Float
    dividendYield: Float
    beta: Float
    fiftyTwoWeekHigh: Float
    fiftyTwoWeekLow: Float
  }

  type EnrichedSnapshot {
    id: ID!
    positions: [EnrichedPosition!]!
    totalValue: Float!
    totalCost: Float!
    totalPnl: Float!
    totalPnlPercent: Float!
    timestamp: String!
    enrichedAt: String!
  }

  # ---------------------------------------------------------------------------
  # Risk
  # ---------------------------------------------------------------------------

  type SectorWeight {
    sector: String!
    weight: Float!
    value: Float!
  }

  type Concentration {
    symbol: String!
    weight: Float!
  }

  type CorrelationCluster {
    symbols: [String!]!
    correlation: Float!
  }

  type RiskReport {
    id: ID!
    portfolioValue: Float!
    sectorExposure: [SectorWeight!]!
    concentrationScore: Float!
    topConcentrations: [Concentration!]!
    correlationClusters: [CorrelationCluster!]!
    maxDrawdown: Float!
    valueAtRisk: Float!
    timestamp: String!
  }

  # ---------------------------------------------------------------------------
  # Alerts
  # ---------------------------------------------------------------------------

  type AlertRule {
    type: AlertRuleType!
    symbol: String
    threshold: Float
    direction: Direction
  }

  type Alert {
    id: ID!
    rule: AlertRule!
    status: AlertStatus!
    message: String!
    triggeredAt: String
    dismissedAt: String
    createdAt: String!
  }

  # ---------------------------------------------------------------------------
  # Market
  # ---------------------------------------------------------------------------

  type Quote {
    symbol: String!
    price: Float!
    change: Float!
    changePercent: Float!
    volume: Float!
    high: Float!
    low: Float!
    open: Float!
    previousClose: Float!
    timestamp: String!
  }

  type Article {
    id: ID!
    title: String!
    source: String!
    url: String!
    publishedAt: String!
    summary: String
    symbols: [String!]!
    sentiment: Float
  }

  # ---------------------------------------------------------------------------
  # Subscriptions
  # ---------------------------------------------------------------------------

  type PriceEvent {
    symbol: String!
    price: Float!
    change: Float!
    changePercent: Float!
    timestamp: String!
  }

  # ---------------------------------------------------------------------------
  # Chat
  # ---------------------------------------------------------------------------

  enum ChatRole {
    USER
    ASSISTANT
  }

  enum ChatEventType {
    THINKING
    TOOL_USE
    TEXT_DELTA
    MESSAGE_COMPLETE
    PII_REDACTED
    ERROR
  }

  type ChatMessage {
    id: ID!
    threadId: String!
    role: ChatRole!
    content: String!
    timestamp: String!
  }

  type ChatEvent {
    type: ChatEventType!
    threadId: String!
    delta: String
    messageId: String
    content: String
    error: String
    toolName: String
    piiTypesFound: [String!]
  }

  type SendMessagePayload {
    threadId: String!
    messageId: String!
  }

  # ---------------------------------------------------------------------------
  # Inputs
  # ---------------------------------------------------------------------------

  input AlertRuleInput {
    type: AlertRuleType!
    symbol: String
    threshold: Float
    direction: Direction
  }

  input ManualPositionInput {
    symbol: String!
    name: String
    quantity: Float!
    costBasis: Float!
    assetClass: AssetClass
    platform: String
  }

  # ---------------------------------------------------------------------------
  # Connections / Onboarding
  # ---------------------------------------------------------------------------

  enum IntegrationTier {
    CLI
    API
    UI
    SCREENSHOT
  }
  enum ConnectionStatus {
    PENDING
    VALIDATING
    CONNECTED
    ERROR
    DISCONNECTED
  }

  input ConnectPlatformInput {
    platform: String!
    tier: IntegrationTier
  }

  type ConnectionResult {
    success: Boolean!
    connection: Connection
    error: String
  }

  type Connection {
    platform: String!
    tier: IntegrationTier!
    status: ConnectionStatus!
    lastSync: String
    lastError: String
    syncInterval: Int!
    autoRefresh: Boolean!
  }

  type TierAvailability {
    tier: IntegrationTier!
    available: Boolean!
    requiresCredentials: [String!]!
  }

  type ConnectionEvent {
    platform: String!
    step: String!
    message: String!
    tier: IntegrationTier
    error: String
  }

  # ---------------------------------------------------------------------------
  # Root types
  # ---------------------------------------------------------------------------

  type PortfolioHistoryPoint {
    timestamp: String!
    totalValue: Float!
    totalCost: Float!
    totalPnl: Float!
    totalPnlPercent: Float!
  }

  type DeviceInfo {
    deviceId: String!
    shortId: String!
    createdAt: String!
  }

  type Query {
    deviceInfo: DeviceInfo!
    portfolio: PortfolioSnapshot
    positions: [Position!]!
    portfolioHistory: [PortfolioHistoryPoint!]!
    enrichedSnapshot: EnrichedSnapshot
    riskReport: RiskReport
    alerts(status: AlertStatus): [Alert!]!
    news(symbol: String, limit: Int): [Article!]!
    quote(symbol: String!): Quote
    sectorExposure: [SectorWeight!]!
    listConnections: [Connection!]!
    detectAvailableTiers(platform: String!): [TierAvailability!]!
  }

  type Mutation {
    refreshPositions(platform: String!): PortfolioSnapshot!
    addManualPosition(input: ManualPositionInput!): PortfolioSnapshot!
    createAlert(rule: AlertRuleInput!): Alert!
    dismissAlert(id: ID!): Alert!
    sendMessage(threadId: String!, message: String!, imageBase64: String, imageMediaType: String): SendMessagePayload!
    connectPlatform(input: ConnectPlatformInput!): ConnectionResult!
    disconnectPlatform(platform: String!, removeCredentials: Boolean = false): ConnectionResult!
  }

  type Subscription {
    onAlert: Alert!
    onPortfolioUpdate: PortfolioSnapshot!
    onPriceMove(symbol: String!, threshold: Float!): PriceEvent!
    onChatMessage(threadId: String!): ChatEvent!
    onConnectionStatus(platform: String!): ConnectionEvent!
  }
`;
