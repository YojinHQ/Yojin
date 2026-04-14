/**
 * Curated signal resolvers — query signals from the archive, filter, and rank
 * by agent assessment verdicts.
 *
 * Reads directly from SignalArchive. Ranking comes from macro flow assessment
 * verdicts (CRITICAL > IMPORTANT > unassessed > NOISE). Simple quality-based
 * fallback for signals not yet assessed.
 *
 * Module-level state is set at startup via setter functions.
 */

import { fetchAllEnabledSources } from './fetch-data-source.js';
import { toGql } from './signals.js';
import type { SignalGql } from './signals.js';
import type { Orchestrator } from '../../../agents/orchestrator.js';
import { createSubsystemLogger } from '../../../logging/logger.js';
import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
import type { SignalArchive } from '../../../signals/archive.js';
import type { AssessmentStore } from '../../../signals/curation/assessment-store.js';
import type { SignalAssessment, SignalVerdict, ThesisAlignment } from '../../../signals/curation/assessment-types.js';
import { detectConvergence } from '../../../signals/curation/convergence-detector.js';
import { computeEngagementScore } from '../../../signals/curation/engagement-scorer.js';
import type { CurationConfig, CurationWeights, FeedTarget } from '../../../signals/curation/types.js';
import {
  DEFAULT_SPAM_PATTERNS,
  deduplicateByEvent,
  deduplicateByTitle,
  filterSignals,
} from '../../../signals/signal-filter.js';
import type { Signal, SignalOutputType, SignalType } from '../../../signals/types.js';
import type { WatchlistStore } from '../../../watchlist/watchlist-store.js';

const log = createSubsystemLogger('curated-signals-resolver');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * Enrichment sourceIds that produce reference/snapshot data (not actionable intel).
 * These belong in ticker profiles and dashboards, not the Intel Feed.
 * Signals from these sources are still available in the archive for agent queries.
 */
const REFERENCE_DATA_SOURCE_IDS = new Set([
  'jintel-snapshot',
  'jintel-technicals',
  'jintel-executives',
  'jintel-financials',
  'jintel-sentiment',
  'jintel-short-interest',
  'jintel-key-event',
  'jintel-market',
]);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let assessmentStore: AssessmentStore | null = null;
let curationOrchestrator: Orchestrator | null = null;
let snapshotStore: PortfolioSnapshotStore | null = null;
let signalArchive: SignalArchive | null = null;
let curationConfig: CurationConfig | null = null;
let watchlistStore: WatchlistStore | null = null;

export function setCuratedAssessmentStore(s: AssessmentStore): void {
  assessmentStore = s;
}

export function setCurationOrchestrator(o: Orchestrator): void {
  curationOrchestrator = o;
}

export function setCuratedSnapshotStore(s: PortfolioSnapshotStore): void {
  snapshotStore = s;
}

export function setCurationPipelineDeps(deps: { archive: SignalArchive; config: CurationConfig }): void {
  signalArchive = deps.archive;
  curationConfig = deps.config;
}

