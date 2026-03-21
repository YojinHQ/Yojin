/**
 * Signal data model — first-class data points for the asset intelligence pipeline.
 *
 * A Signal is an independent data point (news, fundamental, sentiment, technical, macro)
 * that links to one or more assets, can come from multiple sources, and gets scored
 * by relevance to the user's portfolio.
 *
 * Storage: file-driven JSONL in data/signals/ (by-date/, by-ticker/, index.json).
 * GraphQL: Signal, SignalAssetLink, DataSource types in schema.ts.
 *
 * All types are Zod schemas — the single source of truth for validation and inference.
 */

import { z } from 'zod';

import { AssetClassSchema } from '../api/graphql/types.js';

// ---------------------------------------------------------------------------
// Enums (SCREAMING_CASE to match GraphQL convention)
// ---------------------------------------------------------------------------

export const SignalTypeSchema = z.enum(['NEWS', 'FUNDAMENTAL', 'SENTIMENT', 'TECHNICAL', 'MACRO']);
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const SourceTypeSchema = z.enum(['API', 'RSS', 'SCRAPER', 'ENRICHMENT']);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const LinkTypeSchema = z.enum([
  'DIRECT', // Signal mentions the asset by name
  'INDIRECT', // Signal affects the asset's sector/industry
  'MACRO', // Macro signal (Fed, GDP) with broad impact
]);
export type LinkType = z.infer<typeof LinkTypeSchema>;

// ---------------------------------------------------------------------------
// DataSource — provenance tracking for where a signal came from
// ---------------------------------------------------------------------------

export const SignalDataSourceSchema = z.object({
  id: z.string(), // e.g. 'openbb-fmp', 'rss-reuters', 'keelson'
  name: z.string(),
  type: SourceTypeSchema,
  reliability: z.number().min(0).max(1),
});
export type SignalDataSource = z.infer<typeof SignalDataSourceSchema>;

// ---------------------------------------------------------------------------
// Asset — normalized asset reference
// ---------------------------------------------------------------------------

export const AssetSchema = z.object({
  ticker: z.string(), // e.g. 'AAPL', 'BTC-USD'
  name: z.string().optional(),
  assetClass: AssetClassSchema,
  exchange: z.string().optional(),
  sector: z.string().optional(),
  industry: z.string().optional(),
});
export type Asset = z.infer<typeof AssetSchema>;

// ---------------------------------------------------------------------------
// SignalAssetLink — many-to-many: signal ↔ assets
// ---------------------------------------------------------------------------

export const SignalAssetLinkSchema = z.object({
  ticker: z.string(),
  relevance: z.number().min(0).max(1), // how relevant this signal is to this asset
  linkType: LinkTypeSchema,
});
export type SignalAssetLink = z.infer<typeof SignalAssetLinkSchema>;

// ---------------------------------------------------------------------------
// Signal — the core data point entity
// ---------------------------------------------------------------------------

export const SignalSchema = z.object({
  id: z.string(), // nanoid
  contentHash: z.string(), // SHA-256 for dedup across sources
  type: SignalTypeSchema,
  title: z.string(),
  content: z.string().optional(), // raw content or structured payload
  assets: z.array(SignalAssetLinkSchema), // many-to-many links
  sources: z.array(SignalDataSourceSchema), // which providers contributed
  publishedAt: z.string().datetime(), // when the data point was produced
  ingestedAt: z.string().datetime(), // when Yojin captured it
  confidence: z.number().min(0).max(1), // source confidence
  metadata: z.record(z.unknown()).optional(), // extensible domain-specific fields
});
export type Signal = z.infer<typeof SignalSchema>;

// ---------------------------------------------------------------------------
// PortfolioRelevanceScore — user-contextualized scoring
// ---------------------------------------------------------------------------

export const PortfolioRelevanceScoreSchema = z.object({
  signalId: z.string(),
  exposureWeight: z.number().min(0).max(1), // position size as % of portfolio
  typeRelevance: z.number().min(0).max(1), // how much this signal type matters
  compositeScore: z.number().min(0).max(1), // final ranked score
});
export type PortfolioRelevanceScore = z.infer<typeof PortfolioRelevanceScoreSchema>;

// ---------------------------------------------------------------------------
// SignalIndex — lightweight metadata for in-memory dedup + scoring
// ---------------------------------------------------------------------------

export const SignalIndexEntrySchema = z.object({
  id: z.string(),
  contentHash: z.string(),
  type: SignalTypeSchema,
  tickers: z.array(z.string()), // denormalized from assets for fast lookup
  portfolioScore: z.number().min(0).max(1).optional(),
  publishedAt: z.string().datetime(),
  ingestedAt: z.string().datetime(),
});
export type SignalIndexEntry = z.infer<typeof SignalIndexEntrySchema>;

export const SignalIndexSchema = z.object({
  entries: z.array(SignalIndexEntrySchema),
  lastUpdated: z.string().datetime(),
});
export type SignalIndex = z.infer<typeof SignalIndexSchema>;
