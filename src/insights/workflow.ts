/**
 * ProcessInsights workflow — multi-agent pipeline that analyzes the full
 * portfolio against recent signals and produces structured InsightReports.
 *
 * Pipeline:
 *   0. Data Gathering (code, no LLM) — fetches all data in parallel
 *   1. Triage (code, no LLM) — scores positions → hot / warm / cold
 *   2. Research Analyst (LLM) — deep analysis on hot + quick pass on warm
 *   3. Risk Manager (LLM) — portfolio risk from research brief
 *   4. Strategist (LLM) — synthesis, saves InsightReport, updates brain
 *   5. Merge (code) — carry forward cold positions from previous report
 */

import type { DataGathererOptions } from './data-gatherer.js';
import { formatBriefsForContext, gatherDataBriefs } from './data-gatherer.js';
import type { InsightStore } from './insight-store.js';
import { mergeColdPositions } from './merge.js';
import type { ColdPosition } from './triage.js';
import { triagePositions } from './triage.js';
import type { Orchestrator } from '../agents/orchestrator.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('process-insights');

export interface ProcessInsightsOptions {
  insightStore: InsightStore;
  gathererOptions?: DataGathererOptions;
}

// Tools to disable per agent when data is pre-aggregated.
// If the tool isn't in the agent's profile, the filter is a no-op.
const RA_DISABLED_TOOLS = [
  // All data-gathering tools — data is already in context
  'search_entities',
  'enrich_entity',
  'batch_enrich',
  'market_quotes',
  'news_search',
  'sanctions_screen',
  'web_search',
  'enrich_position',
  'enrich_snapshot',
  'glob_signals',
  'grep_signals',
  'read_signal',
  'recall_signal_memories',
  'query_data_source',
  'list_data_sources',
  'check_api_health',
  'watchlist_add',
  'watchlist_remove',
  'watchlist_list',
  'resolve_symbol',
  'run_technical',
  // Keep: get_current_time, calculate, store_signal_memory
];

const RM_DISABLED_TOOLS = [
  'recall_signal_memories',
  'check_api_health',
  'diagnose_data_error',
  'sanctions_screen',
  'security_audit_check',
  // Keep: risk tools (analyze_exposure, etc.), calculate, get_current_time, store_signal_memory
];

const STRATEGIST_DISABLED_TOOLS = [
  'get_portfolio', // Data already in context
  // Keep: brain tools, save_insight_report, recall_signal_memories, portfolio_reasoning, etc.
];

