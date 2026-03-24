import { z } from 'zod';

import { AssetClassSchema } from '../api/graphql/types.js';
import { MarketQuoteSchema, NewsArticleSchema } from '../jintel/types.js';

// --- Watchlist Entry ---

export const WatchlistEntrySchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  assetClass: AssetClassSchema,
  addedAt: z.string().datetime(),
  jintelEntityId: z.string().min(1).optional(),
  resolveAttemptedAt: z.string().datetime().optional(),
});

export type WatchlistEntry = z.infer<typeof WatchlistEntrySchema>;

// --- Enrichment Cache Entry ---

export const EnrichmentCacheEntrySchema = z.object({
  symbol: z.string().min(1),
  enrichedAt: z.string().datetime(),
  quote: MarketQuoteSchema.nullable(),
  news: z.array(NewsArticleSchema),
  riskScore: z.number().min(0).max(100).nullable(),
});

export type EnrichmentCacheEntry = z.infer<typeof EnrichmentCacheEntrySchema>;

// --- Result type ---

export type Result<T = void> = { success: true; data?: T } | { success: false; error: string };
