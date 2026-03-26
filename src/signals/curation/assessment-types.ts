/**
 * Signal Assessment types — schemas for the agent-based Tier 2 signal assessment.
 *
 * The Research Analyst classifies signals as CRITICAL/IMPORTANT/NOISE.
 * The Strategist scores them against the active investment thesis.
 * Results are stored as AssessmentReports for downstream consumption.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Verdict & alignment enums
// ---------------------------------------------------------------------------

export const SignalVerdictSchema = z.enum(['CRITICAL', 'IMPORTANT', 'NOISE']);
export type SignalVerdict = z.infer<typeof SignalVerdictSchema>;

export const ThesisAlignmentSchema = z.enum(['SUPPORTS', 'CHALLENGES', 'NEUTRAL']);
export type ThesisAlignment = z.infer<typeof ThesisAlignmentSchema>;

// ---------------------------------------------------------------------------
// Individual signal assessment
// ---------------------------------------------------------------------------

export const SignalAssessmentSchema = z.object({
  signalId: z.string().min(1),
  ticker: z.string().min(1),
  verdict: SignalVerdictSchema,
  /** Agent-assigned relevance (0–1), thesis-aligned. */
  relevanceScore: z.number().min(0).max(1),
  /** 1-2 sentence justification. */
  reasoning: z.string().min(1),
  thesisAlignment: ThesisAlignmentSchema,
  /** How actionable is this signal (0–1). */
  actionability: z.number().min(0).max(1),
});
export type SignalAssessment = z.infer<typeof SignalAssessmentSchema>;

// ---------------------------------------------------------------------------
// Assessment report — one per pipeline run
// ---------------------------------------------------------------------------

export const AssessmentReportSchema = z.object({
  id: z.string().min(1),
  assessedAt: z.string().datetime(),
  tickers: z.array(z.string().min(1)).min(1),
  assessments: z.array(SignalAssessmentSchema),
  /** How many curated signals were evaluated. */
  signalsInput: z.number().int().min(0),
  /** How many passed (CRITICAL + IMPORTANT). */
  signalsKept: z.number().int().min(0),
  /** Strategist's thesis summary at assessment time. */
  thesisSummary: z.string(),
  durationMs: z.number().min(0),
});
export type AssessmentReport = z.infer<typeof AssessmentReportSchema>;

// ---------------------------------------------------------------------------
// Watermark — tracks incremental processing
// ---------------------------------------------------------------------------

export const AssessmentWatermarkSchema = z.object({
  lastRunAt: z.string().datetime(),
  /** Latest curatedAt timestamp processed — used to skip already-assessed signals. */
  lastCuratedAt: z.string().datetime(),
  signalsAssessed: z.number().int().min(0),
  signalsKept: z.number().int().min(0),
});
export type AssessmentWatermark = z.infer<typeof AssessmentWatermarkSchema>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const AssessmentConfigSchema = z.object({
  /** How often the assessment pipeline runs (minutes). */
  intervalMinutes: z.number().int().min(1).default(60),
  /** Maximum assessed signals to keep per position. */
  maxSignalsPerPosition: z.number().int().min(1).default(5),
});
export type AssessmentConfig = z.infer<typeof AssessmentConfigSchema>;
