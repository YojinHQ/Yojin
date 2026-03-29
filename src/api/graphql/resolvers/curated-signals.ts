/**
 * Curated signal resolvers — query curated signals and manage the curation pipeline.
 *
 * Module-level state: setCuratedSignalStore and setCurationOrchestrator are called at startup.
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
import type { CuratedSignalStore } from '../../../signals/curation/curated-signal-store.js';
import { runCurationPipeline } from '../../../signals/curation/pipeline.js';
import type { CurationConfig } from '../../../signals/curation/types.js';

const log = createSubsystemLogger('curated-signals-resolver');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let store: CuratedSignalStore | null = null;
let assessmentStore: AssessmentStore | null = null;
let curationOrchestrator: Orchestrator | null = null;
let snapshotStore: PortfolioSnapshotStore | null = null;
let signalArchive: SignalArchive | null = null;
let curationConfig: CurationConfig | null = null;

export function setCuratedSignalStore(s: CuratedSignalStore): void {
  store = s;
}

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

export async function curatedSignalsResolver(
  _parent: unknown,
  args: { ticker?: string; since?: string; limit?: number; offset?: number },
): Promise<CuratedSignalGql[]> {
  if (!store) return [];

  // Resolve tickers: explicit arg, or auto-resolve from portfolio snapshot
  let tickers: string[];
  if (args.ticker) {
    tickers = [args.ticker];
  } else if (snapshotStore) {
    const snapshot = await snapshotStore.getLatest();
    tickers = snapshot && snapshot.positions.length > 0 ? snapshot.positions.map((p) => p.symbol.toUpperCase()) : [];
  } else {
    tickers = [];
  }
  if (tickers.length === 0) return [];

  const [curated, dismissedIds] = await Promise.all([
    store.queryByTickers(tickers, {
      since: args.since,
      limit: args.limit ?? 200,
    }),
    store.getDismissedIds(),
  ]);

  // Load latest assessments for verdict enrichment — keyed by signalId for O(1) join
  let assessmentBySignalId = new Map<string, SignalAssessment>();
  if (assessmentStore) {
    try {
      const reports = await assessmentStore.queryByTickers(tickers, { limit: 10 });
      for (const report of reports) {
        for (const a of report.assessments) {
          // Keep the most recent assessment per signal (reports are newest-first)
          if (!assessmentBySignalId.has(a.signalId)) {
            assessmentBySignalId.set(a.signalId, a);
          }
        }
      }
    } catch {
      // Best-effort — assessments are enrichment, not critical
      assessmentBySignalId = new Map();
    }
  }

  // CRITICAL verdict boost — multiply composite score for ranking
  const VERDICT_BOOST: Record<string, number> = { CRITICAL: 1.5, IMPORTANT: 1.1, NOISE: 0.5 };

  // Filter out dismissed signals, dedup by normalized title (keep highest score), sort by composite score
  const nonDismissed = curated.filter((cs) => !dismissedIds.has(cs.signal.id));

  // Title-level dedup — keep the curated signal with the highest composite score per unique title
  const byTitle = new Map<string, (typeof nonDismissed)[number]>();
  for (const cs of nonDismissed) {
    const key = cs.signal.title.trim().toLowerCase();
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, cs);
    } else {
      const maxExisting = Math.max(...existing.scores.map((s) => s.compositeScore));
      const maxCurrent = Math.max(...cs.scores.map((s) => s.compositeScore));
      if (maxCurrent > maxExisting) byTitle.set(key, cs);
    }
  }

  // Sort with verdict-boosted scores — CRITICAL signals bubble to top
  const sorted = [...byTitle.values()].sort((a, b) => {
    const assessA = assessmentBySignalId.get(a.signal.id);
    const assessB = assessmentBySignalId.get(b.signal.id);
    const boostA = assessA ? (VERDICT_BOOST[assessA.verdict] ?? 1) : 1;
    const boostB = assessB ? (VERDICT_BOOST[assessB.verdict] ?? 1) : 1;
    const maxA = Math.max(...a.scores.map((s) => s.compositeScore)) * boostA;
    const maxB = Math.max(...b.scores.map((s) => s.compositeScore)) * boostB;
    return maxB - maxA;
  });

  // Pagination — offset/limit applied after dedup + sort
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 200;
  const visible = sorted.slice(offset, offset + limit);

  return visible.map((cs) => {
    const assessment = assessmentBySignalId.get(cs.signal.id);
    return {
      signal: toGql(cs.signal),
      scores: cs.scores.map((s) => ({
        signalId: s.signalId,
        ticker: s.ticker,
        exposureWeight: s.exposureWeight,
        typeRelevance: s.typeRelevance,
        compositeScore: s.compositeScore,
      })),
      curatedAt: cs.curatedAt,
      verdict: assessment?.verdict ?? null,
      thesisAlignment: assessment?.thesisAlignment ?? null,
      actionability: assessment?.actionability ?? null,
    };
  });
}

export async function curationStatusResolver(): Promise<CurationStatusGql> {
  if (!store) return { lastRunAt: null, signalsProcessed: 0, signalsCurated: 0 };

  const watermark = await store.getLatestWatermark();
  if (!watermark) return { lastRunAt: null, signalsProcessed: 0, signalsCurated: 0 };

  return {
    lastRunAt: watermark.lastRunAt,
    signalsProcessed: watermark.signalsProcessed,
    signalsCurated: watermark.signalsCurated,
  };
}

// ---------------------------------------------------------------------------
// Full Curation (Tier 1 + Tier 2) — with progress events
// ---------------------------------------------------------------------------

let activeFullCuration: Promise<boolean> | null = null;
let fullCurationStartedAt: string | null = null;

export function getCurationWorkflowStatus(): { running: boolean; startedAt: string | null } {
  return { running: activeFullCuration !== null, startedAt: fullCurationStartedAt };
}

export async function dismissSignalResolver(_parent: unknown, args: { signalId: string }): Promise<boolean> {
  if (!store) throw new Error('CuratedSignalStore not available');
  await store.dismiss(args.signalId);
  return true;
}

// ---------------------------------------------------------------------------
// Refresh Intel Feed — fetch data sources + run Tier 1 curation
// ---------------------------------------------------------------------------

interface RefreshIntelFeedResult {
  signalsFetched: number;
  signalsCurated: number;
  error: string | null;
}

let activeRefresh: Promise<RefreshIntelFeedResult> | null = null;

export async function refreshIntelFeedResolver(): Promise<RefreshIntelFeedResult> {
  if (!store || !snapshotStore || !signalArchive || !curationConfig) {
    return { signalsFetched: 0, signalsCurated: 0, error: 'Intel feed pipeline not initialized' };
  }

  if (activeRefresh || getCurationWorkflowStatus().running) {
    return { signalsFetched: 0, signalsCurated: 0, error: 'Curation already in progress' };
  }

  activeRefresh = (async () => {
    try {
      // Step 1: Fetch fresh signals from all enabled data sources
      const fetchResult = await fetchAllEnabledSources();
      log.info('Intel feed refresh — data fetch complete', {
        ingested: fetchResult.totalIngested,
        duplicates: fetchResult.totalDuplicates,
        sources: fetchResult.sourcesAttempted,
      });

      // Step 2: Run Tier 1 curation pipeline
      const curationResult = await runCurationPipeline({
        signalArchive,
        curatedStore: store,
        snapshotStore,
        config: curationConfig,
      });

      log.info('Intel feed refresh — curation complete', {
        processed: curationResult.signalsProcessed,
        curated: curationResult.signalsCurated,
      });

      return {
        signalsFetched: fetchResult.totalIngested,
        signalsCurated: curationResult.signalsCurated,
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
