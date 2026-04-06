/**
 * Signal resolvers — shared types and by-ID lookup.
 *
 * The main signal query is `curatedSignals` in curated-signals.ts.
 * This file provides the shared `SignalGql` type, `toGql` mapper,
 * and the `signalsByIds` resolver for direct ID-based lookups.
 */

import type { SignalArchive } from '../../../signals/archive.js';
import { classifyOutputType } from '../../../signals/signal-filter.js';
import type { Signal, SignalSentiment, SignalType, SourceType } from '../../../signals/types.js';

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
  type: SourceType;
  reliability: number;
}

export interface SignalGql {
  id: string;
  type: SignalType;
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
  sentiment: SignalSentiment | null;
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
    outputType: classifyOutputType(signal),
    groupId: signal.groupId ?? null,
    version: signal.version ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

export async function signalsByIdsResolver(_parent: unknown, args: { ids: string[] }): Promise<SignalGql[]> {
  if (!archive || args.ids.length === 0) return [];
  const signals = await archive.getByIds(args.ids);
  return signals.map(toGql);
}
