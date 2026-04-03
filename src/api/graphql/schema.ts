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

  type PricePoint {
    date: String!
    open: Float!
    high: Float!
    low: Float!
    close: Float!
    volume: Float!
  }

  type TickerPriceHistory {
    ticker: String!
    history: [PricePoint!]!
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
    ACTION
  }

  type Signal {
    id: ID!
    type: SignalType!
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
    sentiment: SignalSentiment
    outputType: SignalOutputType!
    groupId: String
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
  # Actions (approval workflow)
  # ---------------------------------------------------------------------------

  enum ActionStatus {
    PENDING
    APPROVED
    REJECTED
    EXPIRED
  }

  type Action {
    id: ID!
    signalId: String
    skillId: String
    what: String!
    why: String!
    source: String!
    riskContext: String
    status: ActionStatus!
    expiresAt: String!
    createdAt: String!
    resolvedAt: String
    resolvedBy: String
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

  type OAuthCompleteResult {
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
  }

  type BriefingConfig {
    time: String!
    timezone: String!
    sections: [String!]!
    enabled: Boolean!
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

  type ChannelResult {
    success: Boolean!
    error: String
  }

  enum PairingStatusCode {
    WAITING_FOR_SCAN
    CONNECTED
    FAILED
    EXPIRED
  }

  type PairingResult {
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

  type ValidateJintelKeyResult {
    success: Boolean!
    error: String
  }

  # ---------------------------------------------------------------------------
  # Insights
  # ---------------------------------------------------------------------------

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
    signalId: String!
    type: SignalType!
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
    ticker: String!
    category: String!
    observation: String!
    evidence: String!
    insightReportId: String!
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
    ticker: String!
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
    enrichedAt: String
  }

  type WatchlistResult {
    success: Boolean!
    error: String
  }

  # ---------------------------------------------------------------------------
  # Signal Curation
  # ---------------------------------------------------------------------------

  type PortfolioRelevanceScore {
    ticker: String!
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
    signalId: String!
    ticker: String!
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
  # Skills
  # ---------------------------------------------------------------------------

  enum SkillCategory {
    RISK
    PORTFOLIO
    MARKET
    RESEARCH
  }

  type SkillTrigger {
    type: String!
    description: String!
  }

  type Skill {
    id: ID!
    name: String!
    description: String!
    category: SkillCategory!
    active: Boolean!
    source: String!
    createdBy: String!
    createdAt: String!
    triggers: [SkillTrigger!]!
    tickers: [String!]!
  }

  # ---------------------------------------------------------------------------
  # Activity Log
  # ---------------------------------------------------------------------------

  enum ActivityEventType {
    TRADE
    SYSTEM
    ACTION
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
    priceHistory(tickers: [String!]!, range: String, interval: String): [TickerPriceHistory!]!
    listConnections: [Connection!]!
    detectAvailableTiers(platform: String!): [TierAvailability!]!
    listDataSources: [DataSource!]!
    checkDataSourceHealth: [DataSource!]!
    checkCliCommands(commands: [String!]!): [CliCommandStatus!]!
    signals(
      type: SignalType
      ticker: String
      sourceId: String
      since: String
      until: String
      search: String
      minConfidence: Float
      outputType: SignalOutputType
      limit: Int
    ): [Signal!]!
    signalsByIds(ids: [ID!]!): [Signal!]!
    signalGroups(ticker: String, since: String, limit: Int): [SignalGroup!]!
    curatedSignals(ticker: String, since: String, limit: Int, offset: Int, feedTarget: FeedTarget): [CuratedSignal!]!
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
    listChannels: [Channel!]!
    notificationPreferences: [NotificationPreferences!]!
    snap: Snap
    activityLog(types: [ActivityEventType!], since: String, limit: Int): [ActivityEvent!]!
    actions(status: ActionStatus, since: String, limit: Int): [Action!]!
    action(id: ID!): Action
    skills(category: SkillCategory, active: Boolean): [Skill!]!
    skill(id: ID!): Skill
    tickerProfile(ticker: String!): TickerProfile
    tickerProfiles(tickers: [String!]!): [TickerProfile!]!
    microInsight(symbol: String!): MicroInsight
    microInsights: [MicroInsight!]!
    aiConfig: AiConfig!
  }

  type AiConfig {
    defaultModel: String!
    defaultProvider: String!
  }

  input AiConfigInput {
    defaultModel: String!
    defaultProvider: String
  }

  type Mutation {
    refreshPositions(platform: String!): PortfolioSnapshot!
    addManualPosition(input: ManualPositionInput!): PortfolioSnapshot!
    editPosition(symbol: String!, platform: String!, input: ManualPositionInput!): PortfolioSnapshot!
    removePosition(symbol: String!, platform: String!): PortfolioSnapshot!
    createAlert(rule: AlertRuleInput!): Alert!
    dismissAlert(id: ID!): Alert!
    dismissSignal(signalId: ID!): Boolean!
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
    startOAuthFlow: OAuthFlowResult!
    completeOAuthFlow(code: String!, state: String!): OAuthCompleteResult!
    sendMagicLink(email: String!): MagicLinkResult!
    completeMagicLink(magicLinkUrl: String!): MagicLinkVerifyResult!
    generatePersona(input: PersonaInput!): PersonaResult!
    confirmPersona(markdown: String!): Boolean!
    parsePortfolioScreenshot(input: ScreenshotInput!): ScreenshotResult!
    confirmPositions(input: ConfirmPositionsInput!): Boolean!
    saveBriefingConfig(input: BriefingConfigInput!): Boolean!
    connectChannel(id: ID!, credentials: [CredentialInput!]!): ChannelResult!
    disconnectChannel(id: ID!): ChannelResult!
    validateChannelToken(id: ID!, credentials: [CredentialInput!]!): ChannelResult!
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
    toggleSkill(id: ID!, active: Boolean!): Skill!
    clearAppData: Boolean!
    saveAiConfig(input: AiConfigInput!): AiConfig!
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
    onChannelPairing(id: ID!): PairingEvent!
  }
`;
