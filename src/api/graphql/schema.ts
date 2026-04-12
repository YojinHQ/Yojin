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

  enum SignalType {
    NEWS
    FUNDAMENTAL
    SENTIMENT
    TECHNICAL
    MACRO
    FILINGS
    SOCIALS
    REGULATORY
    TRADING_LOGIC_TRIGGER
  }

  enum SignalSentiment {
    BULLISH
    BEARISH
    MIXED
    NEUTRAL
  }

  enum SourceType {
    API
    RSS
    SCRAPER
    ENRICHMENT
  }

  enum SignalVerdict {
    CRITICAL
    IMPORTANT
    NOISE
  }

  enum SignalSeverity {
    CRITICAL
    HIGH
    MEDIUM
    LOW
  }

  enum ThesisAlignment {
    SUPPORTS
    CHALLENGES
    NEUTRAL
  }

  enum FeedTarget {
    PORTFOLIO
    WATCHLIST
  }

  # ---------------------------------------------------------------------------
  # Interfaces
  # ---------------------------------------------------------------------------

  """
  Common fields for mutation results.
  """
  interface MutationResult {
    success: Boolean!
    error: String
  }

  # ---------------------------------------------------------------------------
  # Shared inputs
  # ---------------------------------------------------------------------------

  input KeyValueInput {
    key: String!
    value: String!
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
    preMarketChange: Float
    preMarketChangePercent: Float
    postMarketChange: Float
    postMarketChangePercent: Float
    sparkline: [Float!]
    sector: String
    assetClass: AssetClass!
    platform: String!
    entryDate: String
  }

  type PortfolioSnapshot {
    id: ID!
    positions: [Position!]!
    totalValue: Float!
    totalCost: Float!
    totalPnl: Float!
    totalPnlPercent: Float!
    totalDayChange: Float!
    totalDayChangePercent: Float!
    timestamp: String!
    platform: String
    """
    Warnings from live quote enrichment (e.g. rate limit exceeded).
    """
    warnings: [String!]!
    """
    Nested: historical portfolio values (delegates to PortfolioSnapshotStore).
    Optional days param limits the lookback window (e.g. 7, 30, 90).
    """
    history(days: Int): [PortfolioHistoryPoint!]!
    """
    Nested: sector allocation breakdown (computed from positions).
    """
    sectorExposure: [SectorWeight!]!
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
    name: String
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

  type SymbolSearchResult {
    symbol: String!
    name: String!
    assetClass: AssetClass!
  }

  type PricePoint {
    date: String!
    open: Float!
    high: Float!
    low: Float!
    close: Float!
    volume: Float!
  }

  type TickerPriceHistory {
    ticker: ID!
    history: [PricePoint!]!
  }

  type USMarketStatus {
    isOpen: Boolean!
    isTradingDay: Boolean!
    session: MarketSession!
    holiday: String
    date: String!
  }

  enum MarketSession {
    PRE_MARKET
    OPEN
    AFTER_HOURS
    CLOSED
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
    threadId: ID!
    role: ChatRole!
    content: String!
    timestamp: String!
    toolCards: [ToolCardRef!]
  }

  type ChatEvent {
    type: ChatEventType!
    threadId: ID!
    delta: String
    accumulatedText: String
    messageId: ID
    content: String
    error: String
    toolName: String
    piiTypesFound: [String!]
    toolCard: ToolCardRef
  }

  type SendMessagePayload {
    threadId: ID!
    messageId: ID!
  }

  type SessionSummary {
    id: ID!
    threadId: ID!
    title: String!
    createdAt: String!
    lastMessageAt: String
    messageCount: Int!
  }

  type SessionDetail {
    id: ID!
    threadId: ID!
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
    entryDate: String
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
    credentials: [KeyValueInput!]
  }

  type ConnectionResult implements MutationResult {
    success: Boolean!
    error: String
    connection: Connection
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

  type VaultResult implements MutationResult {
    success: Boolean!
    error: String
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
    id: ID!
    description: String
  }

  type DataSource {
    id: ID!
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

  type DataSourceResult implements MutationResult {
    success: Boolean!
    error: String
    dataSource: DataSource
  }

  type FetchResult {
    success: Boolean!
    signalsIngested: Int!
    duplicates: Int!
    error: String
  }

  type RefreshIntelFeedResult {
    signalsFetched: Int!
    signalsCurated: Int!
    error: String
  }

  # ---------------------------------------------------------------------------
  # Signals
  # ---------------------------------------------------------------------------

  type SignalSource {
    id: ID!
    name: String!
    type: SourceType!
    reliability: Float!
  }

  enum SignalOutputType {
    INSIGHT
    ALERT
    SUMMARY
  }

  type Signal {
    id: ID!
    type: SignalType!
    title: String!
    content: String
    publishedAt: String!
    ingestedAt: String!
    confidence: Float!
    contentHash: ID!
    tickers: [String!]!
    sources: [SignalSource!]!
    sourceCount: Int!
    link: String
    tier1: String
    tier2: String
    sentiment: SignalSentiment
    outputType: SignalOutputType!
    groupId: ID
    version: Int!
  }

  type SignalGroup {
    id: ID!
    signals: [Signal!]!
    tickers: [String!]!
    summary: String!
    outputType: SignalOutputType!
    firstEventAt: String!
    lastEventAt: String!
  }

  # ---------------------------------------------------------------------------
  # Summaries — neutral intel observations from macro + micro insight pipelines
  # ---------------------------------------------------------------------------

  enum SummaryFlow {
    MACRO
    MICRO
  }

  type SummarySourceSignal {
    id: ID!
    type: SignalType!
    title: String!
    link: String
    sourceName: String
  }

  type Summary {
    id: ID!
    ticker: String!
    what: String!
    flow: SummaryFlow!
    severity: Float
    severityLabel: String!
    sourceSignalIds: [ID!]!
    sourceSignals: [SummarySourceSignal!]!
    contentHash: String!
    createdAt: String!
  }

  # ---------------------------------------------------------------------------
  # Actions — BUY/SELL/REVIEW outcomes from Strategy/Strategy triggers
  # ---------------------------------------------------------------------------

  enum ActionVerdict {
    BUY
    SELL
    TRIM
    HOLD
    REVIEW
  }

  enum ActionStatus {
    PENDING
    APPROVED
    REJECTED
    EXPIRED
  }

  type Action {
    id: ID!
    strategyId: ID!
    strategyName: String!
    triggerId: ID!
    triggerType: String!
    verdict: ActionVerdict!
    what: String!
    why: String!
    tickers: [String!]!
    riskContext: String
    severity: Float
    severityLabel: String!
    status: ActionStatus!
    expiresAt: String!
    createdAt: String!
    resolvedAt: String
    resolvedBy: String
    dismissedAt: String
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

  type DetectedCredential {
    method: String!
    model: String
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

  type OAuthCompleteResult implements MutationResult {
    success: Boolean!
    error: String
    model: String
  }

  type MagicLinkResult implements MutationResult {
    success: Boolean!
    error: String
  }

  type MagicLinkVerifyResult implements MutationResult {
    success: Boolean!
    error: String
    model: String
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

  type ScreenshotResult implements MutationResult {
    success: Boolean!
    error: String
    positions: [ExtractedPositionGql!]
    confidence: Float
    warnings: [String!]
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
    microLlmIntervalHours: Int
  }

  type BriefingConfig {
    time: String!
    timezone: String!
    sections: [String!]!
    enabled: Boolean!
    microLlmIntervalHours: Int!
  }

  type SchedulerAssetStatus {
    symbol: String!
    source: String!
    lastSignalFetchAt: String
    lastLlmAt: String
    nextLlmEligibleAt: String!
    pendingAnalysis: Boolean!
  }

  type SchedulerStatus {
    microLlmIntervalHours: Float!
    pendingCount: Int!
    throttledCount: Int!
    assets: [SchedulerAssetStatus!]!
  }

  enum ChannelStatus {
    CONNECTED
    NOT_CONNECTED
    ERROR
  }

  type Channel {
    id: ID!
    name: String!
    status: ChannelStatus!
    statusMessage: String
    description: String
    requiredCredentials: [String!]!
  }

  type ChannelResult implements MutationResult {
    success: Boolean!
    error: String
  }

  enum PairingStatusCode {
    WAITING_FOR_SCAN
    CONNECTED
    FAILED
    EXPIRED
  }

  type PairingResult implements MutationResult {
    success: Boolean!
    error: String
    qrData: String
  }

  type PairingEvent {
    status: PairingStatusCode!
    qrData: String
    error: String
  }

  type NotificationPreferences {
    channelId: ID!
    enabledTypes: [String!]!
  }

  type OnboardingStatusResult {
    completed: Boolean!
    personaExists: Boolean!
    aiCredentialConfigured: Boolean!
    connectedPlatforms: [String!]!
    briefingConfigured: Boolean!
    jintelConfigured: Boolean!
  }

  type ValidateJintelKeyResult implements MutationResult {
    success: Boolean!
    error: String
  }

  # ---------------------------------------------------------------------------
  # Insights
  # ---------------------------------------------------------------------------

  enum SignalImpact {
    POSITIVE
    NEGATIVE
    NEUTRAL
  }

  enum InsightRating {
    VERY_BULLISH
    BULLISH
    NEUTRAL
    BEARISH
    VERY_BEARISH
  }

  enum PortfolioHealth {
    STRONG
    HEALTHY
    CAUTIOUS
    WEAK
    CRITICAL
  }

  type SignalSummary {
    signalId: ID!
    type: SignalType!
    title: String!
    impact: SignalImpact!
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
    snapshotId: ID!
    positions: [PositionInsight!]!
    portfolio: PortfolioInsight!
    emotionState: EmotionState!
    createdAt: String!
    durationMs: Float!
  }

  # ---------------------------------------------------------------------------
  # Snap (Strategist brief)
  # ---------------------------------------------------------------------------

  type SnapActionItem {
    text: String!
    signalIds: [String!]!
  }

  type AssetSnap {
    symbol: String!
    snap: String!
    rating: String!
    generatedAt: String!
  }

  type Snap {
    id: ID!
    generatedAt: String!
    intelSummary: String!
    actionItems: [SnapActionItem!]!
    assetSnaps: [AssetSnap!]!
  }

  # ---------------------------------------------------------------------------
  # Micro Research (per-asset AI analysis)
  # ---------------------------------------------------------------------------

  type MicroInsight {
    id: ID!
    symbol: String!
    name: String!
    source: String!
    rating: InsightRating!
    conviction: Float!
    thesis: String!
    keyDevelopments: [String!]!
    risks: [String!]!
    opportunities: [String!]!
    sentiment: SignalSentiment!
    signalCount: Int!
    topSignalIds: [String!]!
    assetSnap: String!
    assetActions: [String!]!
    generatedAt: String!
    durationMs: Int!
  }

  # ---------------------------------------------------------------------------
  # Ticker Profiles (per-asset institutional knowledge)
  # ---------------------------------------------------------------------------

  type TickerProfileEntry {
    id: ID!
    ticker: ID!
    category: String!
    observation: String!
    evidence: String!
    insightReportId: ID!
    insightDate: String!
    rating: String
    conviction: Float
    priceAtObservation: Float
    grade: String
    actualReturn: Float
    createdAt: String!
  }

  type TickerProfileBrief {
    entryCount: Int!
    recentPatterns: [String!]!
    recentLessons: [String!]!
    correlations: [String!]!
    sentimentHistory: [SentimentPoint!]!
  }

  type SentimentPoint {
    date: String!
    rating: String!
    conviction: Float!
  }

  type TickerProfile {
    ticker: ID!
    entryCount: Int!
    entries: [TickerProfileEntry!]!
    brief: TickerProfileBrief!
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
    periodPnl: Float!
    periodPnlPercent: Float!
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
    preMarketPrice: Float
    preMarketChange: Float
    preMarketChangePercent: Float
    postMarketPrice: Float
    postMarketChange: Float
    postMarketChangePercent: Float
    sparkline: [Float!]
    enrichedAt: String
  }

  type WatchlistResult implements MutationResult {
    success: Boolean!
    error: String
  }

  # ---------------------------------------------------------------------------
  # Signal Curation
  # ---------------------------------------------------------------------------

  type PortfolioRelevanceScore {
    ticker: ID!
    compositeScore: Float!
  }

  type CuratedSignal {
    signal: Signal!
    scores: [PortfolioRelevanceScore!]!
    feedTarget: FeedTarget!
    "Derived severity for ranking and feed presentation"
    severity: SignalSeverity!
    "Agent assessment summary — null if not yet assessed"
    assessment: CuratedSignalAssessment
    "Cross-source convergence boost (0–1) — higher when multiple platforms discuss the same ticker"
    convergenceBoost: Float!
    "Normalized engagement score (0–1) from source-specific metrics (likes, views, points, etc.)"
    engagementScore: Float!
  }

  type CuratedSignalAssessment {
    verdict: SignalVerdict!
    thesisAlignment: ThesisAlignment!
    actionability: Float!
  }

  type CurationStatus {
    lastRunAt: String
    signalsProcessed: Int!
    signalsCurated: Int!
  }

  # ---------------------------------------------------------------------------
  # Signal Assessment (Tier 2)
  # ---------------------------------------------------------------------------

  type SignalAssessment {
    signalId: ID!
    ticker: ID!
    verdict: SignalVerdict!
    relevanceScore: Float!
    reasoning: String!
    thesisAlignment: ThesisAlignment!
    actionability: Float!
  }

  type AssessmentReport {
    id: ID!
    assessedAt: String!
    tickers: [String!]!
    assessments: [SignalAssessment!]!
    signalsInput: Int!
    signalsKept: Int!
    thesisSummary: String!
    durationMs: Float!
  }

  type AssessmentStatus {
    lastRunAt: String
    signalsAssessed: Int!
    signalsKept: Int!
  }

  # ---------------------------------------------------------------------------
  # Strategies
  # ---------------------------------------------------------------------------

  enum StrategyCategory {
    RISK
    PORTFOLIO
    MARKET
    RESEARCH
  }

  enum DataCapability {
    MARKET_DATA
    TECHNICALS
    NEWS
    RESEARCH
    SENTIMENT
    FUNDAMENTALS
    FILINGS
    DERIVATIVES
    PORTFOLIO
    MACRO_DATA
  }

  type StrategyTrigger {
    type: String!
    description: String!
    params: String
  }

  type Strategy {
    id: ID!
    name: String!
    description: String!
    category: StrategyCategory!
    style: String!
    requires: [DataCapability!]!
    active: Boolean!
    source: String!
    createdBy: String!
    createdAt: String!
    content: String!
    triggers: [StrategyTrigger!]!
    maxPositionSize: Float
    tickers: [String!]!
  }

  input StrategyTriggerInput {
    type: String!
    description: String!
    params: String
  }

  input CreateStrategyInput {
    name: String!
    description: String!
    category: StrategyCategory!
    style: String!
    requires: [DataCapability!]
    content: String!
    triggers: [StrategyTriggerInput!]!
    tickers: [String!]
    maxPositionSize: Float
  }

  input UpdateStrategyInput {
    name: String
    description: String
    category: StrategyCategory
    style: String
    requires: [DataCapability!]
    content: String
    triggers: [StrategyTriggerInput!]
    tickers: [String!]
    maxPositionSize: Float
  }

  # ---------------------------------------------------------------------------
  # Strategy Sources
  # ---------------------------------------------------------------------------

  type StrategySource {
    id: ID!
    owner: String!
    repo: String!
    path: String!
    ref: String!
    enabled: Boolean!
    lastSyncedAt: String
    label: String
    isDefault: Boolean!
  }

  type StrategySyncResult {
    added: Int!
    skipped: Int!
    failed: Int!
    errors: [String!]!
  }

  # ---------------------------------------------------------------------------
  # Activity Log
  # ---------------------------------------------------------------------------

  enum ActivityEventType {
    TRADE
    SYSTEM
    SUMMARY
    ALERT
    INSIGHT
  }

  type ActivityEvent {
    id: ID!
    type: ActivityEventType!
    message: String!
    timestamp: String!
    ticker: String
    metadata: String
  }

  type Query {
    deviceInfo: DeviceInfo!
    portfolio: PortfolioSnapshot
    riskReport: RiskReport
    alerts(status: AlertStatus): [Alert!]!
    news(symbol: String, limit: Int): [Article!]!
    quote(symbol: String!): Quote
    searchSymbols(query: String!, limit: Int): [SymbolSearchResult!]!
    priceHistory(tickers: [String!]!, range: String, interval: String): [TickerPriceHistory!]!
    marketStatus: USMarketStatus!
    listConnections: [Connection!]!
    detectAvailableTiers(platform: String!): [TierAvailability!]!
    listDataSources: [DataSource!]!
    checkDataSourceHealth: [DataSource!]!
    checkCliCommands(commands: [String!]!): [CliCommandStatus!]!
    signalsByIds(ids: [ID!]!): [Signal!]!
    signalGroups(ticker: String, since: String, limit: Int): [SignalGroup!]!
    curatedSignals(
      ticker: String
      since: String
      until: String
      type: SignalType
      search: String
      minConfidence: Float
      outputType: SignalOutputType
      sourceId: String
      limit: Int
      offset: Int
      feedTarget: FeedTarget
    ): [CuratedSignal!]!
    curationStatus: CurationStatus!
    curationWorkflowStatus: WorkflowStatus!
    signalAssessments(ticker: String, since: String, limit: Int): [AssessmentReport!]!
    assessmentStatus: AssessmentStatus!
    signalGroup(id: ID!): SignalGroup
    vaultStatus: VaultStatus!
    listVaultSecrets: [VaultSecret!]!
    detectAiCredential: DetectedCredential
    detectKeychainToken: KeychainTokenResult!
    detectCodexToken: KeychainTokenResult!
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
    schedulerStatus: SchedulerStatus!
    listChannels: [Channel!]!
    notificationPreferences: [NotificationPreferences!]!
    snap: Snap
    activityLog(types: [ActivityEventType!], since: String, limit: Int): [ActivityEvent!]!
    summaries(ticker: String, flow: SummaryFlow, since: String, limit: Int): [Summary!]!
    summary(id: ID!): Summary
    actions(status: ActionStatus, since: String, limit: Int, dismissed: Boolean): [Action!]!
    action(id: ID!): Action
    strategies(category: StrategyCategory, active: Boolean, style: String, query: String): [Strategy!]!
    strategy(id: ID!): Strategy
    exportStrategy(id: ID!): String!
    strategySources: [StrategySource!]!
    tickerProfile(ticker: String!): TickerProfile
    tickerProfiles(tickers: [String!]!): [TickerProfile!]!
    microInsight(symbol: String!): MicroInsight
    microInsights: [MicroInsight!]!
    aiConfig: AiConfig!
  }

  type AiConfig {
    defaultModel: String!
    defaultProvider: String!
    hasAnthropicKey: Boolean!
    hasAnthropicApiKey: Boolean!
    hasOpenaiKey: Boolean!
  }

  input AiConfigInput {
    defaultModel: String!
    defaultProvider: String
  }

  type SaveAiCredentialResult {
    success: Boolean!
    error: String
  }

  type Mutation {
    refreshPositions(platform: String!): PortfolioSnapshot!
    addManualPosition(input: ManualPositionInput!): PortfolioSnapshot!
    editPosition(symbol: String!, platform: String!, input: ManualPositionInput!): PortfolioSnapshot!
    removePosition(symbol: String!, platform: String!): PortfolioSnapshot!
    createAlert(rule: AlertRuleInput!): Alert!
    dismissAlert(id: ID!): Alert!
    dismissSignal(signalId: ID!): Boolean!
    batchDismissSignals(signalIds: [ID!]!): Boolean!
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
    addVaultSecret(input: KeyValueInput!): VaultResult!
    updateVaultSecret(input: KeyValueInput!): VaultResult!
    deleteVaultSecret(key: String!): VaultResult!
    startOAuthFlow: OAuthFlowResult!
    completeOAuthFlow(code: String!, state: String!): OAuthCompleteResult!
    sendMagicLink(email: String!): MagicLinkResult!
    completeMagicLink(magicLinkUrl: String!): MagicLinkVerifyResult!
    generatePersona(input: PersonaInput!): PersonaResult!
    confirmPersona(markdown: String!): Boolean!
    parsePortfolioScreenshot(input: ScreenshotInput!): ScreenshotResult!
    confirmPositions(input: ConfirmPositionsInput!): Boolean!
    saveBriefingConfig(input: BriefingConfigInput!): Boolean!
    connectChannel(id: ID!, credentials: [KeyValueInput!]!): ChannelResult!
    disconnectChannel(id: ID!): ChannelResult!
    validateChannelToken(id: ID!, credentials: [KeyValueInput!]!): ChannelResult!
    initiateChannelPairing(id: ID!): PairingResult!
    cancelChannelPairing(id: ID!): ChannelResult!
    saveNotificationPreferences(channelId: ID!, enabledTypes: [String!]!): Boolean!
    completeOnboarding: Boolean!
    resetOnboarding: Boolean!
    validateJintelKey(apiKey: String!): ValidateJintelKeyResult!
    processInsights: InsightReport
    runFullCuration: Boolean!
    refreshIntelFeed: RefreshIntelFeedResult!
    addToWatchlist(symbol: String!, name: String!, assetClass: AssetClass!): WatchlistResult!
    removeFromWatchlist(symbol: String!): WatchlistResult!
    approveAction(id: ID!): Action!
    rejectAction(id: ID!): Action!
    dismissAction(id: ID!): Action!
    toggleStrategy(id: ID!, active: Boolean!): Strategy!
    createStrategy(input: CreateStrategyInput!): Strategy!
    updateStrategy(id: ID!, input: UpdateStrategyInput!): Strategy!
    deleteStrategy(id: ID!): Boolean!
    importStrategy(markdown: String!): Strategy!
    addStrategySource(url: String!): StrategySource!
    removeStrategySource(id: ID!): Boolean!
    toggleStrategySource(id: ID!, enabled: Boolean!): StrategySource!
    syncStrategies: StrategySyncResult!
    syncStrategySource(id: ID!): StrategySyncResult!
    clearAppData: Boolean!
    saveAiConfig(input: AiConfigInput!): AiConfig!
    saveAiCredential(provider: String!, apiKey: String!): SaveAiCredentialResult!
    removeAiCredential(provider: String!): SaveAiCredentialResult!
    triggerMicroAnalysis: Boolean!
    triggerStrategyEvaluation: Boolean!
  }

  # ---------------------------------------------------------------------------
  # Workflow Progress
  # ---------------------------------------------------------------------------

  type WorkflowStatus {
    running: Boolean!
    startedAt: String
  }

  type WorkflowProgressEvent {
    workflowId: ID!
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
    onChannelPairing(id: ID!): PairingEvent!
  }
`;
