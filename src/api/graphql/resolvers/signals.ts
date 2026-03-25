/**
 * Signal resolvers — query stored signals from the archive.
 *
 * Module-level state: setSignalArchive is called once during server startup.
 */

import type { SignalArchive, SignalQueryFilter } from '../../../signals/archive.js';
import type { Signal } from '../../../signals/types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let archive: SignalArchive | null = null;

export function setSignalArchive(a: SignalArchive): void {
  archive = a;
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

export interface SignalSourceGql {
  id: string;
  name: string;
  type: string;
  reliability: number;
}

export interface SignalGql {
  id: string;
  type: string;
  title: string;
  content: string | null;
  publishedAt: string;
  ingestedAt: string;
  confidence: number;
  contentHash: string;
  tickers: string[];
  sources: SignalSourceGql[];
  sourceCount: number;
  link: string | null;
  tier1: string | null;
  tier2: string | null;
  sentiment: string | null;
  outputType: string;
  groupId: string | null;
  version: number;
}

export function toGql(signal: Signal): SignalGql {
  return {
    id: signal.id,
    type: signal.type,
    title: signal.title,
    content: signal.content ?? null,
    publishedAt: signal.publishedAt,
    ingestedAt: signal.ingestedAt,
    confidence: signal.confidence,
    contentHash: signal.contentHash,
    tickers: signal.assets.map((a) => a.ticker),
    sources: signal.sources.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      reliability: s.reliability,
    })),
    sourceCount: signal.sources.length,
    link: typeof signal.metadata?.link === 'string' ? signal.metadata.link : null,
    tier1: signal.tier1 ?? null,
    tier2: signal.tier2 ?? null,
    sentiment: signal.sentiment ?? null,
    outputType: signal.outputType ?? 'INSIGHT',
    groupId: signal.groupId ?? null,
    version: signal.version ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

export async function signalsResolver(
  _parent: unknown,
  args: {
    type?: string;
    ticker?: string;
    sourceId?: string;
    since?: string;
    until?: string;
    search?: string;
    minConfidence?: number;
    outputType?: string;
    limit?: number;
  },
): Promise<SignalGql[]> {
  if (!archive) return [];

  const filter: SignalQueryFilter = {};
  if (args.type) filter.type = args.type;
  if (args.ticker) filter.ticker = args.ticker;
  if (args.sourceId) filter.sourceId = args.sourceId;
  if (args.since) filter.since = args.since;
  if (args.until) filter.until = args.until;
  if (args.search) filter.search = args.search;
  if (args.minConfidence != null) filter.minConfidence = args.minConfidence;
  if (args.outputType) filter.outputType = args.outputType;
  filter.limit = args.limit ?? 50;

  const signals = await archive.query(filter);
  return signals.map(toGql);
}
