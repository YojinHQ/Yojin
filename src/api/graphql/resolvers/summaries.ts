/**
 * Summary resolvers — query neutral intel observations from macro + micro
 * insight pipelines. Summaries are read-only: no mutations, no approval
 * lifecycle. Action-style mutations live in resolvers/actions.ts.
 *
 * Module-level state: setSummaryStore is called once during server startup.
 */

import type { SummaryStore } from '../../../summaries/summary-store.js';
import { type Summary, type SummaryFlow, hasSubstance } from '../../../summaries/types.js';

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

export function setSummaryStore(s: SummaryStore): void {
  store = s;
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

interface SummaryGql {
  id: string;
  ticker: string;
  what: string;
  flow: SummaryFlow;
  severity: number | null;
  severityLabel: string;
  sourceSignalIds: string[];
  contentHash: string;
  createdAt: string;
}

function toGql(summary: Summary): SummaryGql {
  return {
    id: summary.id,
    ticker: summary.ticker,
    what: summary.what,
    flow: summary.flow,
    severity: summary.severity ?? null,
    severityLabel: deriveSeverityLabel(summary.severity),
    sourceSignalIds: summary.sourceSignalIds ?? [],
    contentHash: summary.contentHash,
    createdAt: summary.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function summariesResolver(
  _parent: unknown,
  args: { ticker?: string; flow?: SummaryFlow; since?: string; limit?: number },
): Promise<SummaryGql[]> {
  if (!store) return [];

  const summaries = await store.query({
    ticker: args.ticker,
    flow: args.flow,
    since: args.since,
    limit: args.limit ?? 50,
  });

  // Filter out legacy low-substance summaries that were persisted before
  // the hasSubstance gate was added to the producer pipelines.
  return summaries.filter((s) => hasSubstance(s.what)).map(toGql);
}

export async function summaryResolver(_parent: unknown, args: { id: string }): Promise<SummaryGql | null> {
  if (!store) return null;

  const summary = await store.getById(args.id);
  if (!summary || !hasSubstance(summary.what)) return null;
  return toGql(summary);
}
