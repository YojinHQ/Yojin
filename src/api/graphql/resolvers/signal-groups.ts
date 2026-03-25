/**
 * SignalGroup resolvers — query signal groups (causal chains) from the archive.
 *
 * Module-level state: setSignalGroupArchive and setGroupSignalArchive are called
 * once during server startup.
 */

import { toGql as signalToGql } from './signals.js';
import type { SignalArchive } from '../../../signals/archive.js';
import type { SignalGroupArchive, SignalGroupQueryFilter } from '../../../signals/group-archive.js';
import type { SignalGroup } from '../../../signals/group-types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let groupArchive: SignalGroupArchive | null = null;
let signalArchive: SignalArchive | null = null;

export function setSignalGroupArchive(a: SignalGroupArchive): void {
  groupArchive = a;
}

export function setGroupSignalArchive(a: SignalArchive): void {
  signalArchive = a;
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
