/**
 * ProcessInsights workflow — multi-agent pipeline that analyzes the full
 * portfolio against recent signals and produces structured InsightReports.
 *
 * Pipeline:
 *   0. Data Gathering + Triage (code, no LLM) — fetches data sources, ingests signals, scores positions
 *   1. Research Analyst + Risk Manager (LLM, parallel) — deep analysis + risk assessment simultaneously
 *   2. Bull + Bear Researchers (LLM, parallel) — adversarial debate, argues from RA/RM evidence
 *   3. Strategist (LLM) — synthesis weighing bull/bear debate, saves InsightReport, updates brain
 *   4. Merge (code) — carry forward cold positions from previous report
 *   5. Memory Bridge (code) — store position-level predictions for future reflection
 */

import type { DataGathererOptions } from './data-gatherer.js';
import { formatBriefsForContext, formatRiskMetrics, gatherDataBriefs } from './data-gatherer.js';
import type { InsightStore } from './insight-store.js';
import { storeInsightMemories } from './memory-bridge.js';
import { mergeColdPositions } from './merge.js';
import type { ColdPosition } from './triage.js';
import { triagePositions } from './triage.js';
import type { Orchestrator } from '../agents/orchestrator.js';
import { emitProgress } from '../agents/orchestrator.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { SignalMemoryStore } from '../memory/memory-store.js';

const logger = createSubsystemLogger('process-insights');

export interface ProcessInsightsOptions {
  insightStore: InsightStore;
  gathererOptions?: DataGathererOptions;
  /** Memory store for the analyst role — used to store insight predictions for future reflection. */
  memoryStore?: SignalMemoryStore;
}

// Tools to disable per agent when data is pre-aggregated.
// If the tool isn't in the agent's profile, the filter is a no-op.
//
// RA and RM are pure analysis stages — ALL tools disabled so the LLM
// emits text in a single iteration with zero tool-call overhead.
//
// Bull/Bear researchers are advocacy-only — no tools needed, they argue
// from the data RA already gathered.
const DEBATE_DISABLED_TOOLS = ['recall_signal_memories'];

const RA_DISABLED_TOOLS = [
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
  'store_signal_memory',
  'get_current_time', // Not needed — data is pre-aggregated with timestamps
  'calculate', // Not needed — risk metrics are pre-computed
];

const RM_DISABLED_TOOLS = [
  'recall_signal_memories',
  'store_signal_memory',
  'check_api_health',
  'diagnose_data_error',
  'sanctions_screen',
  'security_audit_check',
  'analyze_exposure', // Pre-computed in risk metrics
  'calculate', // Pre-computed in risk metrics
  'get_current_time', // Not needed — analysis is time-independent
];

const STRATEGIST_DISABLED_TOOLS = [
  'get_portfolio', // Data already in context
  'recall_signal_memories', // Memories already in RA briefs
  'brain_get_memory', // Not needed — synthesize from RA/RM output
  'brain_get_emotion', // Not needed — set new emotion based on analysis
  'get_current_time', // Not needed for report
  // Keep: save_insight_report, brain_update_memory, brain_update_emotion, store_signal_memory
];

