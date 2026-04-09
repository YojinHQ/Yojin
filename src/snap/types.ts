/**
 * Snap types — Zod schemas and inferred types for the Strategist brief.
 *
 * A Snap surfaces the action items from the latest InsightReport —
 * concrete next steps the user should consider.
 */

import { z } from 'zod';

import { MicroInsightSourceSchema } from '../insights/micro-types.js';
import type { MicroInsight } from '../insights/micro-types.js';
import { IdField } from '../types/base.js';

/**
 * Snap scope — matches MicroInsightSource so scheduler can use the same
 * discriminator throughout the pipeline. Portfolio-held assets produce
 * 'portfolio' snaps shown on Overview; watchlist assets produce 'watchlist'
 * snaps shown on the Watchlist page.
 */
export const SnapScopeSchema = MicroInsightSourceSchema;
export type SnapScope = z.infer<typeof SnapScopeSchema>;

export const SnapActionItemSchema = z.object({
  text: z.string().min(1),
  signalIds: z.array(z.string()),
});
export type SnapActionItem = z.infer<typeof SnapActionItemSchema>;

export const AssetSnapSchema = z.object({
  symbol: z.string().min(1),
  snap: z.string().min(1),
  rating: z.string().min(1),
  generatedAt: z.string().min(1),
});
export type AssetSnap = z.infer<typeof AssetSnapSchema>;

/** Extract asset snaps from micro insights — filters to non-empty snaps and maps to AssetSnap shape. */
export function assetSnapsFromMicro(microInsights: Iterable<MicroInsight>): AssetSnap[] {
  const result: AssetSnap[] = [];
  for (const mi of microInsights) {
    if (mi.assetSnap.length > 0) {
      result.push({ symbol: mi.symbol, snap: mi.assetSnap, rating: mi.rating, generatedAt: mi.generatedAt });
    }
  }
  return result;
}

export const SnapSchema = z.object({
  id: IdField,
  scope: SnapScopeSchema.default('portfolio'),
  generatedAt: z.string().min(1),
  intelSummary: z.string().optional().default(''),
  actionItems: z.array(SnapActionItemSchema).default([]),
  assetSnaps: z.array(AssetSnapSchema).default([]),
  contentHash: z.string().optional(),
});
export type Snap = z.infer<typeof SnapSchema>;
