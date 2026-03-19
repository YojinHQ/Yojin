/**
 * Scraper domain types — interfaces for platform connectors and
 * screenshot extraction results.
 *
 * The PlatformConnector interface here is minimal and will be
 * reconciled with YOJ-55 once the tiered connector framework lands.
 */

import { z } from 'zod';

import type { Platform } from '../api/graphql/types.js';
import type { AgentLoopProvider, ImageMediaType } from '../core/types.js';

// ---------------------------------------------------------------------------
// Zod schemas for validating Claude Vision output
// ---------------------------------------------------------------------------

export const AssetClassSchema = z.enum(['EQUITY', 'CRYPTO', 'BOND', 'COMMODITY', 'CURRENCY', 'OTHER']);

export const PlatformSchema = z.enum([
  'INTERACTIVE_BROKERS',
  'ROBINHOOD',
  'COINBASE',
  'SCHWAB',
  'BINANCE',
  'FIDELITY',
  'POLYMARKET',
  'PHANTOM',
  'MANUAL',
]);

export const IntegrationTierSchema = z.enum(['CLI', 'API', 'UI', 'SCREENSHOT']);

export const ConnectionStatusSchema = z.enum(['PENDING', 'VALIDATING', 'CONNECTED', 'ERROR', 'DISCONNECTED']);

export const ConnectionConfigSchema = z.object({
  platform: PlatformSchema,
  tier: IntegrationTierSchema,
  credentialRefs: z.array(z.string()),
  syncInterval: z.number().default(3600),
  autoRefresh: z.boolean().default(true),
});

export const ConnectionsFileSchema = z.array(ConnectionConfigSchema);
export type ConnectionsFile = z.infer<typeof ConnectionsFileSchema>;

export const ConnectionStateSchema = z.object({
  platform: PlatformSchema,
  tier: IntegrationTierSchema,
  status: ConnectionStatusSchema,
  lastSync: z.string().nullable(),
  lastError: z.string().nullable(),
});

export const ConnectionStateFileSchema = z.array(ConnectionStateSchema);
export type ConnectionStateFile = z.infer<typeof ConnectionStateFileSchema>;

// ---------------------------------------------------------------------------
// Connection domain types (canonical definitions — re-exported by api/graphql/types.ts)
// ---------------------------------------------------------------------------

export type IntegrationTier = z.infer<typeof IntegrationTierSchema>;
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export interface ConnectionEvent {
  platform: Platform;
  step: 'TIER_DETECTED' | 'CREDENTIALS_STORED' | 'VALIDATING' | 'CONNECTED' | 'ERROR' | 'DISCONNECTED';
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

export const ExtractedPositionSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().optional(),
  quantity: z.number().optional(),
  costBasis: z.number().optional(),
  currentPrice: z.number().optional(),
  marketValue: z.number().optional(),
  unrealizedPnl: z.number().optional(),
  unrealizedPnlPercent: z.number().optional(),
  assetClass: AssetClassSchema.optional(),
});

export type ExtractedPosition = z.infer<typeof ExtractedPositionSchema>;

export const ExtractionResponseSchema = z.object({
  platform: PlatformSchema,
  positions: z.array(ExtractedPositionSchema),
  notes: z.string().optional(),
});

export type ExtractionResponse = z.infer<typeof ExtractionResponseSchema>;

// ---------------------------------------------------------------------------
// Platform connector (minimal — reconciled with YOJ-55 later)
// ---------------------------------------------------------------------------

export interface PlatformConnector {
  readonly platformId: string;
  readonly platformName: string;
  fetchPositions(): Promise<PlatformConnectorResult>;
}

export type PlatformConnectorResult =
  | { success: true; positions: ExtractedPosition[]; metadata: ExtractionMetadata }
  | { success: false; error: string };

// ---------------------------------------------------------------------------
// Screenshot parser params
// ---------------------------------------------------------------------------

export interface ParseScreenshotParams {
  imageData: Buffer;
  mediaType: ImageMediaType;
  provider: AgentLoopProvider;
  model: string;
  platformHint?: Platform;
  /** Max tokens for the vision response (default 4096). */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Extraction metadata and confidence scoring
// ---------------------------------------------------------------------------

export interface ExtractionMetadata {
  source: 'screenshot' | 'scraper';
  platform: Platform;
  extractedAt: string;
  confidence: number;
  positionConfidences: PositionConfidence[];
  warnings: string[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface PositionConfidence {
  symbol: string;
  confidence: number;
  fieldsExtracted: number;
  fieldsExpected: number;
  consistencyCheck: boolean;
}

// ---------------------------------------------------------------------------
// Screenshot parse result (Result-style, reuses PlatformConnectorResult)
// ---------------------------------------------------------------------------

export type ScreenshotParseResult = PlatformConnectorResult;
