/**
 * ProcessInsights workflow — multi-agent pipeline that analyzes the full
 * portfolio against recent signals and produces structured InsightReports.
 *
 * Stages:
 *   0. Research Analyst (serial)  — gathers data per position
 *   1. [Research Analyst, Risk Manager] (parallel) — deep analysis + risk
 *   2. Strategist (serial) — synthesis, saves InsightReport, updates brain
 */

import type { InsightStore } from './insight-store.js';
import type { Orchestrator } from '../agents/orchestrator.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('process-insights');

export interface ProcessInsightsOptions {
  insightStore: InsightStore;
}

export function registerProcessInsightsWorkflow(orchestrator: Orchestrator, _options: ProcessInsightsOptions): void {
  orchestrator.register({
    id: 'process-insights',
    name: 'Process Insights',
    stages: [
      // Stage 0: Research Analyst gathers data for all positions
      {
        agentId: 'research-analyst',
        buildMessage: () =>
          `Analyze all positions in the current portfolio.\n\n` +
          `## API Budget — minimize external calls\n` +
          `1. Call get_portfolio ONCE to see all current holdings\n` +
          `2. Call market_quotes ONCE with ALL tickers in a single batch to get prices\n` +
          `3. Call grep_signals for each ticker (last 7 days) — this is free (local files)\n` +
          `4. Call recall_signal_memories for each ticker — this is free (local search)\n` +
          `5. Call batch_enrich ONCE with all tickers that have signal activity,\n` +
          `   using fields: ['market', 'risk']. This is a SINGLE API call for all tickers.\n\n` +
          `PREFER batch_enrich over enrich_entity — it enriches all tickers in one API call.\n` +
          `If batch_enrich fails, it falls back to individual enrich_entity calls automatically.\n\n` +
          `Produce a structured data brief per position with: symbol, key data points, ` +
          `recent signals summary, sentiment direction, and any notable changes.\n\n` +
          `IMPORTANT: For each signal, preserve its exact ID (e.g. sig-xxx) and source link URL. ` +
          `These will be used for provenance tracking in the final report.`,
      },

      // Stage 1: Parallel deep analysis
      [
        {
          agentId: 'research-analyst',
          buildMessage: (prev) =>
            `Deepen your analysis on positions with significant signal activity.\n` +
            `Focus on: conflicting signals, sentiment shifts, upcoming catalysts, ` +
            `and technical pattern changes.\n\n` +
            `DO NOT re-call enrich_entity or market_quotes — use the data from Stage 0.\n` +
            `You may call grep_signals or recall_signal_memories if you need more signal context.\n\n` +
            `Previous data brief:\n${prev.get('research-analyst')?.text ?? ''}`,
        },
        {
          agentId: 'risk-manager',
          buildMessage: (prev) =>
            `Analyze full portfolio risk based on these positions.\n` +
            `Compute: sector exposure breakdown, concentration scoring, ` +
            `correlation detection, and drawdown analysis.\n\n` +
            `DO NOT call enrich_entity or market_quotes — all data is in the brief below.\n\n` +
            `Position data:\n${prev.get('research-analyst')?.text ?? ''}`,
        },
      ],

      // Stage 2: Strategist synthesizes and persists
      {
        agentId: 'strategist',
        buildMessage: (prev) => {
          const researchOutput = prev.get('research-analyst')?.text ?? '';
          const riskOutput = prev.get('risk-manager')?.text ?? '';

          return (
            `Synthesize insights for the entire portfolio.\n\n` +
            `## Research Analysis\n${researchOutput}\n\n` +
            `## Risk Analysis\n${riskOutput}\n\n` +
            `## Instructions\n` +
            `1. Call recall_signal_memories to review past portfolio-level observations\n` +
            `2. Call brain_get_memory and brain_get_emotion to review your current state\n` +
            `3. For each position, determine: rating (STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL), ` +
            `conviction (0-1), thesis, key signals (include signal ID and source URL in each), risks, and opportunities\n` +
            `4. Determine portfolio-level: overall health (STRONG/HEALTHY/CAUTIOUS/WEAK/CRITICAL), ` +
            `summary, sector themes, macro context, top risks, top opportunities, action items\n` +
            `5. Call save_insight_report with the complete structured report\n` +
            `6. Call brain_update_memory with your key findings\n` +
            `7. Call brain_update_emotion with your updated confidence and risk appetite\n` +
            `8. Call store_signal_memory for any significant new observations`
          );
        },
      },
    ],
  });

  logger.info('ProcessInsights workflow registered');
}
