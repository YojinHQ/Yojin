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
import type { CuratedSignalStore } from '../../../signals/curation/curated-signal-store.js';
import { runCurationPipeline } from '../../../signals/curation/pipeline.js';
import type { CurationConfig } from '../../../signals/curation/types.js';

const log = createSubsystemLogger('curated-signals-resolver');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let store: CuratedSignalStore | null = null;
let curationOrchestrator: Orchestrator | null = null;
let snapshotStore: PortfolioSnapshotStore | null = null;
let signalArchive: SignalArchive | null = null;
let curationConfig: CurationConfig | null = null;

export function setCuratedSignalStore(s: CuratedSignalStore): void {
  store = s;
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
  args: { ticker?: string; since?: string; limit?: number },
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

  // Filter out dismissed signals
  const visible = curated.filter((cs) => !dismissedIds.has(cs.signal.id));

  return visible.map((cs) => ({
    signal: toGql(cs.signal),
    scores: cs.scores.map((s) => ({
      signalId: s.signalId,
      ticker: s.ticker,
      exposureWeight: s.exposureWeight,
      typeRelevance: s.typeRelevance,
      compositeScore: s.compositeScore,
    })),
    curatedAt: cs.curatedAt,
  }));
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
