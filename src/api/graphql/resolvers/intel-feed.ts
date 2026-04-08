/**
 * Intel Feed resolver — hybrid feed of signal groups (narratives) + ungrouped
 * curated signals in a single query.
 *
 * Groups cluster causally related signals into one card. Singletons fill the
 * remaining slots with the highest-ranked curated signals that are NOT already
 * covered by a returned group.
 *
 * Ordering:
 *   - Groups: severity DESC, then lastEventAt DESC (newest narrative first).
 *   - Signals: delegated to curatedSignalsResolver's severity + composite rank.
 */

import { type SignalSeverity, curatedSignalsResolver, deriveSignalSeverity } from './curated-signals.js';
import { type SignalGql, toGql as signalToGql } from './signals.js';
import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
import type { SignalArchive } from '../../../signals/archive.js';
import type { FeedTarget } from '../../../signals/curation/types.js';
import type { SignalGroupArchive } from '../../../signals/group-archive.js';
import type { SignalOutputType } from '../../../signals/types.js';
import type { WatchlistStore } from '../../../watchlist/watchlist-store.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let groupArchive: SignalGroupArchive | null = null;
let signalArchive: SignalArchive | null = null;
let snapshotStore: PortfolioSnapshotStore | null = null;
let watchlistStore: WatchlistStore | null = null;

export function setIntelFeedDeps(deps: {
  groupArchive: SignalGroupArchive;
  signalArchive: SignalArchive;
  snapshotStore: PortfolioSnapshotStore;
  watchlistStore: WatchlistStore;
}): void {
  groupArchive = deps.groupArchive;
  signalArchive = deps.signalArchive;
  snapshotStore = deps.snapshotStore;
  watchlistStore = deps.watchlistStore;
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

interface IntelFeedGroupGql {
  id: string;
  signals: SignalGql[];
  tickers: string[];
  summary: string;
  outputType: SignalOutputType;
  firstEventAt: string;
  lastEventAt: string;
  severity: SignalSeverity;
  feedTarget: FeedTarget;
}

interface IntelFeedResultGql {
  groups: IntelFeedGroupGql[];
  signals: Awaited<ReturnType<typeof curatedSignalsResolver>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TOTAL_LIMIT = 20;
const DEFAULT_GROUP_LIMIT = 8;

const SEVERITY_RANK: Record<SignalSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function intelFeedResolver(
  parent: unknown,
  args: { limit?: number; groupLimit?: number; feedTarget?: FeedTarget },
): Promise<IntelFeedResultGql> {
  const totalLimit = args.limit ?? DEFAULT_TOTAL_LIMIT;
  const requestedGroupLimit = args.groupLimit ?? DEFAULT_GROUP_LIMIT;

  // Fetch ranked curated signals first — we overfetch so dedup has slack.
  // curatedSignalsResolver already handles feedTarget filtering, assessment-based
  // ranking, and marks returned signals as shown for auto-dismiss-stale tracking.
  const curatedSignals = await curatedSignalsResolver(parent, {
    feedTarget: args.feedTarget,
    limit: Math.max(totalLimit * 3, 60),
  });

  if (!groupArchive || !signalArchive || !snapshotStore) {
    return { groups: [], signals: curatedSignals.slice(0, totalLimit) };
  }

  // Resolve portfolio/watchlist ticker sets so we can assign each group a feedTarget
  // based on which bucket its tickers overlap with. Mirrors curatedSignalsResolver.
  const portfolioTickers: string[] = [];
  const watchlistTickers: string[] = [];

  if (args.feedTarget !== 'WATCHLIST') {
    const snapshot = await snapshotStore.getLatest();
    if (snapshot && snapshot.positions.length > 0) {
      portfolioTickers.push(...snapshot.positions.map((p) => p.symbol.toUpperCase()));
    }
  }
  if (args.feedTarget !== 'PORTFOLIO') {
    const entries = watchlistStore?.list() ?? [];
    watchlistTickers.push(...entries.map((e) => e.symbol.toUpperCase()));
  }

  const portfolioSet = new Set(portfolioTickers);
  const watchlistSet = new Set(watchlistTickers.filter((t) => !portfolioSet.has(t)));
  const allFeedTickers = new Set<string>([...portfolioSet, ...watchlistSet]);

  if (allFeedTickers.size === 0) {
    return { groups: [], signals: curatedSignals.slice(0, totalLimit) };
  }

  // Pull recent groups and filter to those touching at least one feed ticker.
  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const recentGroups = await groupArchive.query({ since, limit: 100 });

  const matchingGroups = recentGroups.filter((g) => g.tickers.some((t) => allFeedTickers.has(t.toUpperCase())));

  // Resolve member signals, derive severity as the max of all members, and
  // assign feedTarget by which set has more ticker overlap.
  const archive = signalArchive;
  const enriched = await Promise.all(
    matchingGroups.map(async (g) => {
      const resolved = await Promise.all(g.signalIds.map((id) => archive.getById(id)));
      const members = resolved.filter((s): s is NonNullable<typeof s> => s != null);
      if (members.length === 0) return null;

      let maxSeverity: SignalSeverity = 'LOW';
      for (const m of members) {
        const sev = deriveSignalSeverity(m, undefined);
        if (SEVERITY_RANK[sev] > SEVERITY_RANK[maxSeverity]) maxSeverity = sev;
      }

      const portfolioHits = g.tickers.filter((t) => portfolioSet.has(t.toUpperCase())).length;
      const watchlistHits = g.tickers.filter((t) => watchlistSet.has(t.toUpperCase())).length;
      const feedTarget: FeedTarget = portfolioHits >= watchlistHits ? 'PORTFOLIO' : 'WATCHLIST';

      const group: IntelFeedGroupGql = {
        id: g.id,
        signals: members.map(signalToGql),
        tickers: g.tickers,
        summary: g.summary,
        outputType: g.outputType ?? 'INSIGHT',
        firstEventAt: g.firstEventAt,
        lastEventAt: g.lastEventAt,
        severity: maxSeverity,
        feedTarget,
      };
      return group;
    }),
  );

  const enrichedGroups = enriched.filter((g): g is IntelFeedGroupGql => g !== null);

  // If the caller asked for a specific feed target, honor it for groups too.
  const targetedGroups = args.feedTarget
    ? enrichedGroups.filter((g) => g.feedTarget === args.feedTarget)
    : enrichedGroups;

  // Rank: severity DESC, lastEventAt DESC.
  targetedGroups.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;
    return new Date(b.lastEventAt).getTime() - new Date(a.lastEventAt).getTime();
  });

  const selectedGroups = targetedGroups.slice(0, requestedGroupLimit);

  // Dedup: strip signals already surfaced as group members so the "More signals"
  // lane doesn't repeat the same headlines.
  const coveredSignalIds = new Set<string>();
  for (const g of selectedGroups) {
    for (const s of g.signals) coveredSignalIds.add(s.id);
  }
  const dedupedSignals = curatedSignals.filter((cs) => !coveredSignalIds.has(cs.signal.id));

  // Fill remaining slots so total items === totalLimit when possible.
  const singletonSlots = Math.max(0, totalLimit - selectedGroups.length);
  const selectedSignals = dedupedSignals.slice(0, singletonSlots);

  return {
    groups: selectedGroups,
    signals: selectedSignals,
  };
}