export function setCuratedWatchlistStore(s: WatchlistStore): void {
  watchlistStore = s;
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

interface PortfolioRelevanceScoreGql {
  ticker: string;
  compositeScore: number;
}

interface CuratedSignalGql {
  signal: SignalGql;
  scores: PortfolioRelevanceScoreGql[];
  feedTarget: FeedTarget;
  severity: SignalSeverity;
  assessment: {
    verdict: SignalVerdict;
    thesisAlignment: ThesisAlignment;
    actionability: number;
  } | null;
  convergenceBoost: number;
  engagementScore: number;
}

// ---------------------------------------------------------------------------
// Weighted composite score — uses CurationWeights to blend all scoring signals
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS: CurationWeights = {
  exposure: 0.2,
  typeRelevance: 0.15,
  recency: 0.2,
  sourceReliability: 0.1,
  contentQuality: 0.15,
  engagement: 0.2,
};

/** Signal type relevance — how much each type matters for investment decisions. */
const TYPE_RELEVANCE: Record<string, number> = {
  FILINGS: 0.95,
  FUNDAMENTAL: 0.9,
  TECHNICAL: 0.75,
  TRADING_LOGIC_TRIGGER: 0.95,
  NEWS: 0.7,
  SENTIMENT: 0.6,
  SOCIALS: 0.5,
  MACRO: 0.85,
};

function computeWeightedComposite(
  signal: Signal,
  assessment: SignalAssessment | undefined,
  engagementScore: number,
  convergenceBoost: number,
  exposureWeight: number,
  weights: CurationWeights,
): number {
  const recency = ageUrgencyScore(signal.publishedAt);
  const sourceReliability = signal.sources[0]?.reliability ?? 0.5;
  const contentQuality = (signal.qualityScore ?? 50) / 100;
  const typeRelevance = TYPE_RELEVANCE[signal.type] ?? 0.5;

  // If the strategist assessed it, blend its relevance into the content quality dimension
  const effectiveQuality = assessment ? Math.max(contentQuality, assessment.relevanceScore) : contentQuality;

  const base =
    weights.exposure * exposureWeight +
    weights.typeRelevance * typeRelevance +
    weights.recency * recency +
    weights.sourceReliability * sourceReliability +
    weights.contentQuality * effectiveQuality +
    weights.engagement * engagementScore;

  // Convergence boost is additive — it lifts signals confirmed by multiple sources
  return Math.min(1, base + convergenceBoost);
}

interface CurationStatusGql {
  lastRunAt: string | null;
  signalsProcessed: number;
  signalsCurated: number;
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

export type SignalSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

const SEVERITY_RANK: Record<SignalSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

function ageUrgencyScore(publishedAt: string): number {
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  if (ageMs <= 6 * hour) return 1;
  if (ageMs <= day) return 0.85;
  if (ageMs <= 3 * day) return 0.65;
  if (ageMs <= 7 * day) return 0.4;
  return 0.2;
}

function normalizeSeverity(value: unknown): SignalSeverity | null {
  if (typeof value !== 'string') return null;

  switch (value.trim().toUpperCase()) {
    case 'CRITICAL':
      return 'CRITICAL';
    case 'IMPORTANT':
    case 'HIGH':
      return 'HIGH';
    case 'MEDIUM':
      return 'MEDIUM';
    case 'LOW':
    case 'NOISE':
      return 'LOW';
    default:
      return null;
  }
}

export function deriveSignalSeverity(signal: Signal, assessment?: SignalAssessment | null): SignalSeverity {
  if (assessment?.verdict === 'NOISE') return 'LOW';

  const recencyUrgency = ageUrgencyScore(signal.publishedAt);

  if (assessment) {
    const verdictImportance =
      assessment.verdict === 'CRITICAL' ? 0.92 : assessment.verdict === 'IMPORTANT' ? 0.55 : 0.1;
    const thesisBoost =
      assessment.thesisAlignment === 'CHALLENGES' ? 0.15 : assessment.thesisAlignment === 'SUPPORTS' ? 0.05 : 0;
    const importance = Math.min(1, Math.max(verdictImportance, assessment.relevanceScore) + thesisBoost);
    const urgency = Math.max(assessment.actionability, recencyUrgency);

    if (
      (assessment.verdict === 'CRITICAL' && importance >= 0.85 && urgency >= 0.7) ||
      (importance >= 0.95 && urgency >= 0.85)
    ) {
      return 'CRITICAL';
    }
    if (importance >= 0.75 && urgency >= 0.65) return 'HIGH';
    if (urgency >= 0.55) return 'MEDIUM';
    if (importance >= 0.6) return 'MEDIUM';
    if (importance >= 0.45 && urgency >= 0.3) return 'MEDIUM';
    return 'LOW';
  }

  const metadataSeverity = normalizeSeverity(signal.metadata?.severity);
  if (metadataSeverity) return metadataSeverity;

  if (signal.outputType === 'SUMMARY') return 'HIGH';
  if (signal.outputType === 'ALERT') return recencyUrgency >= 0.8 ? 'HIGH' : 'MEDIUM';

  if (signal.sentiment === 'BEARISH' && signal.confidence >= 0.75) return 'MEDIUM';
  if (signal.type === 'FILINGS' || signal.type === 'TRADING_LOGIC_TRIGGER') return 'MEDIUM';
  if (signal.type === 'TECHNICAL' && signal.confidence >= 0.7) return 'MEDIUM';

  return signal.confidence >= 0.75 ? 'MEDIUM' : 'LOW';
}

export function deriveCuratedOutputType(signal: Signal, assessment?: SignalAssessment | null): SignalOutputType {
  if (signal.outputType === 'SUMMARY') return 'SUMMARY';

  const severity = deriveSignalSeverity(signal, assessment);
  if (severity === 'CRITICAL' || severity === 'HIGH') return 'ALERT';

  return 'INSIGHT';
}

export async function curatedSignalsResolver(
  _parent: unknown,
  args: {
    ticker?: string;
    since?: string;
    until?: string;
    type?: SignalType;
    search?: string;
    minConfidence?: number;
    outputType?: string;
    sourceId?: string;
    limit?: number;
    offset?: number;
    feedTarget?: FeedTarget;
  },
): Promise<CuratedSignalGql[]> {
  if (!signalArchive || !snapshotStore) return [];

  // Resolve tickers based on feedTarget filter
  const portfolioTickers: string[] = [];
  const watchlistEntries = watchlistStore?.list() ?? [];
  const watchlistTickers: string[] = [];

  if (args.ticker) {
    portfolioTickers.push(args.ticker);
  } else {
    if (args.feedTarget !== 'WATCHLIST') {
      const snapshot = await snapshotStore.getLatest();
      if (snapshot && snapshot.positions.length > 0) {
        portfolioTickers.push(...snapshot.positions.map((p) => p.symbol.toUpperCase()));
      }
    }
    if (args.feedTarget !== 'PORTFOLIO') {
      watchlistTickers.push(...watchlistEntries.map((e) => e.symbol.toUpperCase()));
    }
  }

  const allTickers = [...new Set([...portfolioTickers, ...watchlistTickers])];
  if (allTickers.length === 0) return [];

  // Query raw signals from archive — default 7-day window
  const since = args.since ?? new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const rawSignals = await signalArchive.query({
    tickers: allTickers,
    since,
    until: args.until,
    type: args.type,
    search: args.search,
    sourceId: args.sourceId,
    outputType: args.outputType,
  });

  // Get dismissed IDs
  const dismissedIds = await signalArchive.getDismissedIds();

  // Filter
  const filtered = filterSignals(rawSignals, {
    minQualityScore: curationConfig?.minQualityScore ?? 40,
    minConfidence: args.minConfidence ?? curationConfig?.minConfidence ?? 0.3,
    spamPatterns: curationConfig?.spamPatterns ?? DEFAULT_SPAM_PATTERNS,
    excludeIds: dismissedIds,
  });

  // Exclude enrichment reference data — snapshot/profile signals that aren't actionable intel.
  // These are still queryable via the signal archive for agent tools and detail views.
  const actionable = filtered.filter((s) => {
    const sourceId = s.sources[0]?.id;
    return !sourceId || !REFERENCE_DATA_SOURCE_IDS.has(sourceId);
  });

  // Classify signals as portfolio or watchlist
  const portfolioTickerSet = new Set(portfolioTickers);
  const watchlistTickerSet = new Set(watchlistTickers.filter((t) => !portfolioTickerSet.has(t)));

  type TaggedSignal = { signal: Signal; feedTarget: FeedTarget };
  const tagged: TaggedSignal[] = [];

  for (const signal of actionable) {
    const isPortfolio = signal.assets.some((a) => portfolioTickerSet.has(a.ticker));
    const isWatchlist = signal.assets.some((a) => watchlistTickerSet.has(a.ticker));

    if (isPortfolio && args.feedTarget !== 'WATCHLIST') {
      tagged.push({ signal, feedTarget: 'PORTFOLIO' });
    } else if (isWatchlist && args.feedTarget !== 'PORTFOLIO') {
      tagged.push({ signal, feedTarget: 'WATCHLIST' });
    }
  }

  // Title dedup + event dedup per feed target.
  // deduplicateByTitle catches exact title matches; deduplicateByEvent catches
  // paraphrases of the same underlying event (same ticker + day + event category).
  const portfolioSignals = deduplicateByEvent(
    deduplicateByTitle(tagged.filter((t) => t.feedTarget === 'PORTFOLIO').map((t) => t.signal)),
  );
  const watchlistSignals = deduplicateByEvent(
    deduplicateByTitle(tagged.filter((t) => t.feedTarget === 'WATCHLIST').map((t) => t.signal)),
  );

  // Rebuild tagged list after dedup
  const dedupedTagged: TaggedSignal[] = [
    ...portfolioSignals.map((s) => ({ signal: s, feedTarget: 'PORTFOLIO' as FeedTarget })),
    ...watchlistSignals.map((s) => ({ signal: s, feedTarget: 'WATCHLIST' as FeedTarget })),
  ];

  // Load assessments for verdict-based ranking
  let assessmentBySignalId = new Map<string, SignalAssessment>();
  if (assessmentStore) {
    try {
      const reports = await assessmentStore.queryByTickers(allTickers, { limit: 10 });
      for (const report of reports) {
        for (const a of report.assessments) {
          if (!assessmentBySignalId.has(a.signalId)) {
            assessmentBySignalId.set(a.signalId, a);
          }
        }
      }
    } catch (err) {
      log.debug('Failed to load signal assessments', { error: err });
      assessmentBySignalId = new Map();
    }
  }

  // Filter out NOISE verdicts
  const visible = dedupedTagged.filter((t) => {
    const assessment = assessmentBySignalId.get(t.signal.id);
    return !assessment || assessment.verdict !== 'NOISE';
  });

  // Compute engagement scores and cross-source convergence
  const visibleSignals = visible.map((t) => t.signal);
  const convergence = detectConvergence(visibleSignals);
  const engagementScores = new Map<string, number>();
  for (const signal of visibleSignals) {
    engagementScores.set(signal.id, computeEngagementScore(signal));
  }

  // Build exposure weights from portfolio position sizes
  const snapshot = await snapshotStore.getLatest();
  const totalValue = snapshot?.totalValue ?? 0;
  const positionExposure = new Map<string, number>();
  if (snapshot && totalValue > 0) {
    for (const pos of snapshot.positions) {
      positionExposure.set(pos.symbol.toUpperCase(), (pos.marketValue ?? 0) / totalValue);
    }
  }

  const weights = curationConfig?.weights ?? DEFAULT_WEIGHTS;

  // Pre-compute composite scores for sorting
  const compositeScores = new Map<string, number>();
  for (const t of visible) {
    const assessment = assessmentBySignalId.get(t.signal.id);
    const engagement = engagementScores.get(t.signal.id) ?? 0;
    const boost = convergence.boosts.get(t.signal.id) ?? 0;
    // Use max exposure across linked tickers
    const exposure = Math.max(0, ...t.signal.assets.map((a) => positionExposure.get(a.ticker) ?? 0));
    compositeScores.set(
      t.signal.id,
      computeWeightedComposite(t.signal, assessment ?? undefined, engagement, boost, exposure, weights),
    );
  }

  // Sort by derived severity, then by composite score.
  const sorted = visible.sort((a, b) => {
    const assessA = assessmentBySignalId.get(a.signal.id);
    const assessB = assessmentBySignalId.get(b.signal.id);
    const rankA = SEVERITY_RANK[deriveSignalSeverity(a.signal, assessA)];
    const rankB = SEVERITY_RANK[deriveSignalSeverity(b.signal, assessB)];
    if (rankA !== rankB) return rankB - rankA;
    return (compositeScores.get(b.signal.id) ?? 0) - (compositeScores.get(a.signal.id) ?? 0);
  });

  // Pagination
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 200;
  const page = sorted.slice(offset, offset + limit);

  const result = page.map((t) => {
    const assessment = assessmentBySignalId.get(t.signal.id);
    const tickers = t.signal.assets.map((a) => a.ticker);
    const severity = deriveSignalSeverity(t.signal, assessment);
    const signalGql = toGql(t.signal);
    signalGql.outputType = deriveCuratedOutputType(t.signal, assessment);
    const engagement = engagementScores.get(t.signal.id) ?? 0;
    const boost = convergence.boosts.get(t.signal.id) ?? 0;

    return {
      signal: signalGql,
      scores: tickers.map((ticker) => ({
        ticker,
        compositeScore: compositeScores.get(t.signal.id) ?? t.signal.confidence,
      })),
      feedTarget: t.feedTarget,
      severity,
      assessment: assessment
        ? {
            verdict: assessment.verdict,
            thesisAlignment: assessment.thesisAlignment,
            actionability: assessment.actionability,
          }
        : null,
      convergenceBoost: boost,
      engagementScore: engagement,
    };
  });

  // Track shown signals and auto-dismiss stale ones (shown > 4 days ago).
  // Sequential to avoid concurrent writes to shown.json.
  const archive = signalArchive;
  const shownIds = result.map((r) => r.signal.id);
  void archive
    .markShown(shownIds)
    .then(() => archive.autoDismissStale(FOUR_DAYS_MS))
    .catch((err) => log.debug('Failed to track/auto-dismiss signals', { error: err }));

  return result;
}

export async function curationStatusResolver(): Promise<CurationStatusGql> {
  if (!assessmentStore) return { lastRunAt: null, signalsProcessed: 0, signalsCurated: 0 };

  const watermark = await assessmentStore.getLatestWatermark();
  if (!watermark) return { lastRunAt: null, signalsProcessed: 0, signalsCurated: 0 };

  return {
    lastRunAt: watermark.lastRunAt,
    signalsProcessed: watermark.signalsAssessed,
    signalsCurated: watermark.signalsKept,
  };
}

// ---------------------------------------------------------------------------
// Full Curation — with progress events
// ---------------------------------------------------------------------------

let activeFullCuration: Promise<boolean> | null = null;
let fullCurationStartedAt: string | null = null;

export function getCurationWorkflowStatus(): { running: boolean; startedAt: string | null } {
  return { running: activeFullCuration !== null, startedAt: fullCurationStartedAt };
}

export async function dismissSignalResolver(_parent: unknown, args: { signalId: string }): Promise<boolean> {
  if (!signalArchive) throw new Error('SignalArchive not available');
  await signalArchive.dismiss(args.signalId);
  return true;
}

export async function batchDismissSignalsResolver(_parent: unknown, args: { signalIds: string[] }): Promise<boolean> {
  if (!signalArchive) throw new Error('SignalArchive not available');
  const archive = signalArchive;
  await Promise.all(args.signalIds.map((id) => archive.dismiss(id)));
  return true;
}

// ---------------------------------------------------------------------------
// Refresh Intel Feed — fetch data sources
// ---------------------------------------------------------------------------

interface RefreshIntelFeedResult {
  signalsFetched: number;
  signalsCurated: number;
  error: string | null;
}

let activeRefresh: Promise<RefreshIntelFeedResult> | null = null;

export async function refreshIntelFeedResolver(): Promise<RefreshIntelFeedResult> {
  if (!snapshotStore || !signalArchive) {
    return { signalsFetched: 0, signalsCurated: 0, error: 'Intel feed pipeline not initialized' };
  }

  if (activeRefresh || getCurationWorkflowStatus().running) {
    return { signalsFetched: 0, signalsCurated: 0, error: 'Curation already in progress' };
  }

  activeRefresh = (async () => {
    try {
      const fetchResult = await fetchAllEnabledSources();
      log.info('Intel feed refresh — data fetch complete', {
        ingested: fetchResult.totalIngested,
        duplicates: fetchResult.totalDuplicates,
        sources: fetchResult.sourcesAttempted,
      });

      return {
        signalsFetched: fetchResult.totalIngested,
        signalsCurated: 0,
        error: fetchResult.errors.length > 0 ? fetchResult.errors.join('; ') : null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Intel feed refresh failed', { error: msg });
      return { signalsFetched: 0, signalsCurated: 0, error: msg };
    } finally {
      activeRefresh = null;
    }
  })();

  return activeRefresh;
}

export async function runFullCurationResolver(): Promise<boolean> {
  if (activeFullCuration) return activeFullCuration;

  fullCurationStartedAt = new Date().toISOString();
  activeFullCuration = (async () => {
    if (!curationOrchestrator) {
      throw new Error('Orchestrator not available — cannot run full curation');
    }

    await curationOrchestrator.execute('full-curation', {});
    return true;
  })();

  try {
    return await activeFullCuration;
  } finally {
    activeFullCuration = null;
    fullCurationStartedAt = null;
  }
}
