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
import { gatherMacroData } from './macro-data-gatherer.js';
import type { MacroGathererOptions } from './macro-data-gatherer.js';
import { storeInsightMemories } from './memory-bridge.js';
import { mergeColdPositions } from './merge.js';
import type { ColdPosition } from './triage.js';
import { triagePositions } from './triage.js';
import type { Orchestrator } from '../agents/orchestrator.js';
import { emitProgress } from '../agents/orchestrator.js';
import type { AgentStepResult } from '../agents/types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { SignalMemoryStore } from '../memory/memory-store.js';
import { extractProfileEntries } from '../profiles/profile-bridge.js';
import type { TickerProfileStore } from '../profiles/profile-store.js';
import { snapFromInsight } from '../snap/snap-from-insight.js';
import type { SnapStore } from '../snap/snap-store.js';

const logger = createSubsystemLogger('process-insights');

export interface ProcessInsightsOptions {
  insightStore: InsightStore;
  gathererOptions?: DataGathererOptions;
  /** Macro gatherer — reads micro insights for portfolio-wide synthesis. */
  macroGathererOptions?: MacroGathererOptions;
  /** Memory store for the analyst role — used to store insight predictions for future reflection. */
  memoryStore?: SignalMemoryStore;
  /** Snap store — when provided, a snap brief is derived from the insight report. */
  snapStore?: SnapStore;
  /** Ticker profile store — when provided, per-asset knowledge is extracted from insight reports. */
  profileStore?: TickerProfileStore;
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
  'jintel_query',
  'enrich_entity',
  'enrich_position',
  'enrich_snapshot',
  'batch_enrich',
  'market_quotes',
  'price_history',
  'run_technical',
  'sanctions_screen',
  'get_news',
  'get_research',
  'get_sentiment',
  'get_derivatives',
  'get_short_interest',
  'get_fama_french',
  'get_social',
  'get_predictions',
  'get_discussions',
  'get_gdp',
  'get_inflation',
  'get_interest_rates',
  'get_sp500_multiples',
  'glob_signals',
  'grep_signals',
  'read_signal',
  'recall_signal_memories',
  'check_api_health',
  'watchlist_add',
  'watchlist_remove',
  'watchlist_list',
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
  const { insightStore, gathererOptions, macroGathererOptions, memoryStore, snapStore, profileStore } = options;
  const hasGatherer = !!gathererOptions || !!macroGathererOptions;

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
                `## Data Quality Guidance\n` +
                `Evaluate source quality critically:\n` +
                `- Lead with real EVENTS and CATALYSTS (earnings, analyst actions, regulatory filings, corporate developments, macro shifts) — not technicals.\n` +
                `- Promotional/clickbait content (listicles, "Is X a buy?", hype pieces) is low-quality. Weight it accordingly.\n` +
                `- Weigh event materiality against asset size (market cap is provided). Immaterial events are noise, not developments.\n` +
                `- Corroborated signals (multiple sources) rank higher than single-source articles.\n\n` +
                `## Positions Requiring Deep Analysis\n\n${dataBriefs}\n\n` +
                `## Instructions — complete in 1 iteration\n` +
                `Analyze ALL positions and output a structured brief per position:\n` +
                `- Sentiment direction (VERY_BULLISH/BULLISH/NEUTRAL/BEARISH/VERY_BEARISH) and conviction (0-1)\n` +
                `- Key outlook (1-2 sentences)\n` +
                `- Conflicting signals and sentiment shifts\n` +
                `- Catalysts and risks\n` +
                `- Cross-position connections (ONLY when a concrete, evidence-based link exists — e.g. shared supply chain, same macro driver, correlated sector): cite the specific data points that establish the link and estimate the magnitude of impact (high/medium/low). Do NOT fabricate connections.\n` +
                `- IMPORTANT: Preserve signal IDs (sig-xxx) and source URLs — the Strategist needs these for the report\n` +
                `\nDo NOT call store_signal_memory — the Strategist handles memory persistence.\n` +
                `Be concise — output a structured brief per position, not lengthy prose.\n`;

