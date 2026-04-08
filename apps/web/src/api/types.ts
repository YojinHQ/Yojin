/**
 * Client-side TypeScript types mirroring the GraphQL schema.
 *
 * These represent the shapes returned by the GraphQL API over the wire.
 * Kept in sync with `src/api/graphql/schema.ts` on the backend.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type AssetClass = 'EQUITY' | 'CRYPTO' | 'BOND' | 'COMMODITY' | 'CURRENCY' | 'OTHER';

/** Platforms with first-class support (branding, credentials, connectors). */
export const KNOWN_PLATFORMS = [
  'INTERACTIVE_BROKERS',
  'ROBINHOOD',
  'COINBASE',
  'SCHWAB',
  'BINANCE',
  'FIDELITY',
  'POLYMARKET',
  'PHANTOM',
  'METAMASK',
  'WEBULL',
  'SOFI',
  'MOOMOO',
  'MANUAL',
] as const;

export type KnownPlatform = (typeof KNOWN_PLATFORMS)[number];

/** A known platform or any custom string (e.g. "Alpaca", "OKX"). */
export type Platform = KnownPlatform | (string & {});

/** Type guard — true for first-class platforms, false for custom strings. */
export function isKnownPlatform(value: string): value is KnownPlatform {
  return (KNOWN_PLATFORMS as readonly string[]).includes(value);
}
export type AlertStatus = 'ACTIVE' | 'TRIGGERED' | 'DISMISSED';
export type AlertRuleType =
  | 'PRICE_MOVE'
  | 'SENTIMENT_SHIFT'
  | 'EARNINGS_PROXIMITY'
  | 'CONCENTRATION_DRIFT'
  | 'CORRELATION_WARNING';
export type Direction = 'UP' | 'DOWN' | 'BOTH';

export type SignalType =
  | 'NEWS'
  | 'FUNDAMENTAL'
  | 'SENTIMENT'
  | 'TECHNICAL'
  | 'MACRO'
  | 'FILINGS'
  | 'SOCIALS'
  | 'TRADING_LOGIC_TRIGGER';
export type SignalSentiment = 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL';
export type SourceType = 'API' | 'RSS' | 'SCRAPER' | 'ENRICHMENT';
export type SignalVerdict = 'CRITICAL' | 'IMPORTANT' | 'NOISE';
export type SignalImpact = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
export type ThesisAlignment = 'SUPPORTS' | 'CHALLENGES' | 'NEUTRAL';
export type FeedTarget = 'PORTFOLIO' | 'WATCHLIST';

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export type ChannelStatus = 'CONNECTED' | 'NOT_CONNECTED' | 'ERROR';

export interface Channel {
  id: string;
  name: string;
  status: ChannelStatus;
  statusMessage: string | null;
  description: string | null;
  requiredCredentials: string[];
}

export interface ChannelResult {
  success: boolean;
  error?: string;
}

export interface NotificationPreferences {
  channelId: string;
  enabledTypes: string[];
}

export type PairingStatusCode = 'WAITING_FOR_SCAN' | 'CONNECTED' | 'FAILED' | 'EXPIRED';

export interface PairingResult {
  success: boolean;
  error?: string;
  qrData?: string;
}

export interface PairingEvent {
  status: PairingStatusCode;
  qrData?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Activity Log
// ---------------------------------------------------------------------------

export type ActivityEventType = 'TRADE' | 'SYSTEM' | 'ACTION' | 'ALERT' | 'INSIGHT';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  message: string;
  timestamp: string;
  ticker: string | null;
  metadata: string | null;
}

export interface ActivityLogQueryResult {
  activityLog: ActivityEvent[];
}

