/**
 * Signal Assessment workflow — agent-based Tier 2 signal curation.
 *
 * Pipeline:
 *   0. Data pre-aggregation (code, no LLM) — load curated signals, thesis, format compactly
 *   1. Research Analyst (LLM, 1 iteration) — classify signals as CRITICAL/IMPORTANT/NOISE
 *   2. Strategist (LLM, 1 iteration) — score against thesis, persist via save_signal_assessment
 *
 * Follows the ProcessInsights workflow pattern:
 *   - beforeWorkflow: pre-aggregate data, inject as pseudo-agent outputs
 *   - All tools disabled (agents do pure analysis in a single iteration)
 *   - Strategist uses a tool call to persist structured output
 *   - afterWorkflow: update watermark
 */

import { type TickerPosition, type TickerThesis, formatSignalsForAssessment } from './assessment-formatter.js';
import type { AssessmentStore } from './assessment-store.js';
import type { AssessmentConfig } from './assessment-types.js';
import type { CuratedSignalStore } from './curated-signal-store.js';
import type { CuratedSignal } from './types.js';
import type { Orchestrator } from '../../agents/orchestrator.js';
import { emitProgress } from '../../agents/orchestrator.js';
import type { InsightStore } from '../../insights/insight-store.js';
import { createSubsystemLogger } from '../../logging/logger.js';
import type { PortfolioSnapshotStore } from '../../portfolio/snapshot-store.js';

const logger = createSubsystemLogger('signal-assessment');

export interface SignalAssessmentWorkflowOptions {
  curatedSignalStore: CuratedSignalStore;
  assessmentStore: AssessmentStore;
  insightStore: InsightStore;
  snapshotStore: PortfolioSnapshotStore;
  config: AssessmentConfig;
  /** Mutable ref shared with the assessment tool for accurate durationMs tracking. */
  assessmentWorkflowStartMs?: { value: number };
}

// All RA tools disabled — data is pre-aggregated, pure analysis in 1 iteration.
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
  'get_current_time',
  'calculate',
];

// Strategist: only save_signal_assessment enabled
const STRATEGIST_DISABLED_TOOLS = [
  'brain_get_memory',
  'brain_update_memory',
  'brain_get_emotion',
  'brain_update_emotion',
  'brain_get_persona',
  'brain_set_persona',
  'brain_get_log',
  'brain_rollback',
  'portfolio_reasoning',
  'get_portfolio',
  'security_audit_check',
  'store_signal_memory',
  'recall_signal_memories',
  'save_insight_report',
  'get_current_time',
  'calculate',
  // Keep: save_signal_assessment
];

