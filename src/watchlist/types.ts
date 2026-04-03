import { MarketQuoteSchema } from '@yojinhq/jintel-client';
import { z } from 'zod';

import { AssetClassSchema } from '../api/graphql/types.js';
import { DateTimeField, IdField } from '../types/base.js';

// --- Watchlist Entry ---

export const WatchlistEntrySchema = z.object({
  symbol: IdField,
  name: z.string().min(1),
  assetClass: AssetClassSchema,
  addedAt: DateTimeField,
  jintelEntityId: IdField.optional(),
  resolveAttemptedAt: DateTimeField.optional(),
});

export type WatchlistEntry = z.infer<typeof WatchlistEntrySchema>;

// --- Enrichment Cache Entry ---

export const EnrichmentCacheEntrySchema = z.object({
  symbol: IdField,
  enrichedAt: DateTimeField,
  quote: MarketQuoteSchema.nullable(),
  riskScore: z.number().min(0).max(100).nullable(),
});

export type EnrichmentCacheEntry = z.infer<typeof EnrichmentCacheEntrySchema>;

// --- Result type ---

export type Result<T = void> = { success: true; data?: T } | { success: false; error: string };
