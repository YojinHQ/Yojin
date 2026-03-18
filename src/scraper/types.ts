/**
 * Scraper domain types — interfaces for platform connectors and
 * screenshot extraction results.
 *
 * The PlatformConnector interface here is minimal and will be
 * reconciled with YOJ-55 once the tiered connector framework lands.
 */

import { z } from 'zod';

import type { AssetClass, Platform } from '../api/graphql/types.js';

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
// Extracted position (partial — screenshots may not have all fields)
// ---------------------------------------------------------------------------

export interface ExtractedPosition {
  symbol: string;
  name?: string;
  quantity?: number;
  costBasis?: number;
  currentPrice?: number;
  marketValue?: number;
  unrealizedPnl?: number;
  unrealizedPnlPercent?: number;
  assetClass?: AssetClass;
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

// ---------------------------------------------------------------------------
// Zod schemas for validating Claude Vision output
// ---------------------------------------------------------------------------

// Keep in sync with AssetClass and Platform in ../api/graphql/types.ts
export const AssetClassSchema = z.enum(['EQUITY', 'CRYPTO', 'BOND', 'COMMODITY', 'CURRENCY', 'OTHER']);

// Keep in sync with Platform in ../api/graphql/types.ts
export const PlatformSchema = z.enum(['INTERACTIVE_BROKERS', 'ROBINHOOD', 'COINBASE', 'MANUAL']);

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

export const ExtractionResponseSchema = z.object({
  platform: PlatformSchema,
  positions: z.array(ExtractedPositionSchema),
  notes: z.string().optional(),
});

export type ExtractionResponse = z.infer<typeof ExtractionResponseSchema>;
