/**
 * Domain types for the GraphQL API.
 *
 * These are the TypeScript representations of the GraphQL schema types.
 * Resolvers return these shapes; future services will produce them.
 *
 * AssetClassSchema is the canonical Zod enum — all other modules re-export from here.
 * Platform is an open type (KnownPlatform | string) to support custom platforms.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Canonical Zod schema for AssetClass
// ---------------------------------------------------------------------------

export const AssetClassSchema = z.enum(['EQUITY', 'CRYPTO', 'BOND', 'COMMODITY', 'CURRENCY', 'OTHER']);
export type AssetClass = z.infer<typeof AssetClassSchema>;

// ---------------------------------------------------------------------------
// Platform — open type supporting custom platforms
// ---------------------------------------------------------------------------

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
  dayChange?: number;
  dayChangePercent?: number;
  preMarketChange?: number | null;
  preMarketChangePercent?: number | null;
  postMarketChange?: number | null;
  postMarketChangePercent?: number | null;
  sparkline?: number[];
  sector?: string;
  assetClass: AssetClass;
  platform: Platform;
  entryDate?: string;
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
  warnings?: string[];
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
  assetClass: string;
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

export interface ManualPositionInput {
  symbol: string;
  name?: string;
  quantity: number;
  costBasis: number;
  assetClass?: AssetClass;
  platform?: Platform;
  entryDate?: string;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type ChatRole = 'USER' | 'ASSISTANT';
export type ChatEventType =
  | 'THINKING'
  | 'TOOL_USE'
  | 'TEXT_DELTA'
  | 'MESSAGE_COMPLETE'
  | 'PII_REDACTED'
  | 'ERROR'
  | 'TOOL_CARD';

export interface ToolCardRef {
  tool: string;
  params: string; // JSON-encoded params
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  toolCards?: ToolCardRef[];
}

export interface ChatEvent {
  type: ChatEventType;
  threadId: string;
  delta?: string;
  accumulatedText?: string;
  messageId?: string;
  content?: string;
  error?: string;
  toolName?: string;
  piiTypesFound?: string[];
  toolCard?: ToolCardRef;
}