              if (warmBriefs) {
                prompt +=
                  `\n## Positions Requiring Quick Rating\n` +
                  `Moderate activity — 1-2 sentence sentiment (VERY_BULLISH/BULLISH/NEUTRAL/BEARISH/VERY_BEARISH) + conviction per position:\n\n${warmBriefs}\n`;
              }

              if (coldSummary) {
                prompt +=
                  `\n## Carried-Forward Positions (no analysis needed)\n` +
                  `Minimal activity, previous assessments carried forward:\n${coldSummary}\n`;
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
              `Complete in 1 iteration, no tool calls — output a concise structured risk assessment, not lengthy narrative.\n\n` +
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
          buildMessage: (prev) => buildStanceMessage('BULLISH', prev),
        },
        {
          agentId: 'bear-researcher',
          maxIterations: hasGatherer ? 1 : undefined,
          disabledTools: hasGatherer ? DEBATE_DISABLED_TOOLS : undefined,
          buildMessage: (prev) => buildStanceMessage('BEARISH', prev),
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
              `Adversarial analysts argue for/against each position. Agreement → HIGH conviction. Disagreement → flag uncertainty and explain your reasoning.\n\n` +
              (bull ? `### Bull Case\n${bull}\n\n` : '') +
              (bear ? `### Bear Case\n${bear}\n\n` : '');
          }

          if (coldSummary) {
            prompt += `## Carried-Forward\n${coldSummary}\n\n`;
          }

          prompt +=
            `## Instructions — 1 iteration, batch ALL tool calls\n` +
            `Call save_insight_report with snapshotId="${snapshotId}", plus brain_update_memory and brain_update_emotion in the SAME batch.\n\n` +
            `Fields:\n` +
            `- positions[]: symbol, name, rating (VERY_BULLISH/BULLISH/NEUTRAL/BEARISH/VERY_BEARISH), conviction, thesis (2-3 sentences explaining WHY — cite macro/sector/geopolitical drivers. Cross-position links ONLY with concrete evidence (shared supply chain, same macro driver, correlated sector): cite the evidence and estimate impact magnitude. Do NOT invent connections), keySignals[] (top 2 per position), risks[] (1-2 — ticker-specific risks belong HERE, not in portfolio.topRisks), opportunities[] (1-2 — ticker-specific opportunities belong HERE, not in portfolio.topOpportunities), memoryContext: null, priceTarget: null\n` +
            `- keySignals: { signalId: "sig-xxx" (copy EXACT ID), type, title, impact: "POSITIVE"|"NEGATIVE"|"NEUTRAL", confidence, url: null }\n` +
            `- portfolio: overallHealth, summary (≤2 sentences, top cross-cutting theme), intelSummary (2-3 sentences on signal patterns across positions), sectorThemes[], macroContext (1-2 sentences — current macro environment and how it affects the portfolio, citing real data like GDP, rates, inflation, market P/E), topRisks[] / topOpportunities[] / actionItems[] — **CROSS-CUTTING ONLY**: themes that span 2+ positions (e.g. "3 of 5 crypto holdings exposed to ETF-outflow pressure") or genuine portfolio-wide macro themes (concentration, correlation, sector rotation). A bullet that names a single ticker ("ICVT MFI at 97th percentile…", "AAPL PT cut to $180") is NOT cross-cutting — put it on that position's risks[]/opportunities[]. Observations only, NOT advice: "X is at Y" or "X shows Y", never "Buy/Sell/Reduce Z" — you inform, user decides\n` +
            `- emotionState: { confidence, riskAppetite, reason (1 sentence) }\n\n` +
            `Rules: keep all strings SHORT, no prose. NEVER write weight percentages in any string field (e.g. "BTC (37.3%)", "17.5% weight") — use weight to rank, not to mention. NEVER write a thesis or risk/opportunity that says "no developments are present" or "nothing to report" — if there is genuinely nothing material for an asset, write a thesis about the current state (price action, technicals, sector context) instead of saying you have nothing.`;

