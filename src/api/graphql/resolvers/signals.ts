/**
 * Signal resolvers — query stored signals from the archive.
 *
 * Module-level state: setSignalArchive is called once during server startup.
 */

import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
import type { SignalArchive, SignalQueryFilter } from '../../../signals/archive.js';
import { classifyOutputType } from '../../../signals/curation/pipeline.js';
import type { Signal, SignalSentiment, SignalType, SourceType } from '../../../signals/types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let archive: SignalArchive | null = null;
let snapshotStore: PortfolioSnapshotStore | null = null;

export function setSignalArchive(a: SignalArchive): void {
  archive = a;
}

export function setSignalSnapshotStore(store: PortfolioSnapshotStore): void {
  snapshotStore = store;
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

export async function signalsResolver(
  _parent: unknown,
  args: {
    type?: SignalType;
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

  // Push portfolio ticker filter into the archive query so non-portfolio
  // signals are skipped during the JSONL scan (avoids parsing + allocating).
  const snapshot = !args.ticker && snapshotStore ? await snapshotStore.getLatest() : null;
  const positionTickers =
    snapshot && snapshot.positions.length > 0 ? snapshot.positions.map((p) => p.symbol.toUpperCase()) : null;

  const filter: SignalQueryFilter = {};
  if (args.type) filter.type = args.type;
  if (args.ticker) filter.ticker = args.ticker;
  if (!args.ticker && positionTickers) filter.tickers = positionTickers;
  if (args.sourceId) filter.sourceId = args.sourceId;
  if (args.since) filter.since = args.since;
  if (args.until) filter.until = args.until;
  if (args.search) filter.search = args.search;
  if (args.minConfidence != null) filter.minConfidence = args.minConfidence;
  if (args.outputType) filter.outputType = args.outputType;
  filter.limit = args.limit ?? 50;

  const signals = await archive.query(filter);

  // Dedup by normalized title — keep the most recent signal per unique title.
  // This prevents stale copies (e.g. same fundamentals refreshed daily) from
  // cluttering the feed while preserving the latest version of each data point.
  const byTitle = new Map<string, Signal>();
  for (const signal of signals) {
    const key = signal.title.trim().toLowerCase();
    const existing = byTitle.get(key);
    if (!existing || signal.publishedAt > existing.publishedAt) {
      byTitle.set(key, signal);
    }
  }

  const deduped = [...byTitle.values()];
  deduped.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
  return deduped.map(toGql);
}
