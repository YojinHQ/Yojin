/**
 * Snap types — Zod schemas and inferred types for the Strategist brief.
 *
 * A Snap surfaces the action items from the latest InsightReport —
 * concrete next steps the user should consider.
 */

import { z } from 'zod';

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

export const SnapSchema = z.object({
  id: z.string().min(1),
  generatedAt: z.string().min(1),
  intelSummary: z.string().optional().default(''),
  actionItems: z.array(SnapActionItemSchema).default([]),
  assetSnaps: z.array(AssetSnapSchema).default([]),
  contentHash: z.string().optional(),
});
export type Snap = z.infer<typeof SnapSchema>;
