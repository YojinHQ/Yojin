/**
 * Insight resolvers — query and trigger ProcessInsights reports.
 *
 * Module-level state: setInsightStore and setInsightsOrchestrator are called
 * once during server startup.
 */

import type { Orchestrator } from '../../../agents/orchestrator.js';
import type { InsightStore } from '../../../insights/insight-store.js';
import type { InsightReport } from '../../../insights/types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let store: InsightStore | null = null;
let orchestrator: Orchestrator | null = null;

export function setInsightStore(s: InsightStore): void {
  store = s;
}

export function setInsightsOrchestrator(o: Orchestrator): void {
  orchestrator = o;
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

interface SignalSummaryGql {
  signalId: string;
  type: string;
  title: string;
  impact: string;
  confidence: number;
  url: string | null;
}

interface PositionInsightGql {
  symbol: string;
  name: string;
  rating: string;
  conviction: number;
  thesis: string;
  keySignals: SignalSummaryGql[];
  risks: string[];
  opportunities: string[];
  memoryContext: string | null;
  priceTarget: number | null;
}

interface PortfolioInsightGql {
  overallHealth: string;
  summary: string;
  sectorThemes: string[];
  macroContext: string;
  topRisks: string[];
  topOpportunities: string[];
  actionItems: string[];
}

interface EmotionStateGql {
  confidence: number;
  riskAppetite: number;
  reason: string;
}

interface InsightReportGql {
  id: string;
  snapshotId: string;
  positions: PositionInsightGql[];
  portfolio: PortfolioInsightGql;
  emotionState: EmotionStateGql;
  createdAt: string;
  durationMs: number;
}

function toGql(report: InsightReport): InsightReportGql {
  return {
    id: report.id,
    snapshotId: report.snapshotId,
    positions: report.positions.map((p) => ({
      ...p,
      keySignals: p.keySignals.map((s) => ({ ...s, url: s.url ?? null })),
    })),
    portfolio: report.portfolio,
    emotionState: report.emotionState,
    createdAt: report.createdAt,
    durationMs: report.durationMs,
  };
}

// ---------------------------------------------------------------------------
// Query Resolvers
// ---------------------------------------------------------------------------

export async function latestInsightReportQuery(): Promise<InsightReportGql | null> {
  if (!store) return null;
  const report = await store.getLatest();
  return report ? toGql(report) : null;
}

export async function insightReportsQuery(_parent: unknown, args: { limit?: number }): Promise<InsightReportGql[]> {
  if (!store) return [];
  const reports = await store.getRecent(args.limit ?? 10);
  return reports.map(toGql);
}

export async function insightReportQuery(_parent: unknown, args: { id: string }): Promise<InsightReportGql | null> {
  if (!store) return null;
  const report = await store.getById(args.id);
  return report ? toGql(report) : null;
}

// ---------------------------------------------------------------------------
// Mutation Resolver
// ---------------------------------------------------------------------------

export async function processInsightsMutation(): Promise<InsightReportGql | null> {
  if (!orchestrator) {
    throw new Error('Orchestrator not available — cannot process insights');
  }

  await orchestrator.execute('process-insights', {
    message: 'Process portfolio insights',
  });

  // The workflow persists the report via save_insight_report tool — fetch the latest.
  if (!store) return null;
  const report = await store.getLatest();
  return report ? toGql(report) : null;
}
