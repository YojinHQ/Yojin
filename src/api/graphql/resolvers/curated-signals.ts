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
import type { SignalAssessment } from '../../../signals/curation/assessment-types.js';
import type { CurationConfig, FeedTarget } from '../../../signals/curation/types.js';
import { DEFAULT_SPAM_PATTERNS, deduplicateByTitle, filterSignals } from '../../../signals/signal-filter.js';
import type { Signal } from '../../../signals/types.js';
import type { WatchlistStore } from '../../../watchlist/watchlist-store.js';

const log = createSubsystemLogger('curated-signals-resolver');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
  signalId: string;
  ticker: string;
  exposureWeight: number;
  typeRelevance: number;
  compositeScore: number;
}

interface CuratedSignalGql {
  signal: SignalGql;
  scores: PortfolioRelevanceScoreGql[];
  curatedAt: string;
  feedTarget: FeedTarget;
  verdict: string | null;
  thesisAlignment: string | null;
  actionability: number | null;
}

interface CurationStatusGql {
  lastRunAt: string | null;
  signalsProcessed: number;
  signalsCurated: number;
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

/** Verdict priority for ranking — higher is better. */
const VERDICT_RANK: Record<string, number> = { CRITICAL: 3, IMPORTANT: 2, NOISE: 0 };

export async function curatedSignalsResolver(
  _parent: unknown,
  args: { ticker?: string; since?: string; limit?: number; offset?: number; feedTarget?: FeedTarget },
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
  const rawSignals = await signalArchive.query({ tickers: allTickers, since });

  // Get dismissed IDs
  const dismissedIds = await signalArchive.getDismissedIds();

  // Filter
  const filtered = filterSignals(rawSignals, {
    minQualityScore: curationConfig?.minQualityScore ?? 40,
    minConfidence: curationConfig?.minConfidence ?? 0.3,
    spamPatterns: curationConfig?.spamPatterns ?? DEFAULT_SPAM_PATTERNS,
    excludeIds: dismissedIds,
  });

  // Classify signals as portfolio or watchlist
  const portfolioTickerSet = new Set(portfolioTickers);
  const watchlistTickerSet = new Set(watchlistTickers.filter((t) => !portfolioTickerSet.has(t)));

  type TaggedSignal = { signal: Signal; feedTarget: FeedTarget };
  const tagged: TaggedSignal[] = [];

  for (const signal of filtered) {
    const isPortfolio = signal.assets.some((a) => portfolioTickerSet.has(a.ticker));
    const isWatchlist = signal.assets.some((a) => watchlistTickerSet.has(a.ticker));

    if (isPortfolio && args.feedTarget !== 'WATCHLIST') {
      tagged.push({ signal, feedTarget: 'PORTFOLIO' });
    } else if (isWatchlist && args.feedTarget !== 'PORTFOLIO') {
      tagged.push({ signal, feedTarget: 'WATCHLIST' });
    }
  }

  // Title dedup per feed target
  const portfolioSignals = deduplicateByTitle(tagged.filter((t) => t.feedTarget === 'PORTFOLIO').map((t) => t.signal));
  const watchlistSignals = deduplicateByTitle(tagged.filter((t) => t.feedTarget === 'WATCHLIST').map((t) => t.signal));

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

  // Sort by verdict rank (CRITICAL > IMPORTANT > unassessed), then by confidence
  const sorted = visible.sort((a, b) => {
    const assessA = assessmentBySignalId.get(a.signal.id);
    const assessB = assessmentBySignalId.get(b.signal.id);
    const rankA = assessA ? (VERDICT_RANK[assessA.verdict] ?? 1) : 1;
    const rankB = assessB ? (VERDICT_RANK[assessB.verdict] ?? 1) : 1;
    if (rankA !== rankB) return rankB - rankA;
    return b.signal.confidence - a.signal.confidence;
  });

  // Pagination
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 200;
  const page = sorted.slice(offset, offset + limit);

  return page.map((t) => {
    const assessment = assessmentBySignalId.get(t.signal.id);
    const tickers = t.signal.assets.map((a) => a.ticker);

    return {
      signal: toGql(t.signal),
      scores: tickers.map((ticker) => ({
        signalId: t.signal.id,
        ticker,
        exposureWeight: 0,
        typeRelevance: 0,
        compositeScore: assessment?.relevanceScore ?? t.signal.confidence,
      })),
      curatedAt: t.signal.ingestedAt,
      feedTarget: t.feedTarget,
      verdict: assessment?.verdict ?? null,
      thesisAlignment: assessment?.thesisAlignment ?? null,
      actionability: assessment?.actionability ?? null,
    };
  });
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
        signalsCurated: fetchResult.totalIngested,
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
