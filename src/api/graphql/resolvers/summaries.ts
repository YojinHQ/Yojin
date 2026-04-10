/**
 * Summary resolvers — query and mutate summaries with approval workflow.
 *
 * Module-level state: setSummaryStore is called once during server startup.
 */

import type { SummaryStore } from '../../../summaries/summary-store.js';
import type { Summary, SummaryStatus } from '../../../summaries/types.js';

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
  signalId: string | null;
  skillId: string | null;
  what: string;
  why: string;
  tickers: string[];
  source: string;
  riskContext: string | null;
  severity: number | null;
  severityLabel: string;
  status: SummaryStatus;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  dismissedAt: string | null;
}

function toGql(summary: Summary): SummaryGql {
  return {
    id: summary.id,
    signalId: summary.signalId ?? null,
    skillId: summary.skillId ?? null,
    what: summary.what,
    why: summary.why,
    tickers: summary.tickers ?? [],
    source: summary.source,
    riskContext: summary.riskContext ?? null,
    severity: summary.severity ?? null,
    severityLabel: deriveSeverityLabel(summary.severity),
    status: summary.status,
    expiresAt: summary.expiresAt,
    createdAt: summary.createdAt,
    resolvedAt: summary.resolvedAt ?? null,
    resolvedBy: summary.resolvedBy ?? null,
    dismissedAt: summary.dismissedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function summariesResolver(
  _parent: unknown,
  args: { status?: SummaryStatus; since?: string; limit?: number; dismissed?: boolean },
): Promise<SummaryGql[]> {
  if (!store) return [];

  const summaries = await store.query({
    status: args.status,
    since: args.since,
    limit: args.limit ?? 50,
    dismissed: args.dismissed,
  });

  return summaries.map(toGql);
}

export async function summaryResolver(_parent: unknown, args: { id: string }): Promise<SummaryGql | null> {
  if (!store) return null;

  const summary = await store.getById(args.id);
  return summary ? toGql(summary) : null;
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

export async function approveSummaryMutation(_parent: unknown, args: { id: string }): Promise<SummaryGql> {
  if (!store) throw new Error('Summary store not initialized');

  const result = await store.approve(args.id);
  if (!result.success) {
    throw new Error(result.error);
  }

  return toGql(result.data);
}

export async function rejectSummaryMutation(_parent: unknown, args: { id: string }): Promise<SummaryGql> {
  if (!store) throw new Error('Summary store not initialized');

  const result = await store.reject(args.id);
  if (!result.success) {
    throw new Error(result.error);
  }

  return toGql(result.data);
}

export async function dismissSummaryMutation(_parent: unknown, args: { id: string }): Promise<SummaryGql> {
  if (!store) throw new Error('Summary store not initialized');
  const result = await store.dismiss(args.id);
  if (!result.success) throw new Error(result.error);
  return toGql(result.data);
}
