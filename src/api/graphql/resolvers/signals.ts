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
// GraphQL shapes (flattened for the wire)
// ---------------------------------------------------------------------------

interface SignalGql {
  id: string;
  type: string;
  title: string;
  content: string | null;
  publishedAt: string;
  ingestedAt: string;
  confidence: number;
  contentHash: string;
  tickers: string[];
  sourceId: string;
  sourceName: string;
  link: string | null;
}

function toGql(signal: Signal): SignalGql {
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
    sourceId: signal.sources[0].id,
    sourceName: signal.sources[0].name,
    link: typeof signal.metadata?.link === 'string' ? signal.metadata.link : null,
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
  filter.limit = args.limit ?? 50;

  const signals = await archive.query(filter);
  return signals.map(toGql);
}
