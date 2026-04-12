/**
 * Assessment tools — agent tool for persisting signal assessments.
 *
 * The save_signal_assessment tool is registered for the Strategist agent.
 * By exposing persistence as a tool, the TAO loop validates input via Zod
 * on call — if the schema fails, the agent gets an error observation and retries.
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { AssessmentStore } from './assessment-store.js';
import { SignalVerdictSchema, ThesisAlignmentSchema } from './assessment-types.js';
import type { ToolDefinition, ToolResult } from '../../core/types.js';
import { getLogger } from '../../logging/index.js';
import type { SignalArchive } from '../archive.js';
import { SignalTypeSchema } from '../types.js';
import type { SignalType } from '../types.js';

const log = getLogger().sub('assessment-tools');

export interface AssessmentToolsOptions {
  assessmentStore: AssessmentStore;
  /** Signal archive for writing back reclassified signal types. */
  signalArchive?: SignalArchive;
  /** Set by the workflow beforeWorkflow to track total pipeline duration. */
  workflowStartMs?: { value: number };
}

export function createAssessmentTools(options: AssessmentToolsOptions): ToolDefinition[] {
  const { assessmentStore, signalArchive, workflowStartMs } = options;

  const saveSignalAssessment: ToolDefinition = {
    name: 'save_signal_assessment',
    description:
      'Save structured signal assessments after filtering and scoring curated signals ' +
      'against the active investment thesis. Call this once with ALL assessments for ALL tickers. ' +
      'Include only CRITICAL and IMPORTANT signals — NOISE signals should still be listed ' +
      'with verdict NOISE so the system knows they were evaluated.',
    parameters: z.object({
      assessments: z
        .array(
          z.object({
            signalId: z.string().min(1).describe('Exact signal ID from the curated signals (e.g. sig-abc123)'),
            ticker: z.string().min(1).describe('Portfolio ticker this assessment applies to'),
            verdict: SignalVerdictSchema.describe(
              'CRITICAL: must-see signal. IMPORTANT: useful context. NOISE: irrelevant or redundant.',
            ),
            relevanceScore: z.number().min(0).max(1).describe('Thesis-aligned relevance (0-1)'),
            reasoning: z.string().min(1).describe('1-2 sentence justification for the verdict'),
            thesisAlignment: ThesisAlignmentSchema.describe(
              'Does this signal SUPPORT, CHALLENGE, or is NEUTRAL to the active thesis?',
            ),
            actionability: z.number().min(0).max(1).describe('How actionable is this signal (0-1)'),
            signalType: SignalTypeSchema.optional().describe(
              'Reclassified signal type if the heuristic got it wrong. ' +
                'NEWS | FUNDAMENTAL | SENTIMENT | TECHNICAL | MACRO | FILINGS | SOCIALS | REGULATORY | TRADING_LOGIC_TRIGGER',
            ),
          }),
        )
        .min(1)
        .describe('Per-signal assessments — include ALL evaluated signals'),
      thesisSummary: z.string().min(1).describe('Your current thesis summary across all positions'),
    }),
    async execute(params: {
      assessments: Array<{
        signalId: string;
        ticker: string;
        verdict: string;
        relevanceScore: number;
        reasoning: string;
        thesisAlignment: string;
        actionability: number;
        signalType?: string;
      }>;
      thesisSummary: string;
    }): Promise<ToolResult> {
      const tickers = [...new Set(params.assessments.map((a) => a.ticker))];
      const kept = params.assessments.filter((a) => a.verdict !== 'NOISE');
      const critical = params.assessments.filter((a) => a.verdict === 'CRITICAL');

      const report = {
        id: `assess-${randomUUID().slice(0, 8)}`,
        assessedAt: new Date().toISOString(),
        tickers,
        assessments: params.assessments.map((a) => ({
          signalId: a.signalId,
          ticker: a.ticker,
          verdict: a.verdict as 'CRITICAL' | 'IMPORTANT' | 'NOISE',
          relevanceScore: a.relevanceScore,
          reasoning: a.reasoning,
          thesisAlignment: a.thesisAlignment as 'SUPPORTS' | 'CHALLENGES' | 'NEUTRAL',
          actionability: a.actionability,
          ...(a.signalType ? { signalType: a.signalType as SignalType } : {}),
        })),
        signalsInput: params.assessments.length,
        signalsKept: kept.length,
        thesisSummary: params.thesisSummary,
        durationMs: workflowStartMs ? Date.now() - workflowStartMs.value : 0,
      };

      await assessmentStore.save(report);

      // Write reclassified signal types back to the archive
      if (signalArchive) {
        const reclassified = params.assessments.filter((a) => a.signalType);
        if (reclassified.length > 0) {
          let updated = 0;
          for (const a of reclassified) {
            try {
              const signal = await signalArchive.getById(a.signalId);
              if (signal && signal.type !== a.signalType) {
                await signalArchive.appendUpdate({
                  ...signal,
                  type: a.signalType as SignalType,
                  version: signal.version + 1,
                });
                updated++;
              }
            } catch (err) {
              log.warn('Failed to reclassify signal type', {
                signalId: a.signalId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          if (updated > 0) {
            log.info(`Reclassified ${updated} signal types in archive`);
          }
        }
      }

      log.info('Signal assessment saved', {
        id: report.id,
        total: params.assessments.length,
        critical: critical.length,
        kept: kept.length,
        noise: params.assessments.length - kept.length,
      });

      return {
        content:
          `Signal assessment saved.\n` +
          `Report ID: ${report.id}\n` +
          `Signals assessed: ${params.assessments.length}\n` +
          `Critical: ${critical.length}, Important: ${kept.length - critical.length}, Noise: ${params.assessments.length - kept.length}\n` +
          `Tickers: ${tickers.join(', ')}`,
      };
    },
  };

  return [saveSignalAssessment];
}
