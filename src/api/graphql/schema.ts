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
    dayChange: Float
    dayChangePercent: Float
    sparkline: [Float!]
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
    TOOL_CARD
  }

  type ToolCardRef {
    tool: String!
    params: String!
  }

  type ChatMessage {
    id: ID!
    threadId: String!
    role: ChatRole!
    content: String!
    timestamp: String!
    toolCards: [ToolCardRef!]
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
    toolCard: ToolCardRef
  }

  type SendMessagePayload {
    threadId: String!
    messageId: String!
  }

  type SessionSummary {
    id: ID!
    threadId: String!
    title: String!
    createdAt: String!
    lastMessageAt: String
    messageCount: Int!
  }

  type SessionDetail {
    id: ID!
    threadId: String!
    title: String!
    createdAt: String!
    lastMessageAt: String
    messages: [ChatMessage!]!
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

  input CredentialInput {
    key: String!
    value: String!
  }

  input ConnectPlatformInput {
    platform: String!
    tier: IntegrationTier
    credentials: [CredentialInput!]
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
  # Vault
  # ---------------------------------------------------------------------------

  type VaultStatus {
    isUnlocked: Boolean!
    hasPassphrase: Boolean!
    secretCount: Int!
  }

  type VaultSecret {
    key: String!
    createdAt: String!
    updatedAt: String!
  }

  type VaultResult {
    success: Boolean!
    error: String
  }

  input VaultSecretInput {
    key: String!
    value: String!
  }

  # ---------------------------------------------------------------------------
  # Data Sources
  # ---------------------------------------------------------------------------

  enum DataSourceType {
    CLI
    MCP
    API
  }

  enum DataSourceStatus {
    ACTIVE
    ERROR
    DISABLED
  }

  type DataSourceCapability {
    id: String!
    description: String
  }

  type DataSource {
    id: String!
    name: String!
    type: DataSourceType!
    capabilities: [DataSourceCapability!]!
    enabled: Boolean!
    status: DataSourceStatus!
    lastError: String
    lastFetchedAt: String
    priority: Int!
    builtin: Boolean!
  }

  type DataSourceResult {
    success: Boolean!
    dataSource: DataSource
    error: String
  }

  type FetchResult {
    success: Boolean!
    signalsIngested: Int!
    duplicates: Int!
    error: String
  }

  # ---------------------------------------------------------------------------
  # Signals
  # ---------------------------------------------------------------------------

  type SignalSource {
    id: String!
    name: String!
    type: String!
    reliability: Float!
  }

  enum SignalOutputType {
    INSIGHT
    ALERT
  }

  type Signal {
    id: String!
    type: String!
    title: String!
    content: String
    publishedAt: String!
    ingestedAt: String!
    confidence: Float!
    contentHash: String!
    tickers: [String!]!
    sources: [SignalSource!]!
    sourceCount: Int!
    link: String
    tier1: String
    tier2: String
    sentiment: String
    outputType: SignalOutputType!
    groupId: String
    version: Int!
  }

  type SignalGroup {
    id: String!
    signals: [Signal!]!
    tickers: [String!]!
    summary: String!
    outputType: SignalOutputType!
    firstEventAt: String!
    lastEventAt: String!
  }

  input DataSourceInput {
    id: String!
    name: String!
    type: DataSourceType!
    capabilities: [String!]!
    enabled: Boolean
    priority: Int
    baseUrl: String
    secretRef: String
    command: String
    args: [String!]
  }

  # ---------------------------------------------------------------------------
  # Onboarding
  # ---------------------------------------------------------------------------

  enum AiAuthMethod {
    MAGIC_LINK
    API_KEY
    ENV_DETECTED
    OAUTH
    KEYCHAIN
  }

  type DetectedCredential {
    method: AiAuthMethod!
    model: String
  }

  enum AiKeyProvider {
    ANTHROPIC
    OPENAI
    OPENROUTER
  }

  input ValidateCredentialInput {
    method: AiAuthMethod!
    apiKey: String
    provider: AiKeyProvider
  }

  type ValidateCredentialResult {
    success: Boolean!
    model: String
    error: String
  }

  type MagicLinkResult {
    success: Boolean!
    error: String
  }

  type MagicLinkVerifyResult {
    success: Boolean!
    model: String
    error: String
  }

  input PersonaInput {
    name: String!
    riskTolerance: String!
    assetClasses: [String!]!
    communicationStyle: String!
    hardRules: String
  }

  type PersonaResult {
    markdown: String!
  }

  input ScreenshotInput {
    image: String!
    mediaType: String!
    platform: String!
  }

  type ExtractedPositionGql {
    symbol: String!
    name: String
    quantity: Float
    avgEntry: Float
    marketPrice: Float
    marketValue: Float
  }

  type ScreenshotResult {
    success: Boolean!
    positions: [ExtractedPositionGql!]
    confidence: Float
    warnings: [String!]
    error: String
  }

  input PositionInput {
    symbol: String!
    name: String
    quantity: Float
    avgEntry: Float
    marketPrice: Float
    marketValue: Float
  }

  input ConfirmPositionsInput {
    platform: String!
    positions: [PositionInput!]!
  }

  input BriefingConfigInput {
    time: String!
    timezone: String!
    sections: [String!]!
    channel: String!
  }

  type BriefingConfig {
    time: String!
    timezone: String!
    sections: [String!]!
    channel: String!
    enabled: Boolean!
  }

  type OnboardingStatusResult {
    completed: Boolean!
    personaExists: Boolean!
    aiCredentialConfigured: Boolean!
    connectedPlatforms: [String!]!
    briefingConfigured: Boolean!
    jintelConfigured: Boolean!
  }

  type ValidateJintelKeyResult {
    success: Boolean!
    error: String
  }

  type KeychainTokenResult {
    found: Boolean!
    model: String
    error: String
  }

  type OAuthFlowResult {
    authUrl: String!
    state: String!
  }

  type OAuthCompleteResult {
    success: Boolean!
    model: String
    error: String
  }

  # ---------------------------------------------------------------------------
  # Insights
  # ---------------------------------------------------------------------------

  enum InsightRating {
    STRONG_BUY
    BUY
    HOLD
    SELL
    STRONG_SELL
  }

  enum PortfolioHealth {
    STRONG
    HEALTHY
    CAUTIOUS
    WEAK
    CRITICAL
  }

  type SignalSummary {
    signalId: String!
    type: String!
    title: String!
    impact: String!
    confidence: Float!
    url: String
    sourceCount: Int!
    detail: String
    outputType: SignalOutputType!
  }

  type PositionInsight {
    symbol: String!
    name: String!
    rating: InsightRating!
    conviction: Float!
    thesis: String!
    keySignals: [SignalSummary!]!
    """
    All signal IDs for this ticker (7-day window). Deterministic — not LLM-selected.
    """
    allSignalIds: [String!]!
    risks: [String!]!
    opportunities: [String!]!
    memoryContext: String
    priceTarget: Float
    carriedForward: Boolean!
  }

  type PortfolioItem {
    text: String!
    signalIds: [String!]!
  }

  type PortfolioInsight {
    overallHealth: PortfolioHealth!
    summary: String!
    sectorThemes: [String!]!
    macroContext: String!
    topRisks: [PortfolioItem!]!
    topOpportunities: [PortfolioItem!]!
    actionItems: [PortfolioItem!]!
  }

  type EmotionState {
    confidence: Float!
    riskAppetite: Float!
    reason: String!
  }

  type InsightReport {
    id: ID!
    snapshotId: String!
    positions: [PositionInsight!]!
    portfolio: PortfolioInsight!
    emotionState: EmotionState!
    createdAt: String!
    durationMs: Float!
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

  type CliCommandStatus {
    command: String!
    available: Boolean!
  }

  # ---------------------------------------------------------------------------
  # Watchlist
  # ---------------------------------------------------------------------------

  type WatchlistEntry {
    symbol: String!
    name: String!
    assetClass: AssetClass!
    addedAt: String!
    price: Float
    change: Float
    changePercent: Float
    enrichedAt: String
  }

  type WatchlistResult {
    success: Boolean!
    error: String
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
    listDataSources: [DataSource!]!
    checkDataSourceHealth: [DataSource!]!
    checkCliCommands(commands: [String!]!): [CliCommandStatus!]!
    signals(
      type: String
      ticker: String
      sourceId: String
      since: String
      until: String
      search: String
      minConfidence: Float
      outputType: SignalOutputType
      limit: Int
    ): [Signal!]!
    signalGroups(ticker: String, since: String, limit: Int): [SignalGroup!]!
    signalGroup(id: ID!): SignalGroup
    vaultStatus: VaultStatus!
    listVaultSecrets: [VaultSecret!]!
    detectAiCredential: DetectedCredential
    detectKeychainToken: KeychainTokenResult!
    onboardingStatus: OnboardingStatusResult!
    sessions: [SessionSummary!]!
    session(id: ID!): SessionDetail
    activeSession: SessionSummary
    latestInsightReport: InsightReport
    insightReports(limit: Int): [InsightReport!]!
    insightReport(id: ID!): InsightReport
    watchlist: [WatchlistEntry!]!
    insightsWorkflowStatus: WorkflowStatus!
    briefingConfig: BriefingConfig
  }

  type Mutation {
    refreshPositions(platform: String!): PortfolioSnapshot!
    addManualPosition(input: ManualPositionInput!): PortfolioSnapshot!
    editPosition(symbol: String!, platform: String!, input: ManualPositionInput!): PortfolioSnapshot!
    removePosition(symbol: String!, platform: String!): PortfolioSnapshot!
    createAlert(rule: AlertRuleInput!): Alert!
    dismissAlert(id: ID!): Alert!
    sendMessage(threadId: String!, message: String!, imageBase64: String, imageMediaType: String): SendMessagePayload!
    createSession: SessionSummary!
    deleteSession(id: ID!): Boolean!
    connectPlatform(input: ConnectPlatformInput!): ConnectionResult!
    disconnectPlatform(platform: String!, removeCredentials: Boolean = false): ConnectionResult!
    fetchDataSource(id: String!, url: String): FetchResult!
    addDataSource(input: DataSourceInput!): DataSourceResult!
    removeDataSource(id: String!): DataSourceResult!
    toggleDataSource(id: String!, enabled: Boolean!): DataSourceResult!
    unlockVault(passphrase: String!): VaultResult!
    setVaultPassphrase(newPassphrase: String!): VaultResult!
    changeVaultPassphrase(currentPassphrase: String!, newPassphrase: String!): VaultResult!
    addVaultSecret(input: VaultSecretInput!): VaultResult!
    updateVaultSecret(input: VaultSecretInput!): VaultResult!
    deleteVaultSecret(key: String!): VaultResult!
    validateAiCredential(input: ValidateCredentialInput!): ValidateCredentialResult!
    startOAuthFlow: OAuthFlowResult!
    completeOAuthFlow(code: String!, state: String!): OAuthCompleteResult!
    sendMagicLink(email: String!): MagicLinkResult!
    completeMagicLink(magicLinkUrl: String!): MagicLinkVerifyResult!
    generatePersona(input: PersonaInput!): PersonaResult!
    confirmPersona(markdown: String!): Boolean!
    parsePortfolioScreenshot(input: ScreenshotInput!): ScreenshotResult!
    confirmPositions(input: ConfirmPositionsInput!): Boolean!
    saveBriefingConfig(input: BriefingConfigInput!): Boolean!
    completeOnboarding: Boolean!
    resetOnboarding: Boolean!
    validateJintelKey(apiKey: String!): ValidateJintelKeyResult!
    processInsights: InsightReport
    addToWatchlist(symbol: String!, name: String!, assetClass: AssetClass!): WatchlistResult!
    removeFromWatchlist(symbol: String!): WatchlistResult!
    clearAppData: Boolean!
  }

  # ---------------------------------------------------------------------------
  # Workflow Progress
  # ---------------------------------------------------------------------------

  type WorkflowStatus {
    running: Boolean!
    startedAt: String
  }

  type WorkflowProgressEvent {
    workflowId: String!
    stage: String!
    stageIndex: Int
    totalStages: Int
    agentIds: [String!]
    error: String
    message: String
    timestamp: String!
  }

  type Subscription {
    onAlert: Alert!
    onPortfolioUpdate: PortfolioSnapshot!
    onPriceMove(symbol: String!, threshold: Float!): PriceEvent!
    onChatMessage(threadId: String!): ChatEvent!
    onConnectionStatus(platform: String!): ConnectionEvent!
    onWorkflowProgress(workflowId: String!): WorkflowProgressEvent!
  }
`;