export function registerSignalAssessmentWorkflow(
  orchestrator: Orchestrator,
  options: SignalAssessmentWorkflowOptions,
): void {
  const { curatedSignalStore, assessmentStore, insightStore, snapshotStore, assessmentWorkflowStartMs } = options;

  // State shared between beforeWorkflow and afterWorkflow
  let latestCuratedAt = '';
  let signalCount = 0;

  orchestrator.register({
    id: 'signal-assessment',
    name: 'Signal Assessment',
    stages: [
      // Stage 0: Research Analyst — classify signals
      {
        agentId: 'research-analyst',
        maxIterations: 1,
        disabledTools: RA_DISABLED_TOOLS,
        buildMessage: (prev) => {
          const signalData = prev.get('__assessment_signals')?.text ?? '';

          if (!signalData) {
            return 'No curated signals to assess. Respond with: "No signals to assess."';
          }

          return (
            `You are evaluating curated portfolio signals for relevance and quality. ` +
            `ALL data is provided below — no tools are available.\n\n` +
            `For EACH signal:\n` +
            `1. Classify verdict:\n` +
            `   - CRITICAL: Must-see signal that could change a position decision\n` +
            `   - IMPORTANT: Useful context that reinforces or challenges the thesis\n` +
            `   - NOISE: Redundant, stale, generic, or irrelevant to this position\n` +
            `2. Reclassify signal type if the heuristic got it wrong. The current type is shown ` +
            `in the data — override it if the content clearly belongs to a different category:\n` +
            `   - FUNDAMENTAL: earnings, revenue, EPS, dividends, guidance, valuations, profit, M&A, buyback\n` +
            `   - MACRO: Fed, interest rates, GDP, inflation, tariffs, sanctions, geopolitical, trade policy\n` +
            `   - TECHNICAL: moving averages, RSI, MACD, support/resistance, breakout, volume, price targets\n` +
            `   - SENTIMENT: analyst ratings, upgrades/downgrades, social buzz, fear/greed, investor mood\n` +
            `   - FILINGS: SEC filings, proxy statements, insider transactions, regulatory filings\n` +
            `   - SOCIALS: social media activity, viral posts, influencer mentions, Reddit/Twitter/TikTok\n` +
            `   - NEWS: general market news, industry developments, product launches, partnerships, leadership\n` +
            `   - TRADING_LOGIC_TRIGGER: price alerts, stop-loss triggers, rebalancing signals\n\n` +
            `Watch for:\n` +
            `- Clustered signals (same group: tag) — count as ONE event, pick the best source\n` +
            `- Generic roundup articles — usually NOISE\n` +
            `- Stale signals that repeat what's already in the thesis\n` +
            `- Signals that contradict the thesis — these are CRITICAL even if low-confidence\n\n` +
            `Output a structured list per ticker:\n` +
            `## TICKER\n` +
            `- [signal-id] VERDICT (TYPE if reclassified): reasoning (1 sentence)\n\n` +
            `Be concise. Complete in 1 iteration.\n\n` +
            `${signalData}`
          );
        },
      },

      // Stage 1: Strategist — score against thesis, persist
      {
        agentId: 'strategist',
        maxIterations: 1,
        disabledTools: STRATEGIST_DISABLED_TOOLS,
        buildMessage: (prev) => {
          const raOutput = prev.get('research-analyst')?.text ?? '';
          const signalData = prev.get('__assessment_signals')?.text ?? '';

          if (!signalData) {
            return 'No curated signals were available for assessment. Respond with: "No signals to assess."';
          }

          return (
            `The Research Analyst has classified portfolio signals below. ` +
            `Your job: score each signal against your active investment thesis ` +
            `and save the results using save_signal_assessment.\n\n` +
            `## Research Analyst Assessment\n${raOutput}\n\n` +
            `## Original Signal Data\n${signalData}\n\n` +
            `## Instructions — 1 iteration, 1 tool call\n` +
            `Call save_signal_assessment with:\n` +
            `- assessments[]: ALL signals (including NOISE), each with:\n` +
            `  - signalId: exact ID from the data (e.g. sig-xxx)\n` +
            `  - ticker: portfolio ticker\n` +
            `  - verdict: CRITICAL/IMPORTANT/NOISE (you may override RA if your thesis disagrees)\n` +
            `  - relevanceScore: 0-1 thesis-aligned relevance\n` +
            `  - reasoning: 1-2 sentences\n` +
            `  - thesisAlignment: SUPPORTS/CHALLENGES/NEUTRAL\n` +
            `  - actionability: 0-1 how actionable\n` +
            `  - signalType: include ONLY if the RA flagged a reclassification (e.g. NEWS→MACRO)\n` +
            `- thesisSummary: your current thesis in 2-3 sentences\n\n` +
            `Be concise. Focus on why each signal matters (or doesn't) to your thesis.`
          );
        },
      },
    ],

    // Pre-aggregate curated signals + thesis context
    beforeWorkflow: async (outputs) => {
      // Track workflow start time for accurate durationMs in assessment reports
      if (assessmentWorkflowStartMs) {
        assessmentWorkflowStartMs.value = Date.now();
      }

      const wfId = 'signal-assessment';
      emitProgress({
        workflowId: wfId,
        stage: 'activity',
        message: 'Loading curated signals and thesis context...',
        timestamp: new Date().toISOString(),
      });

      // 1. Check watermark — skip if no new curated signals
      const watermark = await assessmentStore.getLatestWatermark();
      const sinceDate = watermark
        ? watermark.lastCuratedAt
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      // 2. Get portfolio tickers
      const snapshot = await snapshotStore.getLatest();
      if (!snapshot || snapshot.positions.length === 0) {
        logger.info('No portfolio — skipping assessment');
        // Set empty to short-circuit agents
        outputs.set('__assessment_signals', {
          agentId: '__assessment_signals',
          text: '',
          messages: [],
          iterations: 0,
          usage: { inputTokens: 0, outputTokens: 0 },
          compactions: 0,
        });
        return;
      }

      const tickers = snapshot.positions.map((p) => p.symbol);

      // 3. Query curated signals since watermark
      const curatedSignals = await curatedSignalStore.queryByTickers(tickers, { since: sinceDate.slice(0, 10) });

      // Filter to only signals curated after the watermark
      const newSignals = watermark
        ? curatedSignals.filter((cs) => cs.curatedAt > watermark.lastCuratedAt)
        : curatedSignals;

      if (newSignals.length === 0) {
        logger.info('No new curated signals to assess');
        outputs.set('__assessment_signals', {
          agentId: '__assessment_signals',
          text: '',
          messages: [],
          iterations: 0,
          usage: { inputTokens: 0, outputTokens: 0 },
          compactions: 0,
        });
        return;
      }

      signalCount = newSignals.length;
      latestCuratedAt = newSignals.reduce(
        (latest, cs) => (cs.curatedAt > latest ? cs.curatedAt : latest),
        newSignals[0].curatedAt,
      );

      // 4. Load thesis context from latest InsightReport
      const thesisByTicker = new Map<string, TickerThesis>();
      const latestReport = await insightStore.getLatest();
      if (latestReport) {
        for (const pos of latestReport.positions) {
          thesisByTicker.set(pos.symbol, {
            rating: pos.rating,
            conviction: pos.conviction,
            thesis: pos.thesis,
          });
        }
      }

      // 5. Build position context
      const positionsByTicker = new Map<string, TickerPosition>();
      for (const pos of snapshot.positions) {
        positionsByTicker.set(pos.symbol, {
          marketValue: pos.marketValue,
          portfolioPercent: snapshot.totalValue > 0 ? pos.marketValue / snapshot.totalValue : 0,
        });
      }

      // 6. Group signals by ticker
      const signalsByTicker = new Map<string, CuratedSignal[]>();
      for (const cs of newSignals) {
        for (const score of cs.scores) {
          const group = signalsByTicker.get(score.ticker);
          if (group) {
            // Deduplicate by signal ID within ticker group
            if (!group.some((existing) => existing.signal.id === cs.signal.id)) {
              group.push(cs);
            }
          } else {
            signalsByTicker.set(score.ticker, [cs]);
          }
        }
      }

      // 7. Format compactly for agent consumption
      const formatted = formatSignalsForAssessment(signalsByTicker, thesisByTicker, positionsByTicker);

      emitProgress({
        workflowId: wfId,
        stage: 'activity',
        message: `Loaded ${newSignals.length} curated signals across ${signalsByTicker.size} tickers`,
        timestamp: new Date().toISOString(),
      });

      outputs.set('__assessment_signals', {
        agentId: '__assessment_signals',
        text: formatted,
        messages: [],
        iterations: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        compactions: 0,
      });
    },

    // Update watermark after successful run
    afterWorkflow: async () => {
      if (latestCuratedAt && signalCount > 0) {
        const latestReport = await assessmentStore.getLatest();
        await assessmentStore.saveWatermark({
          lastRunAt: new Date().toISOString(),
          lastCuratedAt: latestCuratedAt,
          signalsAssessed: signalCount,
          signalsKept: latestReport?.signalsKept ?? 0,
        });
        logger.info('Assessment watermark updated', { signalCount, latestCuratedAt });
      }

      // Reset shared state
      latestCuratedAt = '';
      signalCount = 0;
    },
  });

  logger.info('SignalAssessment workflow registered');
}
