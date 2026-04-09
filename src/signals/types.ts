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
import { DateTimeField, IdField, ScoreRange } from '../types/base.js';

// ---------------------------------------------------------------------------
// Enums (SCREAMING_CASE to match GraphQL convention)
// ---------------------------------------------------------------------------

export const SignalTypeSchema = z.enum([
  'NEWS',
  'FUNDAMENTAL',
  'SENTIMENT',
  'TECHNICAL',
  'MACRO',
  'FILINGS',
  'SOCIALS',
  'TRADING_LOGIC_TRIGGER',
]);
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const SourceTypeSchema = z.enum(['API', 'RSS', 'SCRAPER', 'ENRICHMENT']);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const LinkTypeSchema = z.enum([
  'DIRECT', // Signal mentions the asset by name
  'INDIRECT', // Signal affects the asset's sector/industry
  'MACRO', // Macro signal (Fed, GDP) with broad impact
]);
export type LinkType = z.infer<typeof LinkTypeSchema>;

export const SignalSentimentSchema = z.enum(['BULLISH', 'BEARISH', 'MIXED', 'NEUTRAL']);
export type SignalSentiment = z.infer<typeof SignalSentimentSchema>;

export const SignalOutputTypeSchema = z.enum(['INSIGHT', 'ALERT', 'ACTION']);
export type SignalOutputType = z.infer<typeof SignalOutputTypeSchema>;

// ---------------------------------------------------------------------------
// DataSource — provenance tracking for where a signal came from
// ---------------------------------------------------------------------------

export const SignalDataSourceSchema = z.object({
  id: IdField, // e.g. 'jintel', 'rss-reuters'
  name: z.string().min(1),
  type: SourceTypeSchema,
  reliability: ScoreRange,
});
export type SignalDataSource = z.infer<typeof SignalDataSourceSchema>;

// ---------------------------------------------------------------------------
// Asset — normalized asset reference
// ---------------------------------------------------------------------------

export const AssetSchema = z.object({
  ticker: IdField, // e.g. 'AAPL', 'BTC-USD'
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
  ticker: IdField,
  relevance: ScoreRange, // how relevant this signal is to this asset
  linkType: LinkTypeSchema,
});
export type SignalAssetLink = z.infer<typeof SignalAssetLinkSchema>;

// ---------------------------------------------------------------------------
// Signal — the core data point entity
// ---------------------------------------------------------------------------

export const SignalSchema = z.object({
  id: IdField, // nanoid
  contentHash: IdField, // SHA-256 for dedup across sources
  type: SignalTypeSchema,
  title: z.string().min(1),
  content: z.string().optional(), // raw content or structured payload
  assets: z.array(SignalAssetLinkSchema), // many-to-many links
  sources: z.array(SignalDataSourceSchema).min(1), // which providers contributed
  publishedAt: DateTimeField, // when the data point was produced
  ingestedAt: DateTimeField, // when Yojin captured it
  confidence: ScoreRange, // source confidence
  metadata: z.record(z.string(), z.unknown()).optional(), // extensible domain-specific fields
  // Tiered summaries (LLM-generated at ingest/merge time)
  tier1: z.string().optional(),
  tier2: z.string().optional(),
  // LLM-classified sentiment
  sentiment: SignalSentimentSchema.optional(),
  /**
   * Numeric sentiment polarity in range [-1, +1]. Populated for news/social signals
   * where the upstream source provides a real polarity score (e.g. Jintel news with
   * sentimentScore from the AFINN-based sentiment lib). Distinct from the categorical
   * `sentiment` enum, which is LLM-classified for display.
   */
  sentimentScore: z.number().min(-1).max(1).optional(),
  // Feed classification
  outputType: SignalOutputTypeSchema.default('INSIGHT'),
  // LLM quality assessment — persisted so curation pipeline can filter generically
  // without regex blocklists. All optional for backward compat with pre-existing signals.
  qualityScore: z.number().int().min(0).max(100).optional(),
  isFalseMatch: z.boolean().optional(),
  isIrrelevant: z.boolean().optional(),
  isDuplicate: z.boolean().optional(),
  // Causal chain linking
  groupId: z.string().nullable().optional(),
  // Append-only versioning for multi-source merge
  version: z.number().int().min(1).default(1),
});
export type Signal = z.infer<typeof SignalSchema>;

// ---------------------------------------------------------------------------
// PortfolioRelevanceScore — user-contextualized scoring
// ---------------------------------------------------------------------------

export const PortfolioRelevanceScoreSchema = z.object({
  signalId: IdField,
  ticker: IdField, // which position this score applies to
  exposureWeight: ScoreRange, // position size as % of portfolio
  typeRelevance: ScoreRange, // how much this signal type matters
  compositeScore: ScoreRange, // final ranked score
});
export type PortfolioRelevanceScore = z.infer<typeof PortfolioRelevanceScoreSchema>;

// ---------------------------------------------------------------------------
// SignalIndex — lightweight metadata for in-memory dedup + scoring
// ---------------------------------------------------------------------------

export const SignalIndexEntrySchema = z.object({
  id: IdField,
  contentHash: IdField,
  type: SignalTypeSchema,
  tickers: z.array(IdField), // denormalized from assets for fast lookup
  portfolioScore: ScoreRange.optional(),
  publishedAt: DateTimeField,
  ingestedAt: DateTimeField,
});
export type SignalIndexEntry = z.infer<typeof SignalIndexEntrySchema>;

export const SignalIndexSchema = z.object({
  entries: z.array(SignalIndexEntrySchema),
  lastUpdated: DateTimeField,
});
export type SignalIndex = z.infer<typeof SignalIndexSchema>;
