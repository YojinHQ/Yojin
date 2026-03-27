/**
 * SignalGroup resolvers — query signal groups (causal chains) from the archive.
 *
 * Module-level state: setSignalGroupArchive and setGroupSignalArchive are called
 * once during server startup.
 */

import { toGql as signalToGql } from './signals.js';
import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
import type { SignalArchive } from '../../../signals/archive.js';
import type { SignalGroupArchive, SignalGroupQueryFilter } from '../../../signals/group-archive.js';
import type { SignalGroup } from '../../../signals/group-types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let groupArchive: SignalGroupArchive | null = null;
let signalArchive: SignalArchive | null = null;
let snapshotStore: PortfolioSnapshotStore | null = null;

export function setSignalGroupArchive(a: SignalGroupArchive): void {
  groupArchive = a;
}

export function setGroupSignalArchive(a: SignalArchive): void {
  signalArchive = a;
}

export function setGroupSnapshotStore(store: PortfolioSnapshotStore): void {
  snapshotStore = store;
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

interface SignalGroupGql {
  id: string;
  /** Resolved lazily via field resolver. */
  _signalIds: string[];
  tickers: string[];
  summary: string;
  outputType: string;
  firstEventAt: string;
  lastEventAt: string;
}

function groupToGql(group: SignalGroup): SignalGroupGql {
  return {
    id: group.id,
    _signalIds: group.signalIds,
    tickers: group.tickers,
    summary: group.summary,
    outputType: group.outputType ?? 'INSIGHT',
    firstEventAt: group.firstEventAt,
    lastEventAt: group.lastEventAt,
  };
}

// ---------------------------------------------------------------------------
// Ticker-grouped shape
// ---------------------------------------------------------------------------

interface TickerSignalGroupsGql {
  ticker: string;
  groups: SignalGroupGql[];
}

// ---------------------------------------------------------------------------
// Query Resolvers
// ---------------------------------------------------------------------------

export async function signalGroupsResolver(
  _parent: unknown,
  args: { ticker?: string; since?: string; limit?: number },
): Promise<SignalGroupGql[]> {
  if (!groupArchive) return [];

  const filter: SignalGroupQueryFilter = {};
  if (args.ticker) filter.ticker = args.ticker;
  if (args.since) filter.since = args.since;
  filter.limit = args.limit ?? 20;

  const groups = await groupArchive.query(filter);
  return groups.map(groupToGql);
}

/**
 * Groups signal groups by their primary ticker (first ticker in the array),
 * filtered to only portfolio tickers.
 * Each ticker appears once; groups are sorted by signal count descending.
 */
export async function signalGroupsByTickerResolver(
  _parent: unknown,
  args: { since?: string; limit?: number },
): Promise<TickerSignalGroupsGql[]> {
  if (!groupArchive) return [];

  // Get portfolio tickers — push into the query filter to skip non-portfolio
  // groups during the JSONL scan instead of filtering in memory.
  const snapshot = snapshotStore ? await snapshotStore.getLatest() : null;
  const positionTickerList =
    snapshot && snapshot.positions.length > 0 ? snapshot.positions.map((p) => p.symbol.toUpperCase()) : null;

  const filter: SignalGroupQueryFilter = {};
  if (positionTickerList) filter.tickers = positionTickerList;
  if (args.since) filter.since = args.since;
  filter.limit = args.limit ?? 100;

  const groups = await groupArchive.query(filter);
  const gqlGroups = groups.map(groupToGql);

  // Group by primary ticker (first in tickers array), case-insensitive
  const byTicker = new Map<string, SignalGroupGql[]>();
  for (const g of gqlGroups) {
    const primary = (g.tickers[0] ?? 'OTHER').toUpperCase();
    const bucket = byTicker.get(primary);
    if (bucket) {
      bucket.push(g);
    } else {
      byTicker.set(primary, [g]);
    }
  }

  // Sort tickers by total group count descending
  return Array.from(byTicker.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([ticker, tickerGroups]) => ({ ticker, groups: tickerGroups }));
}

export async function signalGroupResolver(_parent: unknown, args: { id: string }): Promise<SignalGroupGql | null> {
  if (!groupArchive) return null;

  const group = await groupArchive.getById(args.id);
  return group ? groupToGql(group) : null;
}

// ---------------------------------------------------------------------------
// Field Resolver — resolves SignalGroup.signals from signalIds
// ---------------------------------------------------------------------------

export const signalGroupFieldResolvers = {
  signals: async (parent: SignalGroupGql) => {
    const archive = signalArchive;
    if (!archive) return [];

    const resolved = await Promise.all(parent._signalIds.map((id) => archive.getById(id)));

    return resolved.filter((s): s is NonNullable<typeof s> => s != null).map(signalToGql);
  },
};
