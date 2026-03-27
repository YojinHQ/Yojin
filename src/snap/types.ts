/**
 * Snap types — Zod schemas and inferred types for the Strategist brief.
 *
 * A Snap is a short, periodically-generated summary answering:
 * "What deserves my attention right now?"
 */

import { z } from 'zod';

export const SnapSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type SnapSeverity = z.infer<typeof SnapSeveritySchema>;

export const SnapAttentionItemSchema = z.object({
  label: z.string().min(1),
  severity: SnapSeveritySchema,
  ticker: z.string().optional(),
});
export type SnapAttentionItem = z.infer<typeof SnapAttentionItemSchema>;

export const SnapSchema = z.object({
  id: z.string().min(1),
  generatedAt: z.string().min(1),
  summary: z.string().min(1),
  attentionItems: z.array(SnapAttentionItemSchema),
  portfolioTickers: z.array(z.string().min(1)),
});
export type Snap = z.infer<typeof SnapSchema>;
