/**
 * Curated signal resolvers — query curated signals and manage the curation pipeline.
 *
 * Module-level state: setCuratedSignalStore and setCurationOrchestrator are called at startup.
 */

import { toGql } from './signals.js';
import type { SignalGql } from './signals.js';
import type { Orchestrator } from '../../../agents/orchestrator.js';
import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
import type { CuratedSignalStore } from '../../../signals/curation/curated-signal-store.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let store: CuratedSignalStore | null = null;
let curationOrchestrator: Orchestrator | null = null;
let snapshotStore: PortfolioSnapshotStore | null = null;

export function setCuratedSignalStore(s: CuratedSignalStore): void {
  store = s;
}

export function setCurationOrchestrator(o: Orchestrator): void {
  curationOrchestrator = o;
}

export function setCuratedSnapshotStore(s: PortfolioSnapshotStore): void {
  snapshotStore = s;
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

  const curated = await store.queryByTickers(tickers, {
    since: args.since,
    limit: args.limit ?? 200,
  });

  return curated.map((cs) => ({
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
