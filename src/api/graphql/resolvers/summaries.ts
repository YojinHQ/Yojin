/**
 * Summary resolvers — query neutral intel observations from macro + micro
 * insight pipelines. Summaries are read-only: no mutations, no approval
 * lifecycle. Action-style mutations live in resolvers/actions.ts.
 *
 * Module-level state: setSummaryStore and setSummarySignalArchive are called
 * once during server startup.
 */

import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
import type { SignalArchive } from '../../../signals/archive.js';
import type { Signal, SignalType } from '../../../signals/types.js';
import type { SummaryStore } from '../../../summaries/summary-store.js';
import type { Summary, SummaryFlow } from '../../../summaries/types.js';
import { PORTFOLIO_TICKER } from '../../../summaries/types.js';
import type { WatchlistStore } from '../../../watchlist/watchlist-store.js';

function deriveSeverityLabel(severity: number | undefined): string {
  if (severity == null) return 'MEDIUM';
  if (severity >= 0.7) return 'CRITICAL';
  if (severity >= 0.4) return 'HIGH';
  return 'MEDIUM';
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let store: SummaryStore | null = null;
let signalArchive: SignalArchive | null = null;
let snapshotStore: PortfolioSnapshotStore | null = null;
let watchlistStore: WatchlistStore | null = null;

export function setSummaryStore(s: SummaryStore): void {
  store = s;
}

export function setSummarySignalArchive(a: SignalArchive): void {
  signalArchive = a;
}

export function setSummarySnapshotStore(s: PortfolioSnapshotStore): void {
  snapshotStore = s;
}

export function setSummaryWatchlistStore(s: WatchlistStore): void {
  watchlistStore = s;
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

interface SummarySourceSignalGql {
  id: string;
  type: SignalType;
  title: string;
  link: string | null;
  sourceName: string | null;
}

interface SummaryGql {
  id: string;
  ticker: string;
  what: string;
  flow: SummaryFlow;
  severity: number | null;
  severityLabel: string;
  sourceSignalIds: string[];
  sourceSignals: SummarySourceSignalGql[];
  contentHash: string;
  createdAt: string;
}

function signalToSourceGql(s: Signal): SummarySourceSignalGql {
  return {
    id: s.id,
    type: s.type,
    title: s.title,
    link: typeof s.metadata?.link === 'string' ? s.metadata.link : null,
    sourceName: s.sources[0]?.name ?? null,
  };
}

function toGql(summary: Summary, signalMap: Map<string, Signal>): SummaryGql {
  const ids = summary.sourceSignalIds ?? [];
  return {
    id: summary.id,
    ticker: summary.ticker,
    what: summary.what,
    flow: summary.flow,
    severity: summary.severity ?? null,
    severityLabel: deriveSeverityLabel(summary.severity),
    sourceSignalIds: ids,
    sourceSignals: ids.flatMap((id) => {
      const sig = signalMap.get(id);
      return sig ? [signalToSourceGql(sig)] : [];
    }),
    contentHash: summary.contentHash,
    createdAt: summary.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Batch helpers
// ---------------------------------------------------------------------------

/**
 * Collect all sourceSignalIds across summaries and resolve them in a single
 * archive pass. Returns a lookup map keyed by signal ID.
 */
async function batchResolveSourceSignals(summaries: Summary[]): Promise<Map<string, Signal>> {
  if (!signalArchive) return new Map();
  const allIds = new Set<string>();
  for (const s of summaries) {
    for (const id of s.sourceSignalIds ?? []) allIds.add(id);
  }
  if (allIds.size === 0) return new Map();
  const signals = await signalArchive.getByIds([...allIds]);
  return new Map(signals.map((s) => [s.id, s]));
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

type SummaryScope = 'PORTFOLIO' | 'WATCHLIST' | 'ALL';

export async function summariesResolver(
  _parent: unknown,
  args: { ticker?: string; flow?: SummaryFlow; since?: string; limit?: number; scope?: SummaryScope },
): Promise<SummaryGql[]> {
  if (!store) return [];

  // Scope filter: PORTFOLIO (default) shows summaries for held positions only,
  // WATCHLIST shows summaries for watchlist tickers only, ALL skips the filter.
  // Overview uses PORTFOLIO; the Watchlist page uses WATCHLIST.
  //
  // The ticker allowlist is pushed into the store query so that `limit`
  // applies AFTER scope filtering. Otherwise a day dominated by watchlist
  // summaries would fill the `limit` slots and starve portfolio tickers from
  // the resolver response (observed bug: only QQQ surviving a 50-row limit).
  const scope: SummaryScope = args.scope ?? 'PORTFOLIO';
  let tickerAllowlist: string[] | undefined;
  if (scope === 'PORTFOLIO' && snapshotStore) {
    const snapshot = await snapshotStore.getLatest();
    if (snapshot) {
      tickerAllowlist = [PORTFOLIO_TICKER, ...snapshot.positions.map((p) => p.symbol.toUpperCase())];
    }
  } else if (scope === 'WATCHLIST' && watchlistStore) {
    tickerAllowlist = watchlistStore.list().map((e) => e.symbol.toUpperCase());
  }

  const summaries = await store.query({
    ticker: args.ticker,
    tickers: tickerAllowlist,
    flow: args.flow,
    since: args.since,
    limit: args.limit ?? 50,
  });

  const signalMap = await batchResolveSourceSignals(summaries);
  return summaries.map((s) => toGql(s, signalMap));
}

export async function summaryResolver(_parent: unknown, args: { id: string }): Promise<SummaryGql | null> {
  if (!store) return null;

  const summary = await store.getById(args.id);
  if (!summary) return null;

  const signalMap = await batchResolveSourceSignals([summary]);
  return toGql(summary, signalMap);
}