export function registerProcessInsightsWorkflow(orchestrator: Orchestrator, options: ProcessInsightsOptions): void {
  const { insightStore, gathererOptions, memoryStore } = options;
  const hasGatherer = !!gathererOptions;

  // Shared state between beforeWorkflow and afterWorkflow hooks
  let pendingColdPositions: ColdPosition[] = [];

  orchestrator.register({
    id: 'process-insights',
    name: 'Process Insights',
    stages: [
      // Stage 0: Research Analyst + Risk Manager — run in parallel
      // Both read from pre-aggregated data, neither depends on the other.
      // RA produces research briefs, RM produces risk assessment — Strategist synthesizes both.
      [
        {
          agentId: 'research-analyst',
          maxIterations: hasGatherer ? 1 : undefined,
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
                `## Instructions — complete in 1 iteration\n` +
                `Analyze ALL positions and output a structured brief per position:\n` +
                `- Rating direction (STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL) and conviction (0-1)\n` +
                `- Key thesis (1-2 sentences)\n` +
                `- Conflicting signals and sentiment shifts\n` +
                `- Catalysts and risks\n` +
                `- IMPORTANT: Preserve signal IDs (sig-xxx) and source URLs — the Strategist needs these for the report\n` +
                `\nDo NOT call store_signal_memory — the Strategist handles memory persistence.\n` +
                `Be concise — output a structured brief per position, not lengthy prose.\n`;

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

        {
          agentId: 'risk-manager',
          maxIterations: hasGatherer ? 1 : undefined,
          disabledTools: hasGatherer ? RM_DISABLED_TOOLS : undefined,
          buildMessage: (prev) => {
            const dataBriefs = prev.get('__data_briefs')?.text;
            const riskMetrics = prev.get('__risk_metrics')?.text;

            return (
              `Analyze full portfolio risk using ONLY the data provided below.\n` +
              `Risk metrics (weights, HHI, sector exposure) are already pre-computed — do NOT recalculate them.\n` +
              `Focus on: interpreting the metrics, detecting correlations, identifying risk-adjusted themes.\n` +
              `Complete in 1 iteration. Do NOT call any tools — all data is provided. Output analysis only.\n` +
              `Be concise — output structured risk assessment, not lengthy narrative.\n\n` +
              (riskMetrics ? `${riskMetrics}\n\n` : '') +
              (dataBriefs ? `## Pre-Aggregated Position Data\n${dataBriefs}\n\n` : '')
            );
          },
        },
      ],

      // Stage 1: Bull + Bear Researchers — adversarial debate (parallel)
      // Both receive RA + RM output + data briefs and argue from the evidence.
      // Bull builds the strongest bullish case; Bear builds the strongest bearish case.
      // The Strategist then weighs both perspectives to reduce confirmation bias.
      [
        {
          agentId: 'bull-researcher',
          maxIterations: hasGatherer ? 1 : undefined,
          disabledTools: hasGatherer ? DEBATE_DISABLED_TOOLS : undefined,
          buildMessage: (prev) => {
            const researchOutput = prev.get('research-analyst')?.text ?? '';
            const riskOutput = prev.get('risk-manager')?.text ?? '';
            const dataBriefs = prev.get('__data_briefs')?.text ?? '';

            return (
              `Build the strongest possible BULLISH case for each position.\n` +
              `Use ONLY the data provided — do NOT call any tools.\n\n` +
              `## Research Brief\n${researchOutput}\n\n` +
              `## Risk Assessment\n${riskOutput}\n\n` +
              (dataBriefs ? `## Position Data\n${dataBriefs}\n\n` : '') +
              `For each position: bullish thesis, supporting evidence (cite specific numbers/signals), ` +
              `why bears are wrong, upcoming catalysts, and conviction (1-5).`
            );
          },
        },
        {
          agentId: 'bear-researcher',
          maxIterations: hasGatherer ? 1 : undefined,
          disabledTools: hasGatherer ? DEBATE_DISABLED_TOOLS : undefined,
          buildMessage: (prev) => {
            const researchOutput = prev.get('research-analyst')?.text ?? '';
            const riskOutput = prev.get('risk-manager')?.text ?? '';
            const dataBriefs = prev.get('__data_briefs')?.text ?? '';

            return (
              `Build the strongest possible BEARISH case for each position.\n` +
              `Use ONLY the data provided — do NOT call any tools.\n\n` +
              `## Research Brief\n${researchOutput}\n\n` +
              `## Risk Assessment\n${riskOutput}\n\n` +
              (dataBriefs ? `## Position Data\n${dataBriefs}\n\n` : '') +
              `For each position: bearish thesis, supporting evidence (cite specific numbers/signals), ` +
              `why bulls are wrong, downside risks, and conviction (1-5).`
            );
          },
        },
      ],

      // Stage 2: Strategist — 1 iteration to batch all tool calls, 1 to emit final text
      {
        agentId: 'strategist',
        maxIterations: hasGatherer ? 2 : undefined,
        maxTokens: hasGatherer ? 16384 : undefined,
        disabledTools: hasGatherer ? STRATEGIST_DISABLED_TOOLS : undefined,
        buildMessage: (prev) => {
          const researchOutput = prev.get('research-analyst')?.text ?? '';
          const riskOutput = prev.get('risk-manager')?.text ?? '';
          const bullOutput = prev.get('bull-researcher')?.text ?? '';
          const bearOutput = prev.get('bear-researcher')?.text ?? '';
          const coldSummary = prev.get('__cold_summary')?.text;
          const snapshotId = prev.get('__snapshot_id')?.text ?? '';

          // Truncate agent outputs to reduce context — keep most important content.
          // Must be high enough to preserve signal IDs (sig-xxx) for all positions.
          const maxChars = 12000;
          const truncate = (s: string) => (s.length > maxChars ? s.slice(0, maxChars) + '\n[truncated]' : s);
          const research = truncate(researchOutput);
          const risk = truncate(riskOutput);

          // Bull/Bear get a smaller budget — they're supplementary perspectives
          const debateMaxChars = 6000;
          const debateTruncate = (s: string) =>
            s.length > debateMaxChars ? s.slice(0, debateMaxChars) + '\n[truncated]' : s;
          const bull = debateTruncate(bullOutput);
          const bear = debateTruncate(bearOutput);

          let prompt =
            `Synthesize insights and save a report. Be extremely concise in all string fields.\n\n` +
            `## Research\n${research}\n\n` +
            `## Risk\n${risk}\n\n`;

          if (bull || bear) {
            prompt +=
              `## Bull/Bear Debate\n` +
              `Two adversarial analysts have argued for and against each position. ` +
              `Weigh both perspectives — when they agree, conviction should be HIGH. ` +
              `When they disagree, flag the uncertainty and explain your reasoning.\n\n` +
              (bull ? `### Bull Case\n${bull}\n\n` : '') +
              (bear ? `### Bear Case\n${bear}\n\n` : '');
          }

          if (coldSummary) {
            prompt += `## Carried-Forward\n${coldSummary}\n\n`;
          }

          prompt +=
            `## Instructions — 1 iteration, batch ALL tool calls\n` +
            `Call save_insight_report with snapshotId="${snapshotId}":\n` +
            `- positions[]: symbol, name, rating, conviction, thesis (1 sentence MAX), keySignals[] (top 2 per position), risks[] (1-2 items), opportunities[] (1-2 items), memoryContext: null, priceTarget: null\n` +
            `- keySignals: { signalId: "sig-xxx" (copy EXACT ID), type, title (short), impact: "POSITIVE"|"NEGATIVE"|"NEUTRAL", confidence, url: null }\n` +
            `- portfolio: overallHealth, summary (2 sentences MAX), sectorThemes[], macroContext (1 sentence), topRisks[], topOpportunities[], actionItems[]\n` +
            `- emotionState: { confidence, riskAppetite, reason (1 sentence) }\n` +
            `Also call brain_update_memory and brain_update_emotion in the SAME batch.\n` +
            `Keep ALL string values SHORT. Do NOT write lengthy prose.`;

          return prompt;
        },
      },
    ],

    // Pre-aggregate data before the workflow stages run
    beforeWorkflow: gathererOptions
      ? async (outputs) => {
          const wfId = 'process-insights';
          emitProgress({
            workflowId: wfId,
            stage: 'activity',
            message: 'Gathering portfolio data, market quotes, and signals...',
            timestamp: new Date().toISOString(),
          });

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

          emitProgress({
            workflowId: wfId,
            stage: 'activity',
            message: `Data gathered in ${(result.gatherDurationMs / 1000).toFixed(1)}s — ${triage.hot.length} hot, ${triage.warm.length} warm, ${triage.cold.length} cold positions`,
            timestamp: new Date().toISOString(),
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

          // Pre-compute risk metrics so RM doesn't waste iterations on arithmetic
          outputs.set('__risk_metrics', {
            agentId: '__risk_metrics',
            text: formatRiskMetrics(result.briefs),
            messages: [],
            iterations: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
            compactions: 0,
          });

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

    // Merge cold positions and store insight memories for future reflection
    afterWorkflow: gathererOptions
      ? async () => {
          // 1. Merge cold positions into the final report
          if (pendingColdPositions.length > 0) {
            logger.info('Merging cold positions...', { count: pendingColdPositions.length });
            await mergeColdPositions(insightStore, pendingColdPositions);
            pendingColdPositions = [];
          }

          // 2. Store insight predictions as memories for outcome feedback loop
          if (memoryStore) {
            const latestReport = await insightStore.getLatest();
            if (latestReport) {
              try {
                const { stored, skipped } = await storeInsightMemories(latestReport, memoryStore);
                logger.info('Insight memories stored for reflection', { stored, skipped });
              } catch (err) {
                logger.warn('Failed to store insight memories', {
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }
        }
      : undefined,
  });

  logger.info('ProcessInsights workflow registered');
}
