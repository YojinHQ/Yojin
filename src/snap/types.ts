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

export const SnapSchema = z.object({
  id: z.string().min(1),
  generatedAt: z.string().min(1),
  intelSummary: z.string().optional().default(''),
  actionItems: z.array(SnapActionItemSchema),
});
export type Snap = z.infer<typeof SnapSchema>;