export function registerProcessInsightsWorkflow(orchestrator: Orchestrator, options: ProcessInsightsOptions): void {
  const { insightStore, gathererOptions } = options;
  const hasGatherer = !!gathererOptions;

  // Shared state between beforeWorkflow and afterWorkflow hooks
  let pendingColdPositions: ColdPosition[] = [];

  orchestrator.register({
    id: 'process-insights',
    name: 'Process Insights',
    stages: [
      // Stage 0: Research Analyst — analyzes pre-aggregated data (no tool calls for data)
      {
        agentId: 'research-analyst',
        disabledTools: hasGatherer ? RA_DISABLED_TOOLS : undefined,
        buildMessage: (prev) => {
          const dataBriefs = prev.get('__data_briefs')?.text;
          const warmBriefs = prev.get('__warm_briefs')?.text;
          const coldSummary = prev.get('__cold_summary')?.text;

          // If pre-aggregated data exists, use it (no tool calls needed)
          if (dataBriefs) {
            let prompt =
              `All portfolio data has been pre-aggregated below — no data-gathering tools are available. ` +
              `Analyze ONLY using the data provided.\n\n` +
              `## Positions Requiring Deep Analysis\n\n${dataBriefs}\n\n` +
              `## Instructions\n` +
              `For each position, produce a focused analysis in ONE pass:\n` +
              `- Rating direction (STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL) and conviction (0-1)\n` +
              `- Key thesis (1-2 sentences)\n` +
              `- Conflicting signals and sentiment shifts\n` +
              `- Catalysts and risks\n` +
              `- Preserve signal IDs (sig-xxx) and source URLs for provenance\n` +
              `\nBe concise — output a structured brief per position, not lengthy prose.\n`;

            if (warmBriefs) {
              prompt +=
                `\n## Positions Requiring Quick Rating\n` +
                `These positions have moderate activity. Provide a brief 1-2 sentence rating ` +
                `(STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL) with conviction for each:\n\n${warmBriefs}\n`;
            }

            if (coldSummary) {
              prompt +=
                `\n## Carried-Forward Positions (no analysis needed)\n` +
                `These positions have minimal activity and their previous ratings are carried forward:\n${coldSummary}\n`;
            }

            return prompt;
          }

          // Fallback: original behavior if no pre-aggregated data
          return (
            `Analyze all positions in the current portfolio.\n\n` +
            `## API Budget — minimize external calls\n` +
            `You MUST minimize tool calls. Use batch parameters wherever possible.\n\n` +
            `1. Call get_portfolio ONCE to see all current holdings\n` +
            `2. Call market_quotes ONCE with ALL tickers in a single batch\n` +
            `3. Call grep_signals ONCE with tickers=[...all tickers...] and since=(7 days ago)\n` +
            `4. Call recall_signal_memories ONCE with tickers=[...all tickers...]\n` +
            `5. Call batch_enrich ONCE with all tickers, fields: ['market', 'risk']\n\n` +
            `CRITICAL: Do NOT loop over tickers individually.\n\n` +
            `## Output — structured research brief per position\n` +
            `For each position produce:\n` +
            `- Symbol, name, key data points (price, market cap, P/E, etc.)\n` +
            `- Recent signals summary with sentiment direction\n` +
            `- Deep analysis: conflicting signals, sentiment shifts, upcoming catalysts\n` +
            `- Notable changes or anomalies\n\n` +
            `IMPORTANT: Preserve signal IDs (sig-xxx) and source URLs for provenance.`
          );
        },
      },

      // Stage 1: Risk Manager — portfolio risk from research brief
      {
        agentId: 'risk-manager',
        disabledTools: hasGatherer ? RM_DISABLED_TOOLS : undefined,
        buildMessage: (prev) => {
          const dataBriefs = prev.get('__data_briefs')?.text;
          const raOutput = prev.get('research-analyst')?.text ?? '';

          return (
            `Analyze full portfolio risk using ONLY the data provided below.\n` +
            `Compute: sector exposure, concentration (HHI), correlation detection, drawdown.\n` +
            `Use your risk tools (analyze_exposure, score_concentration, etc.) and calculate.\n` +
            `Be concise — output structured risk metrics, not lengthy narrative.\n\n` +
            (dataBriefs ? `## Pre-Aggregated Position Data\n${dataBriefs}\n\n` : '') +
            `## Research Analysis\n${raOutput}`
          );
        },
      },

      // Stage 2: Strategist synthesizes and persists
      {
        agentId: 'strategist',
        disabledTools: hasGatherer ? STRATEGIST_DISABLED_TOOLS : undefined,
        buildMessage: (prev) => {
          const researchOutput = prev.get('research-analyst')?.text ?? '';
          const riskOutput = prev.get('risk-manager')?.text ?? '';
          const coldSummary = prev.get('__cold_summary')?.text;

          let prompt =
            `Synthesize insights for the entire portfolio.\n\n` +
            `## Research Analysis\n${researchOutput}\n\n` +
            `## Risk Analysis\n${riskOutput}\n\n`;

          if (coldSummary) {
            prompt += `## Carried-Forward Positions\n${coldSummary}\n\n`;
          }

          prompt +=
            `## Instructions — complete in 2 iterations\n` +
            `**Iteration 1** — Gather your context (batch ALL these calls together):\n` +
            `  recall_signal_memories, brain_get_memory, brain_get_emotion, get_current_time\n\n` +
            `**Iteration 2** — Analyze and persist (batch ALL these calls together):\n` +
            `  - For each position: rating (STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL), ` +
            `conviction (0-1), thesis, key signals (include signal ID + source URL), risks, opportunities\n` +
            `  - Include carried-forward positions with their previous ratings\n` +
            `  - Portfolio-level: overall health, summary, sector themes, macro context, top risks, top opportunities, action items\n` +
            `  - Call save_insight_report, brain_update_memory, brain_update_emotion, store_signal_memory ALL in one batch\n` +
            `\nBe concise. Do NOT call get_portfolio — all position data is in the research/risk analysis above.`;

          return prompt;
        },
      },
    ],

    // Pre-aggregate data before the workflow stages run
    beforeWorkflow: gathererOptions
      ? async (outputs) => {
          logger.info('Running data pre-aggregation...');
          pendingColdPositions = []; // Reset for this run
          const result = await gatherDataBriefs(gathererOptions);

          if (result.briefs.length === 0) {
            logger.warn('No positions found — workflow will use fallback mode');
            return;
          }

          const triage = triagePositions(result.briefs, result.previousReport);
          pendingColdPositions = triage.cold;
          logger.info('Triage complete', {
            hot: triage.hot.length,
            warm: triage.warm.length,
            cold: triage.cold.length,
            gatherMs: result.gatherDurationMs,
          });

          // Inject pre-aggregated data as pseudo-agent outputs
          outputs.set('__data_briefs', {
            agentId: '__data_briefs',
            text: formatBriefsForContext(triage.hot),
            messages: [],
            iterations: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
            compactions: 0,
          });

          if (triage.warm.length > 0) {
            outputs.set('__warm_briefs', {
              agentId: '__warm_briefs',
              text: formatBriefsForContext(triage.warm),
              messages: [],
              iterations: 0,
              usage: { inputTokens: 0, outputTokens: 0 },
              compactions: 0,
            });
          }

          if (triage.cold.length > 0) {
            const coldLines = triage.cold.map((c) => {
              const prev = c.previousInsight;
              if (prev) {
                return `- ${c.brief.symbol}: ${prev.rating} (conviction: ${prev.conviction}) — ${prev.thesis.slice(0, 80)}`;
              }
              return `- ${c.brief.symbol}: No previous rating (new position, minimal activity)`;
            });
            outputs.set('__cold_summary', {
              agentId: '__cold_summary',
              text: coldLines.join('\n'),
              messages: [],
              iterations: 0,
              usage: { inputTokens: 0, outputTokens: 0 },
              compactions: 0,
            });
          }

          // Store snapshot ID for the insight report
          outputs.set('__snapshot_id', {
            agentId: '__snapshot_id',
            text: result.snapshotId,
            messages: [],
            iterations: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
            compactions: 0,
          });
        }
      : undefined,

    // Merge cold positions into the final report after the Strategist saves
    afterWorkflow: gathererOptions
      ? async () => {
          if (pendingColdPositions.length === 0) return;
          logger.info('Merging cold positions...', { count: pendingColdPositions.length });
          await mergeColdPositions(insightStore, pendingColdPositions);
          pendingColdPositions = [];
        }
      : undefined,
  });

  logger.info('ProcessInsights workflow registered');
}
