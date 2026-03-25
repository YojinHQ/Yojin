/**
 * SignalGroup data model — links causally related signals into a narrative chain.
 *
 * A SignalGroup connects signals that form a causal sequence, e.g.:
 *   "earnings beat" → "analyst upgrades" → "options spike"
 *
 * Groups are written to data/signals/groups/by-date/ as JSONL, partitioned by createdAt.
 */

import { z } from 'zod';

import { SignalOutputTypeSchema } from './types.js';

export const SignalGroupSchema = z.object({
  id: z.string().min(1),
  signalIds: z.array(z.string().min(1)).min(2), // at least 2 to form a group
  tickers: z.array(z.string().min(1)).min(1), // denormalized for fast query
  summary: z.string().min(1), // LLM-generated one-sentence narrative
  outputType: SignalOutputTypeSchema.default('INSIGHT'),
  firstEventAt: z.string().datetime(),
  lastEventAt: z.string().datetime(),
  version: z.number().int().min(1).default(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SignalGroup = z.infer<typeof SignalGroupSchema>;
