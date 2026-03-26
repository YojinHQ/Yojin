/**
 * Signal assessment resolvers — query assessment reports.
 *
 * Module-level state: setAssessmentStore is called at startup.
 */

import type { AssessmentStore } from '../../../signals/curation/assessment-store.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let store: AssessmentStore | null = null;

export function setAssessmentStore(s: AssessmentStore): void {
  store = s;
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

interface SignalAssessmentGql {
  signalId: string;
  ticker: string;
  verdict: string;
  relevanceScore: number;
  reasoning: string;
  thesisAlignment: string;
  actionability: number;
}

interface AssessmentReportGql {
  id: string;
  assessedAt: string;
  tickers: string[];
  assessments: SignalAssessmentGql[];
  signalsInput: number;
  signalsKept: number;
  thesisSummary: string;
  durationMs: number;
}

interface AssessmentStatusGql {
  lastRunAt: string | null;
  signalsAssessed: number;
  signalsKept: number;
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

export async function signalAssessmentsResolver(
  _parent: unknown,
  args: { ticker?: string; since?: string; limit?: number },
): Promise<AssessmentReportGql[]> {
  if (!store) return [];

  const tickers = args.ticker ? [args.ticker] : [];
  if (tickers.length === 0) {
    // Return latest report if no ticker specified
    const latest = await store.getLatest();
    return latest ? [toGql(latest)] : [];
  }

  const reports = await store.queryByTickers(tickers, {
    since: args.since,
    limit: args.limit ?? 10,
  });

  return reports.map(toGql);
}

export async function assessmentStatusResolver(): Promise<AssessmentStatusGql> {
  if (!store) return { lastRunAt: null, signalsAssessed: 0, signalsKept: 0 };

  const watermark = await store.getLatestWatermark();
  if (!watermark) return { lastRunAt: null, signalsAssessed: 0, signalsKept: 0 };

  return {
    lastRunAt: watermark.lastRunAt,
    signalsAssessed: watermark.signalsAssessed,
    signalsKept: watermark.signalsKept,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toGql(report: {
  id: string;
  assessedAt: string;
  tickers: string[];
  assessments: Array<{
    signalId: string;
    ticker: string;
    verdict: string;
    relevanceScore: number;
    reasoning: string;
    thesisAlignment: string;
    actionability: number;
  }>;
  signalsInput: number;
  signalsKept: number;
  thesisSummary: string;
  durationMs: number;
}): AssessmentReportGql {
  return {
    id: report.id,
    assessedAt: report.assessedAt,
    tickers: report.tickers,
    assessments: report.assessments.map((a) => ({
      signalId: a.signalId,
      ticker: a.ticker,
      verdict: a.verdict,
      relevanceScore: a.relevanceScore,
      reasoning: a.reasoning,
      thesisAlignment: a.thesisAlignment,
      actionability: a.actionability,
    })),
    signalsInput: report.signalsInput,
    signalsKept: report.signalsKept,
    thesisSummary: report.thesisSummary,
    durationMs: report.durationMs,
  };
}
