/**
 * Snap types — Zod schemas and inferred types for the Strategist brief.
 *
 * A Snap surfaces the action items from the latest InsightReport —
 * concrete next steps the user should consider.
 */

import { z } from 'zod';

import type { MicroInsight } from '../insights/micro-types.js';
import { IdField } from '../types/base.js';

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
  generatedAt: z.string().min(1),
  intelSummary: z.string().optional().default(''),
  actionItems: z.array(SnapActionItemSchema).default([]),
  assetSnaps: z.array(AssetSnapSchema).default([]),
  contentHash: z.string().optional(),
});
export type Snap = z.infer<typeof SnapSchema>;