          return prompt;
        },
      },
    ],

    // Pre-aggregate data before the workflow stages run
    beforeWorkflow: hasGatherer
      ? async (outputs) => {
          const wfId = 'process-insights';
          emitProgress({
            workflowId: wfId,
            stage: 'activity',
            message: 'Gathering portfolio data and micro research outputs...',
            timestamp: new Date().toISOString(),
          });

          logger.info('Running data pre-aggregation...');
          pendingColdPositions = []; // Reset for this run

          // Try macro gatherer first (reads micro insights) — faster + cheaper
          if (macroGathererOptions) {
            const macroResult = await gatherMacroData(macroGathererOptions);

            if (macroResult && !macroResult.usedFallback) {
              logger.info('Using micro insights for macro workflow', {
                microCoverage: macroResult.microCoverage,
                totalPositions: macroResult.totalPositions,
                gatherMs: macroResult.gatherDurationMs,
              });

              emitProgress({
                workflowId: wfId,
                stage: 'activity',
                message: `Macro data gathered in ${(macroResult.gatherDurationMs / 1000).toFixed(1)}s — ${macroResult.microCoverage}/${macroResult.totalPositions} positions with micro research`,
                timestamp: new Date().toISOString(),
              });

              injectPseudoOutput(outputs, '__data_briefs', macroResult.microSummaries);
              injectPseudoOutput(outputs, '__risk_metrics', macroResult.riskMetrics);
              injectPseudoOutput(outputs, '__snapshot_id', macroResult.snapshotId);
              return;
            }

            // macroResult.usedFallback — briefs are available, do triage
            if (macroResult?.usedFallback && macroResult.briefs) {
              const triage = triagePositions(macroResult.briefs, null);
              pendingColdPositions = triage.cold;

              emitProgress({
                workflowId: wfId,
                stage: 'activity',
                message: `Data gathered in ${(macroResult.gatherDurationMs / 1000).toFixed(1)}s (fallback) — ${triage.hot.length} hot, ${triage.warm.length} warm, ${triage.cold.length} cold`,
                timestamp: new Date().toISOString(),
              });

              injectPseudoOutput(outputs, '__data_briefs', formatBriefsForContext(triage.hot));
              if (triage.warm.length > 0) {
                injectPseudoOutput(outputs, '__warm_briefs', formatBriefsForContext(triage.warm));
              }
              injectColdSummary(outputs, triage.cold);
              injectPseudoOutput(outputs, '__risk_metrics', macroResult.riskMetrics);
              injectPseudoOutput(outputs, '__snapshot_id', macroResult.snapshotId);
              return;
            }
          }

          // Direct raw data gathering (no macro gatherer or it returned null)
          if (!gathererOptions) {
            logger.warn('No gatherer options — workflow will use fallback mode');
            return;
          }

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

          injectPseudoOutput(outputs, '__data_briefs', formatBriefsForContext(triage.hot));

          if (triage.warm.length > 0) {
            injectPseudoOutput(outputs, '__warm_briefs', formatBriefsForContext(triage.warm));
          }

          injectColdSummary(outputs, triage.cold);
          injectPseudoOutput(outputs, '__risk_metrics', formatRiskMetrics(result.briefs));
          injectPseudoOutput(outputs, '__snapshot_id', result.snapshotId);
        }
      : undefined,

    // Merge cold positions and store insight memories for future reflection
    afterWorkflow: hasGatherer
      ? async () => {
          // 1. Merge cold positions into the final report
          if (pendingColdPositions.length > 0) {
            logger.info('Merging cold positions...', { count: pendingColdPositions.length });
            await mergeColdPositions(insightStore, pendingColdPositions);
            pendingColdPositions = [];
          }

          // 2. Store insight predictions as memories for outcome feedback loop
          const latestReport = await insightStore.getLatest();
          if (latestReport && memoryStore) {
            try {
              const { stored, skipped } = await storeInsightMemories(latestReport, memoryStore);
              logger.info('Insight memories stored for reflection', { stored, skipped });
            } catch (err) {
              logger.warn('Failed to store insight memories', {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          // 3. Derive a snap brief from the latest insight report
          if (latestReport && snapStore) {
            try {
              const microInsights = macroGathererOptions?.microInsightStore
                ? await macroGathererOptions.microInsightStore.getAllLatest()
                : undefined;
              const snap = snapFromInsight(latestReport, microInsights ? { microInsights } : undefined);
              await snapStore.save(snap);
              logger.info('Snap brief derived from insight report', { snapId: snap.id });
            } catch (err) {
              logger.warn('Failed to derive snap from insight report', {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          // 4. Extract per-asset knowledge into ticker profiles
          if (latestReport && profileStore) {
            try {
              const recentReports = await insightStore.getRecent(2);
              const previousReport = recentReports.length >= 2 ? recentReports[0] : null;
              const entries = extractProfileEntries(latestReport, previousReport);
              if (entries.length > 0) {
                const stored = await profileStore.storeBatch(entries);
                logger.info('Ticker profile entries stored', { stored });
              }
            } catch (err) {
              logger.warn('Failed to store ticker profile entries', {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      : undefined,
  });

  logger.info('ProcessInsights workflow registered');
}

// ---------------------------------------------------------------------------
// Helpers — shared logic extracted from workflow stages
// ---------------------------------------------------------------------------

/** Build the stance-specific prompt for bull/bear adversarial researchers. */
function buildStanceMessage(stance: 'BULLISH' | 'BEARISH', prev: Map<string, { text: string }>): string {
  const researchOutput = prev.get('research-analyst')?.text ?? '';
  const riskOutput = prev.get('risk-manager')?.text ?? '';
  const dataBriefs = prev.get('__data_briefs')?.text ?? '';

  const oppositeNoun = stance === 'BULLISH' ? 'bears' : 'bulls';
  const closingDetail = stance === 'BULLISH' ? 'upcoming catalysts' : 'downside risks';

  return (
    `Build the strongest possible ${stance} case for each position.\n` +
    `Use ONLY the data provided — do NOT call any tools.\n\n` +
    `## Research Brief\n${researchOutput}\n\n` +
    `## Risk Assessment\n${riskOutput}\n\n` +
    (dataBriefs ? `## Position Data\n${dataBriefs}\n\n` : '') +
    `For each position: ${stance.toLowerCase()} thesis, supporting evidence (cite specific numbers/signals), ` +
    `why ${oppositeNoun} are wrong, ${closingDetail}, and conviction (1-5).`
  );
}

// ---------------------------------------------------------------------------
// Helpers — reduce duplication in beforeWorkflow pseudo-output injection
// ---------------------------------------------------------------------------

type OutputMap = Map<string, AgentStepResult>;

function injectPseudoOutput(outputs: OutputMap, key: string, text: string): void {
  outputs.set(key, {
    agentId: key,
    text,
    messages: [],
    iterations: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    compactions: 0,
  });
}

function injectColdSummary(outputs: OutputMap, cold: ColdPosition[]): void {
  if (cold.length === 0) return;
  const coldLines = cold.map((c) => {
    const prev = c.previousInsight;
    if (prev) {
      return `- ${c.brief.symbol}: ${prev.rating} (conviction: ${prev.conviction}) — ${prev.thesis.slice(0, 80)}`;
    }
    return `- ${c.brief.symbol}: No previous assessment (new position, minimal activity)`;
  });
  injectPseudoOutput(outputs, '__cold_summary', coldLines.join('\n'));
}