export interface ActivityLogQueryVariables {
  types?: ActivityEventType[];
  since?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export interface Position {
  symbol: string;
  name: string;
  quantity: number;
  costBasis: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  dayChange: number | null;
  dayChangePercent: number | null;
  preMarketChange: number | null;
  preMarketChangePercent: number | null;
  postMarketChange: number | null;
  postMarketChangePercent: number | null;
  sparkline: number[] | null;
  sector: string | null;
  assetClass: AssetClass;
  platform: Platform;
  entryDate: string | null;
}

export interface PortfolioSnapshot {
  id: string;
  positions: Position[];
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPercent: number;
  totalDayChange: number;
  totalDayChangePercent: number;
  timestamp: string;
  platform: Platform | null;
  warnings: string[];
  history: PortfolioHistoryPoint[];
  sectorExposure: SectorWeight[];
}

export interface PortfolioHistoryPoint {
  timestamp: string;
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPercent: number;
  periodPnl: number;
  periodPnlPercent: number;
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export interface SectorWeight {
  sector: string;
  weight: number;
  value: number;
}

export interface Concentration {
  symbol: string;
  weight: number;
}

export interface CorrelationCluster {
  symbols: string[];
  correlation: number;
}

export interface RiskReport {
  id: string;
  portfolioValue: number;
  sectorExposure: SectorWeight[];
  concentrationScore: number;
  topConcentrations: Concentration[];
  correlationClusters: CorrelationCluster[];
  maxDrawdown: number;
  valueAtRisk: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export interface AlertRule {
  type: AlertRuleType;
  symbol: string | null;
  threshold: number | null;
  direction: Direction | null;
}

export interface Alert {
  id: string;
  rule: AlertRule;
  status: AlertStatus;
  message: string;
  triggeredAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

export interface AlertRuleInput {
  type: AlertRuleType;
  symbol?: string;
  threshold?: number;
  direction?: Direction;
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export interface Quote {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  timestamp: string;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  assetClass: AssetClass;
}

export interface SearchSymbolsQueryResult {
  searchSymbols: SymbolSearchResult[];
}

export interface SearchSymbolsQueryVariables {
  query: string;
  limit?: number;
}

export interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickerPriceHistory {
  ticker: string;
  history: PricePoint[];
}

export interface PriceHistoryQueryResult {
  priceHistory: TickerPriceHistory[];
}

export interface PriceHistoryQueryVariables {
  tickers: string[];
  range?: string;
  interval?: string;
}

export type MarketSession = 'PRE_MARKET' | 'OPEN' | 'AFTER_HOURS' | 'CLOSED';

export interface USMarketStatus {
  isOpen: boolean;
  isTradingDay: boolean;
  session: MarketSession;
  holiday: string | null;
  date: string;
}

export interface MarketStatusQueryResult {
  marketStatus: USMarketStatus;
}

export interface Article {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  summary: string | null;
  symbols: string[];
  sentiment: number | null;
}

// ---------------------------------------------------------------------------
// Device Identity
// ---------------------------------------------------------------------------

export interface DeviceInfo {
  deviceId: string;
  shortId: string;
  createdAt: string;
}

export interface DeviceInfoQueryResult {
  deviceInfo: DeviceInfo;
}

// ---------------------------------------------------------------------------
// Connections / Onboarding
// ---------------------------------------------------------------------------

export type IntegrationTier = 'CLI' | 'API' | 'UI' | 'SCREENSHOT';
export type ConnectionStatus = 'PENDING' | 'VALIDATING' | 'CONNECTED' | 'ERROR' | 'DISCONNECTED';

export interface Connection {
  platform: Platform;
  tier: IntegrationTier;
  status: ConnectionStatus;
  lastSync: string | null;
  lastError: string | null;
  syncInterval: number;
  autoRefresh: boolean;
}

export interface TierAvailability {
  tier: IntegrationTier;
  available: boolean;
  requiresCredentials: string[];
}

export interface ConnectionResult {
  success: boolean;
  connection: Connection | null;
  error: string | null;
}

export interface ConnectionEvent {
  platform: string;
  step: string;
  message: string;
  tier: IntegrationTier | null;
  error: string | null;
}

export interface ConnectPlatformInput {
  platform: string;
  tier?: IntegrationTier;
  credentials?: { key: string; value: string }[];
}

// ---------------------------------------------------------------------------
// Onboarding Status
// ---------------------------------------------------------------------------

export interface OnboardingStatus {
  completed: boolean;
  personaExists: boolean;
  aiCredentialConfigured: boolean;
  connectedPlatforms: string[];
  briefingConfigured: boolean;
  jintelConfigured: boolean;
}

export interface ValidateJintelKeyResult {
  success: boolean;
  error?: string;
}

export interface ValidateJintelKeyMutationResult {
  validateJintelKey: ValidateJintelKeyResult;
}

export interface OnboardingStatusQueryResult {
  onboardingStatus: OnboardingStatus;
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export interface VaultStatus {
  isUnlocked: boolean;
  hasPassphrase: boolean;
  secretCount: number;
}

export interface VaultSecret {
  key: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultResult {
  success: boolean;
  error: string | null;
}

export interface KeyValueInput {
  key: string;
  value: string;
}

export interface VaultStatusQueryResult {
  vaultStatus: VaultStatus;
}

export interface ListVaultSecretsQueryResult {
  listVaultSecrets: VaultSecret[];
}

export interface UnlockVaultMutationResult {
  unlockVault: VaultResult;
}

export interface UnlockVaultVariables {
  passphrase: string;
}

export interface SetVaultPassphraseMutationResult {
  setVaultPassphrase: VaultResult;
}

export interface SetVaultPassphraseVariables {
  newPassphrase: string;
}

export interface ChangeVaultPassphraseMutationResult {
  changeVaultPassphrase: VaultResult;
}

export interface ChangeVaultPassphraseVariables {
  currentPassphrase: string;
  newPassphrase: string;
}

export interface AddVaultSecretMutationResult {
  addVaultSecret: VaultResult;
}

export interface AddVaultSecretVariables {
  input: KeyValueInput;
}

export interface UpdateVaultSecretMutationResult {
  updateVaultSecret: VaultResult;
}

export interface UpdateVaultSecretVariables {
  input: KeyValueInput;
}

export interface DeleteVaultSecretMutationResult {
  deleteVaultSecret: VaultResult;
}

export interface DeleteVaultSecretVariables {
  key: string;
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export interface WatchlistEntry {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  addedAt: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  preMarketPrice: number | null;
  preMarketChange: number | null;
  preMarketChangePercent: number | null;
  postMarketPrice: number | null;
  postMarketChange: number | null;
  postMarketChangePercent: number | null;
  sparkline: number[] | null;
  enrichedAt: string | null;
}

export interface WatchlistResult {
  success: boolean;
  error: string | null;
}

export interface WatchlistQueryResult {
  watchlist: WatchlistEntry[];
}

export interface AddToWatchlistMutationResult {
  addToWatchlist: WatchlistResult;
}

export interface AddToWatchlistVariables {
  symbol: string;
  name: string;
  assetClass: AssetClass;
}

export interface RemoveFromWatchlistMutationResult {
  removeFromWatchlist: WatchlistResult;
}

export interface RemoveFromWatchlistVariables {
  symbol: string;
}

// ---------------------------------------------------------------------------
// Data Sources
// ---------------------------------------------------------------------------

export type DataSourceType = 'CLI' | 'MCP' | 'API';
export type DataSourceStatus = 'ACTIVE' | 'ERROR' | 'DISABLED';

export interface DataSourceCapability {
  id: string;
  description: string | null;
}

export interface DataSource {
  id: string;
  name: string;
  type: DataSourceType;
  capabilities: DataSourceCapability[];
  enabled: boolean;
  status: DataSourceStatus;
  lastError: string | null;
  lastFetchedAt: string | null;
  priority: number;
  builtin: boolean;
}

export interface DataSourceResult {
  success: boolean;
  dataSource: DataSource | null;
  error: string | null;
}

export interface DataSourceInput {
  id: string;
  name: string;
  type: DataSourceType;
  capabilities: string[];
  enabled?: boolean;
  priority?: number;
  baseUrl?: string;
  secretRef?: string;
  command?: string;
  args?: string[];
}

export interface ListDataSourcesQueryResult {
  listDataSources: DataSource[];
}

export interface AddDataSourceMutationResult {
  addDataSource: DataSourceResult;
}

export interface AddDataSourceVariables {
  input: DataSourceInput;
}

export interface RemoveDataSourceMutationResult {
  removeDataSource: DataSourceResult;
}

export interface RemoveDataSourceVariables {
  id: string;
}

export interface ToggleDataSourceMutationResult {
  toggleDataSource: DataSourceResult;
}

export interface ToggleDataSourceVariables {
  id: string;
  enabled: boolean;
}

export interface CliCommandStatus {
  command: string;
  available: boolean;
}

export interface CheckCliCommandsQueryResult {
  checkCliCommands: CliCommandStatus[];
}

// ---------------------------------------------------------------------------
// Fetch Data Source
// ---------------------------------------------------------------------------

export interface FetchResult {
  success: boolean;
  signalsIngested: number;
  duplicates: number;
  error: string | null;
}

export interface FetchDataSourceMutationResult {
  fetchDataSource: FetchResult;
}

export interface FetchDataSourceVariables {
  id: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export interface SignalSource {
  id: string;
  name: string;
  type: SourceType;
  reliability: number;
}

export interface Signal {
  id: string;
  type: SignalType;
  title: string;
  content: string | null;
  publishedAt: string;
  ingestedAt: string;
  confidence: number;
  contentHash: string;
  tickers: string[];
  sources: SignalSource[];
  sourceCount: number;
  link: string | null;
  tier1: string | null;
  tier2: string | null;
  sentiment: SignalSentiment | null;
  outputType: string;
  groupId: string | null;
  version: number;
}

export interface SignalsQueryResult {
  curatedSignals: CuratedSignal[];
}

export interface SignalsByIdsQueryResult {
  signalsByIds: Signal[];
}

// ---------------------------------------------------------------------------
// Signal Groups
// ---------------------------------------------------------------------------

export interface SignalGroup {
  id: string;
  signals: Signal[];
  tickers: string[];
  summary: string;
  outputType: string;
  firstEventAt: string;
  lastEventAt: string;
}

export interface SignalGroupsVariables {
  ticker?: string;
  since?: string;
  limit?: number;
}

export interface SignalsVariables {
  type?: SignalType;
  ticker?: string;
  sourceId?: string;
  since?: string;
  until?: string;
  search?: string;
  minConfidence?: number;
  outputType?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export type InsightRating = 'VERY_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'VERY_BEARISH';
export type PortfolioHealth = 'STRONG' | 'HEALTHY' | 'CAUTIOUS' | 'WEAK' | 'CRITICAL';

export interface SignalSummary {
  signalId: string;
  type: SignalType;
  title: string;
  impact: SignalImpact;
  confidence: number;
  url: string | null;
  sourceCount: number;
  detail: string | null;
  outputType: string;
}

export interface PositionInsight {
  symbol: string;
  name: string;
  rating: InsightRating;
  conviction: number;
  thesis: string;
  keySignals: SignalSummary[];
  /** All signal IDs for this ticker (7-day window). Deterministic — not LLM-selected. */
  allSignalIds: string[];
  risks: string[];
  opportunities: string[];
  memoryContext: string | null;
  priceTarget: number | null;
}

export interface PortfolioItem {
  text: string;
  signalIds: string[];
}

export interface PortfolioInsight {
  overallHealth: PortfolioHealth;
  summary: string;
  sectorThemes: string[];
  macroContext: string;
  topRisks: PortfolioItem[];
  topOpportunities: PortfolioItem[];
  actionItems: PortfolioItem[];
}

export interface EmotionState {
  confidence: number;
  riskAppetite: number;
  reason: string;
}

export interface InsightReport {
  id: string;
  snapshotId: string;
  positions: PositionInsight[];
  portfolio: PortfolioInsight;
  emotionState: EmotionState;
  createdAt: string;
  durationMs: number;
}

export interface LatestInsightReportQueryResult {
  latestInsightReport: InsightReport | null;
}

export interface InsightReportsQueryResult {
  insightReports: InsightReport[];
}

export interface InsightReportQueryResult {
  insightReport: InsightReport | null;
}

export interface ProcessInsightsMutationResult {
  processInsights: InsightReport | null;
}

export interface WorkflowStatus {
  running: boolean;
  startedAt: string | null;
}

export interface InsightsWorkflowStatusQueryResult {
  insightsWorkflowStatus: WorkflowStatus;
}

// ---------------------------------------------------------------------------
// Snap (Strategist brief)
// ---------------------------------------------------------------------------

export interface SnapActionItem {
  text: string;
  signalIds: string[];
}

export interface AssetSnap {
  symbol: string;
  snap: string;
  rating: string;
  generatedAt: string;
}

export interface Snap {
  id: string;
  generatedAt: string;
  intelSummary: string;
  actionItems: SnapActionItem[];
  assetSnaps: AssetSnap[];
}

export interface SnapQueryResult {
  snap: Snap | null;
}

// ---------------------------------------------------------------------------
// Micro Insights (per-asset AI research)
// ---------------------------------------------------------------------------

export interface MicroInsight {
  id: string;
  symbol: string;
  name: string;
  source: string;
  rating: InsightRating;
  conviction: number;
  thesis: string;
  keyDevelopments: string[];
  risks: string[];
  opportunities: string[];
  sentiment: string;
  signalCount: number;
  topSignalIds: string[];
  assetSnap: string;
  assetActions: string[];
  generatedAt: string;
  durationMs: number;
}

export interface MicroInsightQueryResult {
  microInsight: MicroInsight | null;
}

export interface MicroInsightsQueryResult {
  microInsights: MicroInsight[];
}

// ---------------------------------------------------------------------------
// Scheduler status
// ---------------------------------------------------------------------------

export interface SchedulerAssetStatus {
  symbol: string;
  source: string;
  lastSignalFetchAt: string | null;
  lastLlmAt: string | null;
  nextLlmEligibleAt: string;
  pendingAnalysis: boolean;
}

export interface SchedulerStatus {
  microLlmIntervalHours: number;
  pendingCount: number;
  throttledCount: number;
  assets: SchedulerAssetStatus[];
}

export interface SchedulerStatusQueryResult {
  schedulerStatus: SchedulerStatus;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export interface PriceEvent {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Query result wrappers (what useQuery returns in `data`)
// ---------------------------------------------------------------------------

export interface PortfolioQueryVariables {
  historyDays?: number | null;
}

export interface PortfolioQueryResult {
  portfolio: PortfolioSnapshot | null;
}

export interface RiskReportQueryResult {
  riskReport: RiskReport | null;
}

export interface AlertsQueryResult {
  alerts: Alert[];
}

export interface QuoteQueryResult {
  quote: Quote | null;
}

export interface NewsQueryResult {
  news: Article[];
}

// ---------------------------------------------------------------------------
// Connection query/mutation wrappers
// ---------------------------------------------------------------------------

export interface ListConnectionsQueryResult {
  listConnections: Connection[];
}

export interface DetectAvailableTiersQueryResult {
  detectAvailableTiers: TierAvailability[];
}

export interface DetectAvailableTiersVariables {
  platform: string;
}

export interface ConnectPlatformMutationResult {
  connectPlatform: ConnectionResult;
}

export interface ConnectPlatformVariables {
  input: ConnectPlatformInput;
}

export interface DisconnectPlatformMutationResult {
  disconnectPlatform: Pick<ConnectionResult, 'success' | 'error'>;
}

export interface DisconnectPlatformVariables {
  platform: string;
  removeCredentials?: boolean;
}

export interface OnConnectionStatusSubscriptionResult {
  onConnectionStatus: ConnectionEvent;
}

export interface OnConnectionStatusVariables {
  platform: string;
}

// ---------------------------------------------------------------------------
// Mutation result wrappers
// ---------------------------------------------------------------------------

export interface RefreshPositionsMutationResult {
  refreshPositions: PortfolioSnapshot;
}

export interface CreateAlertMutationResult {
  createAlert: Alert;
}

export interface DismissAlertMutationResult {
  dismissAlert: Alert;
}

export interface ManualPositionInput {
  symbol: string;
  name?: string;
  quantity: number;
  costBasis: number;
  assetClass?: AssetClass;
  platform?: Platform;
  entryDate?: string;
}

export interface AddManualPositionMutationResult {
  addManualPosition: PortfolioSnapshot;
}

export interface AddManualPositionVariables {
  input: ManualPositionInput;
}

export interface EditPositionMutationResult {
  editPosition: PortfolioSnapshot;
}

export interface EditPositionVariables {
  symbol: string;
  platform: string;
  input: ManualPositionInput;
}

export interface RemovePositionMutationResult {
  removePosition: PortfolioSnapshot;
}

export interface RemovePositionVariables {
  symbol: string;
  platform: string;
}

// ---------------------------------------------------------------------------
// Subscription result wrappers
// ---------------------------------------------------------------------------

export interface OnAlertSubscriptionResult {
  onAlert: Alert;
}

export interface OnPortfolioUpdateSubscriptionResult {
  onPortfolioUpdate: PortfolioSnapshot;
}

export interface OnPriceMoveSubscriptionResult {
  onPriceMove: PriceEvent;
}

// ---------------------------------------------------------------------------
// Workflow Progress
// ---------------------------------------------------------------------------

export interface WorkflowProgressEvent {
  workflowId: string;
  stage: 'start' | 'stage_start' | 'stage_complete' | 'complete' | 'error' | 'activity';
  stageIndex: number | null;
  totalStages: number | null;
  agentIds: string[] | null;
  error: string | null;
  message: string | null;
  timestamp: string;
}

export interface OnWorkflowProgressSubscriptionResult {
  onWorkflowProgress: WorkflowProgressEvent;
}

export interface OnWorkflowProgressVariables {
  workflowId: string;
}

// ---------------------------------------------------------------------------
// Curation
// ---------------------------------------------------------------------------

export interface PortfolioRelevanceScore {
  ticker: string;
  compositeScore: number;
}

export interface CuratedSignal {
  signal: Signal;
  scores: PortfolioRelevanceScore[];
  feedTarget: FeedTarget;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  assessment: {
    verdict: 'CRITICAL' | 'IMPORTANT' | 'NOISE';
    thesisAlignment: 'SUPPORTS' | 'CHALLENGES' | 'NEUTRAL';
    actionability: number;
  } | null;
  convergenceBoost: number;
  engagementScore: number;
}

export interface CuratedSignalsQueryResult {
  curatedSignals: CuratedSignal[];
}

export interface CuratedSignalsVariables {
  ticker?: string;
  since?: string;
  until?: string;
  type?: SignalType;
  search?: string;
  minConfidence?: number;
  outputType?: string;
  sourceId?: string;
  limit?: number;
  offset?: number;
  feedTarget?: FeedTarget;
}

export interface RunFullCurationMutationResult {
  runFullCuration: boolean;
}

export interface CurationWorkflowStatusQueryResult {
  curationWorkflowStatus: {
    running: boolean;
    startedAt: string | null;
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ActionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface Action {
  id: string;
  signalId: string | null;
  skillId: string | null;
  what: string;
  why: string;
  source: string;
  riskContext: string | null;
  status: ActionStatus;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

// ---------------------------------------------------------------------------
// Intel Feed
// ---------------------------------------------------------------------------

export interface IntelFeedQueryResult {
  curatedSignals: CuratedSignal[];
}

export interface IntelFeedQueryVariables {
  limit?: number;
  offset?: number;
  feedTarget?: FeedTarget;
}

export interface RefreshIntelFeedResult {
  signalsFetched: number;
  signalsCurated: number;
  error: string | null;
}

export interface RefreshIntelFeedMutationResult {
  refreshIntelFeed: RefreshIntelFeedResult;
}

// ---------------------------------------------------------------------------
// Variable types
// ---------------------------------------------------------------------------

export interface AlertsQueryVariables {
  status?: AlertStatus;
}

export interface QuoteQueryVariables {
  symbol: string;
}

export interface NewsQueryVariables {
  symbol?: string;
  limit?: number;
}

export interface RefreshPositionsVariables {
  platform: Platform;
}

export interface CreateAlertVariables {
  rule: AlertRuleInput;
}

export interface DismissAlertVariables {
  id: string;
}

export interface OnPriceMoveVariables {
  symbol: string;
  threshold: number;
}

// ---------------------------------------------------------------------------
// AI Config
// ---------------------------------------------------------------------------

export interface AiConfig {
  defaultModel: string;
  defaultProvider: string;
  hasAnthropicKey: boolean;
  hasAnthropicApiKey: boolean;
  hasOpenaiKey: boolean;
}

export interface AiConfigQueryResult {
  aiConfig: AiConfig;
}

export interface SaveAiConfigMutationResult {
  saveAiConfig: AiConfig;
}

export interface SaveAiConfigVariables {
  input: { defaultModel: string; defaultProvider?: string };
}

export interface SaveAiCredentialResult {
  success: boolean;
  error?: string;
}

export interface SaveAiCredentialMutationResult {
  saveAiCredential: SaveAiCredentialResult;
}

export interface SaveAiCredentialVariables {
  provider: string;
  apiKey: string;
}

export interface RemoveAiCredentialMutationResult {
  removeAiCredential: SaveAiCredentialResult;
}

export interface RemoveAiCredentialVariables {
  provider: string;
}

// ---------------------------------------------------------------------------
// AI Credential Detection
// ---------------------------------------------------------------------------

export interface KeychainTokenResult {
  found: boolean;
  model?: string;
  error?: string;
}

export interface DetectKeychainTokenResult {
  detectKeychainToken: KeychainTokenResult;
}

export interface DetectCodexTokenResult {
  detectCodexToken: KeychainTokenResult;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export type SkillCategory = 'RISK' | 'PORTFOLIO' | 'MARKET' | 'RESEARCH';

export interface SkillTrigger {
  type: string;
  description: string;
  params?: string | null;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  style: string;
  requires: string[];
  active: boolean;
  source: string;
  createdBy: string;
  createdAt: string;
  content: string;
  triggers: SkillTrigger[];
  maxPositionSize?: number | null;
  tickers: string[];
}

export interface SkillsQueryResult {
  skills: Skill[];
}

export interface SkillsQueryVariables {
  category?: SkillCategory;
  style?: string;
  active?: boolean;
  query?: string;
}

export interface SkillQueryResult {
  skill: Skill | null;
}

export interface ExportSkillQueryResult {
  exportSkill: string;
}

export interface ToggleSkillMutationResult {
  toggleSkill: { id: string; active: boolean };
}

export interface CreateSkillMutationResult {
  createSkill: { id: string; name: string };
}

export interface UpdateSkillMutationResult {
  updateSkill: { id: string; name: string };
}

export interface DeleteSkillMutationResult {
  deleteSkill: boolean;
}

export interface ImportSkillMutationResult {
  importSkill: Skill;
}

export interface ImportSkillVariables {
  markdown: string;
}

// ---------------------------------------------------------------------------
// Ticker Profiles
// ---------------------------------------------------------------------------

export interface TickerProfileEntry {
  id: string;
  ticker: string;
  category: string;
  observation: string;
  evidence: string;
  insightReportId: string;
  insightDate: string;
  rating: string | null;
  conviction: number | null;
  priceAtObservation: number | null;
  grade: string | null;
  actualReturn: number | null;
  createdAt: string;
}

export interface TickerProfileBrief {
  entryCount: number;
  recentPatterns: string[];
  recentLessons: string[];
  correlations: string[];
  sentimentHistory: SentimentPoint[];
}

export interface SentimentPoint {
  date: string;
  rating: string;
  conviction: number;
}

export interface TickerProfile {
  ticker: string;
  entryCount: number;
  entries: TickerProfileEntry[];
  brief: TickerProfileBrief;
}
