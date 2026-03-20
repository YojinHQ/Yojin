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
  sector: string | null;
  assetClass: AssetClass;
  platform: Platform;
}

export interface PortfolioSnapshot {
  id: string;
  positions: Position[];
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPercent: number;
  timestamp: string;
  platform: Platform | null;
}

export interface PortfolioHistoryPoint {
  timestamp: string;
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPercent: number;
}

// ---------------------------------------------------------------------------
// Enriched
// ---------------------------------------------------------------------------

export interface EnrichedPosition extends Position {
  sentimentScore: number | null;
  sentimentLabel: string | null;
  analystRating: string | null;
  targetPrice: number | null;
  peRatio: number | null;
  dividendYield: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

export interface EnrichedSnapshot {
  id: string;
  positions: EnrichedPosition[];
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPercent: number;
  timestamp: string;
  enrichedAt: string;
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

export interface PortfolioQueryResult {
  portfolio: PortfolioSnapshot | null;
}

export interface PositionsQueryResult {
  positions: Position[];
}

export interface PortfolioHistoryQueryResult {
  portfolioHistory: PortfolioHistoryPoint[];
}

export interface EnrichedSnapshotQueryResult {
  enrichedSnapshot: EnrichedSnapshot | null;
}

export interface RiskReportQueryResult {
  riskReport: RiskReport | null;
}

export interface SectorExposureQueryResult {
  sectorExposure: SectorWeight[];
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
}

export interface AddManualPositionMutationResult {
  addManualPosition: PortfolioSnapshot;
}

export interface AddManualPositionVariables {
  input: ManualPositionInput;
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
