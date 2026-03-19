/**
 * Domain types for the GraphQL API.
 *
 * These are the TypeScript representations of the GraphQL schema types.
 * Resolvers return these shapes; future services will produce them.
 */

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
  sector?: string;
  assetClass: AssetClass;
  platform: Platform;
}

export type AssetClass = 'EQUITY' | 'CRYPTO' | 'BOND' | 'COMMODITY' | 'CURRENCY' | 'OTHER';
export type Platform = 'INTERACTIVE_BROKERS' | 'ROBINHOOD' | 'COINBASE' | 'POLYMARKET' | 'PHANTOM' | 'MANUAL';

export type IntegrationTier = 'CLI' | 'API' | 'UI' | 'SCREENSHOT';
export type ConnectionStatus = 'PENDING' | 'VALIDATING' | 'CONNECTED' | 'ERROR' | 'DISCONNECTED';

export interface ConnectionEvent {
  platform: Platform;
  step: 'TIER_DETECTED' | 'CREDENTIALS_STORED' | 'VALIDATING' | 'CONNECTED' | 'ERROR';
  message: string;
  tier?: IntegrationTier;
  error?: string;
}

export interface Connection {
  platform: Platform;
  tier: IntegrationTier;
  status: ConnectionStatus;
  lastSync: string | null;
  lastError: string | null;
  syncInterval: number;
  autoRefresh: boolean;
}

export interface ConnectionResult {
  success: boolean;
  connection?: Connection;
  error?: string;
}

export interface TierAvailability {
  tier: IntegrationTier;
  available: boolean;
  requiresCredentials: string[];
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

// ---------------------------------------------------------------------------
// Enriched
// ---------------------------------------------------------------------------

export interface EnrichedPosition extends Position {
  sentimentScore?: number;
  sentimentLabel?: string;
  analystRating?: string;
  targetPrice?: number;
  peRatio?: number;
  dividendYield?: number;
  beta?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
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

export interface RiskReport {
  id: string;
  portfolioValue: number;
  sectorExposure: SectorWeight[];
  concentrationScore: number;
  topConcentrations: Array<{ symbol: string; weight: number }>;
  correlationClusters: Array<{ symbols: string[]; correlation: number }>;
  maxDrawdown: number;
  valueAtRisk: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type AlertStatus = 'ACTIVE' | 'TRIGGERED' | 'DISMISSED';

export type AlertRuleType =
  | 'PRICE_MOVE'
  | 'SENTIMENT_SHIFT'
  | 'EARNINGS_PROXIMITY'
  | 'CONCENTRATION_DRIFT'
  | 'CORRELATION_WARNING';

export interface AlertRule {
  type: AlertRuleType;
  symbol?: string;
  threshold?: number;
  direction?: 'UP' | 'DOWN' | 'BOTH';
}

export interface Alert {
  id: string;
  rule: AlertRule;
  status: AlertStatus;
  message: string;
  triggeredAt?: string;
  dismissedAt?: string;
  createdAt: string;
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
  summary?: string;
  symbols: string[];
  sentiment?: number;
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
// Input types
// ---------------------------------------------------------------------------

export interface AlertRuleInput {
  type: AlertRuleType;
  symbol?: string;
  threshold?: number;
  direction?: 'UP' | 'DOWN' | 'BOTH';
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type ChatRole = 'USER' | 'ASSISTANT';
export type ChatEventType = 'THINKING' | 'TOOL_USE' | 'TEXT_DELTA' | 'MESSAGE_COMPLETE' | 'PII_REDACTED' | 'ERROR';

export interface ChatMessage {
  id: string;
  threadId: string;
  role: ChatRole;
  content: string;
  timestamp: string;
}

export interface ChatEvent {
  type: ChatEventType;
  threadId: string;
  delta?: string;
  messageId?: string;
  content?: string;
  error?: string;
  toolName?: string;
  piiTypesFound?: string[];
}
