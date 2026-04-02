/**
 * Full Curation workflow — agent-based signal assessment pipeline.
 *
 * Pipeline:
 *   beforeWorkflow: Pre-aggregate signals + thesis context for agents
 *   Stage 0: Research Analyst (LLM, 1 iteration) — classify CRITICAL/IMPORTANT/NOISE
 *   Stage 1: Strategist (LLM, 1 iteration) — score against thesis, persist via save_signal_assessment
 *   afterWorkflow: update assessment watermark
 *
 * Signal ingestion happens upstream: micro flow fetches Jintel per-ticker every 5 min,
 * and the scheduler's 15-min tick fetches CLI/RSS/MCP data sources. This workflow
 * reads from the already-populated archive — no fetching here.
 *
 * Emits WorkflowProgressEvents throughout for live UI activity log.
 * Used by the "Run Curation" button in the UI. The separate `signal-assessment`
 * workflow remains for scheduler-only Tier 2 runs.
 */

import { type TickerPosition, type TickerThesis, formatSignalsForAssessment } from './assessment-formatter.js';
import type { AssessmentStore } from './assessment-store.js';
import type { AssessmentConfig } from './assessment-types.js';
import type { Orchestrator } from '../../agents/orchestrator.js';
import { emitProgress } from '../../agents/orchestrator.js';
import type { InsightStore } from '../../insights/insight-store.js';
import { createSubsystemLogger } from '../../logging/logger.js';
import type { PortfolioSnapshotStore } from '../../portfolio/snapshot-store.js';
import type { SignalArchive } from '../archive.js';
import { DEFAULT_SPAM_PATTERNS, deduplicateByTitle, filterSignals } from '../signal-filter.js';
import type { Signal } from '../types.js';

const logger = createSubsystemLogger('full-curation');

export interface FullCurationWorkflowOptions {
  signalArchive: SignalArchive;
  assessmentStore: AssessmentStore;
  insightStore: InsightStore;
  snapshotStore: PortfolioSnapshotStore;
  assessmentConfig: AssessmentConfig;
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

const WF_ID = 'full-curation';

export function registerFullCurationWorkflow(orchestrator: Orchestrator, options: FullCurationWorkflowOptions): void {
  const { signalArchive, assessmentStore, insightStore, snapshotStore, assessmentWorkflowStartMs } = options;

  // State shared between beforeWorkflow and afterWorkflow
  let latestCuratedAt = '';
  let signalCount = 0;

  orchestrator.register({
    id: WF_ID,
    name: 'Full Curation',
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

    beforeWorkflow: async (outputs) => {
      // Track workflow start time for accurate durationMs in assessment reports
      if (assessmentWorkflowStartMs) {
        assessmentWorkflowStartMs.value = Date.now();
      }

      // Pre-aggregation: load signals + thesis context for agent assessment
      emitProgress({
        workflowId: WF_ID,
        stage: 'activity',
        message: 'Loading signals and thesis context...',
        timestamp: new Date().toISOString(),
      });

      // Load signals from the archive (already populated by micro flow + data source fetches)
      const snapshot = await snapshotStore.getLatest();
      if (!snapshot || snapshot.positions.length === 0) {
        logger.info('No portfolio — skipping assessment');
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
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      // Query and filter signals from archive
      const rawSignals = await signalArchive.query({ tickers, since: sevenDaysAgo });
      const filtered = filterSignals(rawSignals, {
        relevantTickers: new Set(tickers),
        spamPatterns: DEFAULT_SPAM_PATTERNS,
      });

      // Only signals ingested after the assessment watermark
      const watermark = await assessmentStore.getLatestWatermark();
      const newSignals = watermark ? filtered.filter((s) => s.ingestedAt > watermark.lastCuratedAt) : filtered;

      if (newSignals.length === 0) {
        logger.info('No new signals to assess');
        emitProgress({
          workflowId: WF_ID,
          stage: 'activity',
          message: 'No new signals to assess — skipping agents',
          timestamp: new Date().toISOString(),
        });
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

      // Dedup by title and trim to a reasonable batch for agents
      const deduped = deduplicateByTitle(newSignals);
      const trimmed = deduped.sort((a, b) => b.confidence - a.confidence).slice(0, 30);

      signalCount = trimmed.length;
      latestCuratedAt = newSignals.reduce(
        (latest, s) => (s.ingestedAt > latest ? s.ingestedAt : latest),
        newSignals[0].ingestedAt,
      );

      // Load thesis context from latest InsightReport
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

      // Build position context
      const positionsByTicker = new Map<string, TickerPosition>();
      for (const pos of snapshot.positions) {
        positionsByTicker.set(pos.symbol, {
          marketValue: pos.marketValue,
          portfolioPercent: snapshot.totalValue > 0 ? pos.marketValue / snapshot.totalValue : 0,
        });
      }

      // Group signals by ticker
      const signalsByTicker = groupByTicker(trimmed);

      // Format compactly for agent consumption
      const formatted = formatSignalsForAssessment(signalsByTicker, thesisByTicker, positionsByTicker);

      emitProgress({
        workflowId: WF_ID,
        stage: 'activity',
        message: `Loaded ${trimmed.length} signals across ${signalsByTicker.size} tickers for agent assessment`,
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

  logger.info('FullCuration workflow registered');
}

function groupByTicker(signals: Signal[]): Map<string, Signal[]> {
  const byTicker = new Map<string, Signal[]>();
  for (const s of signals) {
    for (const asset of s.assets) {
      const group = byTicker.get(asset.ticker);
      if (group) {
        if (!group.some((existing) => existing.id === s.id)) {
          group.push(s);
        }
      } else {
        byTicker.set(asset.ticker, [s]);
      }
    }
  }
  return byTicker;
}
