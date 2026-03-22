import { z } from 'zod';

/** Memory-enabled agent roles (Trader excluded in V1). */
export const MemoryAgentRoleSchema = z.enum(['analyst', 'strategist', 'risk-manager']);
export type MemoryAgentRole = z.infer<typeof MemoryAgentRoleSchema>;

/** Reflection grade — deterministic, not LLM-assigned. */
export const GradeSchema = z.enum(['CORRECT', 'PARTIALLY_CORRECT', 'INCORRECT']);
export type Grade = z.infer<typeof GradeSchema>;

/** A single memory entry — born unreflected, updated after reflection. */
export const MemoryEntrySchema = z.object({
  id: z.string().min(1),
  agentRole: MemoryAgentRoleSchema,
  tickers: z.array(z.string().min(1)).min(1),
  situation: z.string().min(1),
  recommendation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
  outcome: z.string().nullable(),
  lesson: z.string().nullable(),
  actualReturn: z.number().nullable(),
  grade: GradeSchema.nullable(),
  reflectedAt: z.string().datetime().nullable(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

/** Input for creating a new (unreflected) memory entry. */
export const NewMemoryInputSchema = z.object({
  tickers: z.array(z.string().min(1)).min(1),
  situation: z.string().min(1),
  recommendation: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type NewMemoryInput = z.infer<typeof NewMemoryInputSchema>;

/** Input for updating an entry with reflection results. */
export const ReflectionInputSchema = z.object({
  outcome: z.string().min(1),
  lesson: z.string().min(1),
  actualReturn: z.number(),
  grade: GradeSchema,
});
export type ReflectionInput = z.infer<typeof ReflectionInputSchema>;

/** Price data fetched for reflection grading. */
export const PriceOutcomeSchema = z.object({
  priceAtAnalysis: z.number(),
  priceNow: z.number(),
  returnPct: z.number(),
  highInPeriod: z.number(),
  lowInPeriod: z.number(),
});
export type PriceOutcome = z.infer<typeof PriceOutcomeSchema>;

/** Result of reflecting on a single entry. */
export type ReflectionResult =
  | { success: true }
  | { success: false; reason: 'price_unavailable' | 'llm_error' | 'store_error'; entryId: string };

/** Summary of a batch reflection sweep. */
export interface ReflectionSweepResult {
  reflected: number;
  skipped: number;
  errors: number;
}

/** Price provider function signature — injected via composition root. */
export type PriceProvider = (ticker: string, since: Date) => Promise<PriceOutcome>;

/** Minimal LLM provider interface — subset of ProviderRouter needed for reflection. */
export interface LlmProvider {
  completeWithTools(params: {
    model: string;
    system?: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<{
    content: Array<{ type: string; text?: string }>;
    stopReason: string;
  }>;
}
