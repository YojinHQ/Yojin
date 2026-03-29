import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useSubscription } from 'urql';
import { cn } from '../lib/utils';
import {
  CURATED_SIGNALS_QUERY,
  LATEST_INSIGHT_REPORT_QUERY,
  ON_WORKFLOW_PROGRESS_SUBSCRIPTION,
  CURATION_WORKFLOW_STATUS_QUERY,
  INSIGHTS_WORKFLOW_STATUS_QUERY,
} from '../api/documents';
import type {
  CuratedSignal,
  CuratedSignalsQueryResult,
  CuratedSignalsVariables,
  LatestInsightReportQueryResult,
  OnWorkflowProgressSubscriptionResult,
  OnWorkflowProgressVariables,
  CurationWorkflowStatusQueryResult,
  InsightsWorkflowStatusQueryResult,
  WorkflowProgressEvent,
} from '../api/types';
import Badge from '../components/common/badge';
import type { BadgeVariant } from '../components/common/badge';
import Card from '../components/common/card';
import { PageFeatureGate } from '../components/common/feature-gate';
import { collectInsightSignalIds } from '../lib/insight-signals';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIGNAL_TYPES = ['ALL', 'NEWS', 'FUNDAMENTAL', 'SENTIMENT', 'TECHNICAL', 'MACRO'] as const;

const DATE_RANGES = [
  { label: '24h', value: '1' },
  { label: '7d', value: '7' },
  { label: '30d', value: '30' },
  { label: 'All', value: '' },
] as const;

const CONFIDENCE_PRESETS = [
  { label: 'All', value: 0 },
  { label: '>50%', value: 0.5 },
  { label: '>75%', value: 0.75 },
  { label: '>90%', value: 0.9 },
] as const;

// ---------------------------------------------------------------------------
// Badge variant maps
// ---------------------------------------------------------------------------

const typeVariant: Record<string, BadgeVariant> = {
  NEWS: 'info',
  FUNDAMENTAL: 'success',
  SENTIMENT: 'warning',
  TECHNICAL: 'neutral',
  MACRO: 'error',
  FILINGS: 'neutral',
  SOCIALS: 'info',
  TRADING_LOGIC_TRIGGER: 'warning',
};

// ---------------------------------------------------------------------------
// Pipeline stage definitions
// ---------------------------------------------------------------------------

interface PipelineStage {
  title: string;
  agents: string[];
  parallel: boolean;
  tasks: string[];
}

const PIPELINE_STAGES: PipelineStage[] = [
  {
    title: 'Data Gathering',
    agents: ['Research Analyst'],
    parallel: false,
    tasks: ['Portfolio positions', 'Signal archive (7 days)', 'Market fundamentals & sentiment'],
  },
  {
    title: 'Deep Analysis',
    agents: ['Research Analyst', 'Risk Manager'],
    parallel: true,
    tasks: ['Position-level research', 'Exposure & correlation', 'Earnings proximity'],
  },
  {
    title: 'Synthesis',
    agents: ['Strategist'],
    parallel: false,
    tasks: ['Sentiment & conviction scores', 'Outlook generation', 'Action items & memory update'],
  },
];

const CURATION_STAGES = [
  {
    title: 'Tier 1 — Deterministic Filter',
    agents: [] as string[],
    tasks: ['Confidence filter', 'Spam detection', 'Portfolio relevance scoring', 'Top-N per position'],
  },
  {
    title: 'Tier 2 — Research Analyst',
    agents: ['Research Analyst'],
    tasks: ['Classify CRITICAL / IMPORTANT / NOISE', 'Data quality & redundancy check'],
  },
  {
    title: 'Tier 2 — Strategist',
    agents: ['Strategist'],
    tasks: ['Score against active thesis', 'Thesis alignment assessment', 'Save structured assessments'],
  },
];

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Insights() {
  return (
    <PageFeatureGate requires="both">
      <InsightsContent />
    </PageFeatureGate>
  );
}

function InsightsContent() {
  const [searchParams] = useSearchParams();
  const urlHighlight = searchParams.get('highlight');
  const initialTicker = searchParams.get('ticker') ?? '';
  const initialType = searchParams.get('type') ?? 'ALL';
  const initialSearch = searchParams.get('search') ?? '';

  const [highlightId] = useState(urlHighlight);

  // Filter state
  const [search, setSearch] = useState(initialSearch);
  const [typeFilter, setTypeFilter] = useState<string>(initialType);
  const [tickerFilter, setTickerFilter] = useState(initialTicker);
  const [minConfidence, setMinConfidence] = useState(0);
  const [dateRangeLabel, setDateRangeLabel] = useState('');
  const [since, setSince] = useState<string | undefined>(undefined);
  const [sourceFilter, setSourceFilter] = useState('');

  const setDateRange = useCallback((days: string) => {
    setDateRangeLabel(days);
    setSince(days ? new Date(Date.now() - Number(days) * 86_400_000).toISOString() : undefined);
  }, []);

  // Curated signals — one query, all tickers, 7-day window; filter client-side
  const curatedVars: CuratedSignalsVariables = useMemo(
    () => ({ limit: 500, since: new Date(Date.now() - 7 * 86_400_000).toISOString() }),
    [],
  );
  const [curatedResult, reexecuteCurated] = useQuery<CuratedSignalsQueryResult, CuratedSignalsVariables>({
    query: CURATED_SIGNALS_QUERY,
    variables: curatedVars,
    requestPolicy: 'network-only',
  });
  const allCuratedSignals = useMemo(() => curatedResult.data?.curatedSignals ?? [], [curatedResult.data]);

  // Latest insight report
  const [insightQueryResult, reexecuteInsights] = useQuery<LatestInsightReportQueryResult>({
    query: LATEST_INSIGHT_REPORT_QUERY,
  });

  // Workflow status queries (for reconnection on navigate-back)
  const [insightsStatusResult, reexecuteInsightsStatus] = useQuery<InsightsWorkflowStatusQueryResult>({
    query: INSIGHTS_WORKFLOW_STATUS_QUERY,
    requestPolicy: 'network-only',
  });
  const [curationStatusResult, reexecuteCurationStatus] = useQuery<CurationWorkflowStatusQueryResult>({
    query: CURATION_WORKFLOW_STATUS_QUERY,
    requestPolicy: 'network-only',
  });

  // Background workflow status — detect when scheduler-triggered workflows are running
  const backendCurationRunning = curationStatusResult.data?.curationWorkflowStatus.running ?? false;
  const backendInsightsRunning = insightsStatusResult.data?.insightsWorkflowStatus.running ?? false;

  const curationLoading = backendCurationRunning;
  const insightsLoading = backendInsightsRunning;

  // Curation progress subscription
  const [curationProgressResult] = useSubscription<
    OnWorkflowProgressSubscriptionResult,
    WorkflowProgressEvent[],
    OnWorkflowProgressVariables
  >(
    { query: ON_WORKFLOW_PROGRESS_SUBSCRIPTION, variables: { workflowId: 'full-curation' }, pause: !curationLoading },
    (prev = [], data) => [...prev, data.onWorkflowProgress],
  );
  const curationEvents = curationProgressResult.data ?? [];
  const lastCurationEvent = curationEvents[curationEvents.length - 1];

  // Insights progress subscription
  const [insightsProgressResult] = useSubscription<
    OnWorkflowProgressSubscriptionResult,
    WorkflowProgressEvent[],
    OnWorkflowProgressVariables
  >(
    {
      query: ON_WORKFLOW_PROGRESS_SUBSCRIPTION,
      variables: { workflowId: 'process-insights' },
      pause: !insightsLoading,
    },
    (prev = [], data) => [...prev, data.onWorkflowProgress],
  );
  const insightsEvents = insightsProgressResult.data ?? [];
  const lastInsightsEvent = insightsEvents[insightsEvents.length - 1];

  // Refresh data when background workflows complete
  useEffect(() => {
    if (lastCurationEvent?.stage === 'complete' || lastCurationEvent?.stage === 'error') {
      reexecuteCurated({ requestPolicy: 'network-only' });
      reexecuteCurationStatus({ requestPolicy: 'network-only' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reexecute functions are stable
  }, [lastCurationEvent?.stage]);

  useEffect(() => {
    if (lastInsightsEvent?.stage === 'complete' || lastInsightsEvent?.stage === 'error') {
      reexecuteInsights({ requestPolicy: 'network-only' });
      reexecuteInsightsStatus({ requestPolicy: 'network-only' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reexecute functions are stable
  }, [lastInsightsEvent?.stage]);

  // Cross-reference: which signals appear in the analysis report
  const insightSignalIds = useMemo(
    () => collectInsightSignalIds(insightQueryResult.data?.latestInsightReport),
    [insightQueryResult.data],
  );
  const insightSignalImpact = useMemo(() => {
    const map = new Map<string, string>();
    const r = insightQueryResult.data?.latestInsightReport;
    if (!r) return map;
    for (const pos of r.positions) {
      for (const sig of pos.keySignals) {
        map.set(sig.signalId, sig.impact);
      }
    }
    return map;
  }, [insightQueryResult.data]);

  // Client-side filtered signals
  const filteredSignals = useMemo(() => {
    let items = allCuratedSignals;
    if (tickerFilter) {
      const upper = tickerFilter.toUpperCase();
      items = items.filter((cs) => cs.scores.some((s) => s.ticker === upper));
    }
    if (typeFilter !== 'ALL') {
      items = items.filter((cs) => cs.signal.type === typeFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (cs) => cs.signal.title.toLowerCase().includes(q) || cs.signal.content?.toLowerCase().includes(q),
      );
    }
    if (minConfidence > 0) {
      items = items.filter((cs) => cs.signal.confidence >= minConfidence);
    }
    if (since) {
      items = items.filter((cs) => cs.signal.publishedAt >= since);
    }
    if (sourceFilter) {
      items = items.filter((cs) => cs.signal.sources.some((src) => src.id === sourceFilter));
    }
    // Sort newest first by publishedAt
    return [...items].sort((a, b) => b.signal.publishedAt.localeCompare(a.signal.publishedAt));
  }, [allCuratedSignals, tickerFilter, typeFilter, search, minConfidence, since, sourceFilter]);

  const sources = useMemo(() => {
    const map = new Map<string, string>();
    for (const cs of allCuratedSignals) {
      for (const src of cs.signal.sources) {
        if (!map.has(src.id)) map.set(src.id, src.name);
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allCuratedSignals]);

  const usedInAnalysis = allCuratedSignals.filter((cs) => insightSignalIds.has(cs.signal.id)).length;
  const loading = curatedResult.fetching;

  const subtitle = useMemo(() => {
    if (loading) return 'Loading...';
    return `${filteredSignals.length} signal${filteredSignals.length !== 1 ? 's' : ''}${usedInAnalysis > 0 ? ` · ${usedInAnalysis} in analysis` : ''}`;
  }, [loading, filteredSignals.length, usedInAnalysis]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="px-6 pt-6 pb-4">
        <h1 className="text-lg font-semibold text-text-primary">Signals</h1>
        <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
      </header>

      {/* Workflow activity logs */}
      {curationLoading && <CurationActivityLog events={curationEvents} />}
      {insightsLoading && (
        <div className="px-6 pb-4">
          <WorkflowDiagram events={insightsEvents} />
        </div>
      )}

      {/* Filters */}
      <div className="px-6 pb-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Search signals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 rounded-lg border border-border bg-bg-secondary px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none w-56"
          />
          <input
            type="text"
            placeholder="Ticker (e.g. AAPL)"
            value={tickerFilter}
            onChange={(e) => setTickerFilter(e.target.value)}
            className="h-8 rounded-lg border border-border bg-bg-secondary px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none w-36"
          />
          {sources.length > 1 && (
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="h-8 rounded-lg border border-border bg-bg-secondary px-2 text-sm text-text-primary focus:border-accent-primary focus:outline-none"
            >
              <option value="">All sources</option>
              {sources.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex gap-1">
            {SIGNAL_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer',
                  typeFilter === t
                    ? 'bg-accent-primary text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <span className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-muted mr-1">Period:</span>
            {DATE_RANGES.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => setDateRange(d.value)}
                className={cn(
                  'px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer',
                  dateRangeLabel === d.value
                    ? 'bg-accent-primary/10 text-accent-primary'
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
          <span className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-muted mr-1">Confidence:</span>
            {CONFIDENCE_PRESETS.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => setMinConfidence(c.value)}
                className={cn(
                  'px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer',
                  minConfidence === c.value
                    ? 'bg-accent-primary/10 text-accent-primary'
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Signal list */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {!loading && filteredSignals.length === 0 && (
          <EmptyState icon="signal" message="No signals yet. Signals will appear automatically as the pipeline runs." />
        )}
        <div className="space-y-2">
          {filteredSignals.map((cs) => (
            <SignalRow
              key={cs.signal.id}
              curated={cs}
              highlighted={cs.signal.id === highlightId}
              usedInInsight={insightSignalIds.has(cs.signal.id)}
              insightImpact={insightSignalImpact.get(cs.signal.id)}
              onFilterByTicker={setTickerFilter}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  icon,
  message,
  children,
}: {
  icon: 'signal' | 'groups' | 'analysis';
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24">
      {icon === 'signal' && (
        <svg
          className="h-14 w-14 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
          />
        </svg>
      )}
      {icon === 'groups' && (
        <svg
          className="h-14 w-14 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
          />
        </svg>
      )}
      {icon === 'analysis' && (
        <svg
          className="h-14 w-14 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605"
          />
        </svg>
      )}
      <p className="text-base text-text-muted text-center max-w-sm">{message}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signal row
// ---------------------------------------------------------------------------

function SignalRow({
  curated,
  highlighted,
  usedInInsight,
  insightImpact,
  onFilterByTicker,
}: {
  curated: CuratedSignal;
  highlighted: boolean;
  usedInInsight: boolean;
  insightImpact?: string;
  onFilterByTicker: (ticker: string) => void;
}) {
  const signal = curated.signal;
  const topScore =
    curated.scores.length > 0
      ? curated.scores.reduce((best, s) => (s.compositeScore > best.compositeScore ? s : best), curated.scores[0])
      : null;
  const relevancePct = topScore ? Math.round(topScore.compositeScore * 100) : 0;

  const [expanded, setExpanded] = useState(highlighted);
  const variant = typeVariant[signal.type] ?? 'neutral';
  const date = new Date(signal.publishedAt);
  const timeAgo = formatTimeAgo(date);
  const confidencePct = Math.round(signal.confidence * 100);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted]);

  return (
    <div ref={rowRef}>
      <Card className={cn('p-4 transition-all', highlighted && 'ring-2 ring-accent-primary/50')}>
        <div
          role="button"
          tabIndex={0}
          className="flex w-full items-start justify-between cursor-pointer text-left"
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpanded(!expanded);
            }
          }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant={variant} size="sm">
                {signal.type}
              </Badge>
              {signal.tickers.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterByTicker(t);
                  }}
                  className="text-xs font-semibold text-accent-primary hover:underline cursor-pointer"
                >
                  {t}
                </button>
              ))}
              {topScore && (
                <span
                  className={cn(
                    'text-xs font-medium px-1.5 py-0.5 rounded',
                    relevancePct >= 60
                      ? 'bg-success/10 text-success'
                      : relevancePct >= 30
                        ? 'bg-warning/10 text-warning'
                        : 'bg-bg-tertiary text-text-muted',
                  )}
                >
                  {relevancePct}% relevant
                </span>
              )}
              <span className="text-xs text-text-muted">{timeAgo}</span>
              <span className="text-xs text-text-muted">
                · {signal.sources.map((s) => s.name).join(', ')}
                {signal.sourceCount > 1 && ` (${signal.sourceCount})`}
              </span>
              {usedInInsight && (
                <Badge variant="accent" size="xs">
                  {insightImpact === 'POSITIVE' && '↑ '}
                  {insightImpact === 'NEGATIVE' && '↓ '}
                  IN ANALYSIS
                </Badge>
              )}
            </div>
            <p className="text-sm font-medium text-text-primary truncate">{signal.title}</p>
          </div>

          <div className="flex items-center gap-3 ml-3 flex-shrink-0">
            <div className="flex items-center gap-2 w-24">
              <div className="flex-1 h-1.5 rounded-full bg-bg-tertiary">
                <div
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    confidencePct >= 80 ? 'bg-success' : confidencePct >= 50 ? 'bg-warning' : 'bg-error',
                  )}
                  style={{ width: `${confidencePct}%` }}
                />
              </div>
              <span
                className={cn(
                  'text-xs font-medium w-8 text-right',
                  confidencePct >= 80 ? 'text-success' : confidencePct >= 50 ? 'text-warning' : 'text-text-muted',
                )}
              >
                {confidencePct}%
              </span>
            </div>
            <svg
              className={cn('h-4 w-4 text-text-muted transition-transform', expanded && 'rotate-180')}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 border-t border-border pt-3 space-y-3">
            {signal.content && (
              <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{signal.content}</p>
            )}

            {curated.scores.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap">
                {curated.scores.map((s) => (
                  <span key={s.ticker} className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary">
                    {s.ticker}: {Math.round(s.compositeScore * 100)}% relevance
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
              <span>Published: {date.toLocaleString()}</span>
              <span>· Curated: {new Date(curated.curatedAt).toLocaleString()}</span>
              <span>· Source: {signal.sources.map((s) => s.name).join(', ')}</span>
            </div>

            <div className="flex items-center gap-3">
              {signal.link ? (
                <a
                  href={signal.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-accent-primary hover:underline"
                >
                  View original source
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                </a>
              ) : (
                <span className="text-xs text-text-muted italic">No external source link</span>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Curation activity log (shown while curation is running)
// ---------------------------------------------------------------------------

function CurationActivityLog({ events }: { events: WorkflowProgressEvent[] }) {
  const [elapsed, setElapsed] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  let activeStage = 0;
  const completedStages = new Set<number>();
  let workflowError: string | null = null;
  const activities: string[] = [];

  for (const evt of events) {
    if (evt.stage === 'stage_start' && evt.stageIndex != null) {
      activeStage = evt.stageIndex;
    } else if (evt.stage === 'stage_complete' && evt.stageIndex != null) {
      completedStages.add(evt.stageIndex);
    } else if (evt.stage === 'error') {
      workflowError = evt.error ?? 'Unknown error';
    } else if (evt.stage === 'activity' && evt.message) {
      activities.push(evt.message);
    }
  }

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activities.length]);

  return (
    <div className="px-6 pb-4">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-secondary">Curation Pipeline</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">{elapsed}s</span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
            {events.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">LIVE</span>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3 mb-4">
          {CURATION_STAGES.map((stage, i) => {
            const isDone = completedStages.has(i);
            const isActive = !isDone && i === activeStage;
            return (
              <div key={stage.title} className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <div
                    className={cn(
                      'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                      isDone && 'bg-success text-white',
                      isActive && 'bg-accent-primary text-white',
                      !isDone && !isActive && 'bg-bg-tertiary text-text-muted',
                    )}
                  >
                    {isDone ? (
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2.5}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span
                    className={cn(
                      'text-xs font-medium truncate',
                      isDone ? 'text-success' : isActive ? 'text-text-primary' : 'text-text-muted',
                    )}
                  >
                    {stage.title}
                  </span>
                </div>
                {stage.agents.length > 0 && (
                  <div className="ml-8 flex flex-wrap gap-1 mb-1">
                    {stage.agents.map((agent) => (
                      <span
                        key={agent}
                        className={cn(
                          'text-xs px-1.5 py-0.5 rounded-full',
                          isActive
                            ? 'bg-accent-glow text-accent-primary'
                            : isDone
                              ? 'bg-success/10 text-success'
                              : 'bg-bg-tertiary text-text-muted',
                        )}
                      >
                        {agent}
                      </span>
                    ))}
                  </div>
                )}
                <ul className="ml-8 space-y-0.5">
                  {stage.tasks.map((task) => (
                    <li key={task} className="text-xs text-text-muted">
                      {task}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="h-1 rounded-full bg-bg-tertiary mb-4">
          <div
            className="h-1 rounded-full bg-accent-primary transition-all duration-500"
            style={{
              width: `${Math.round(((completedStages.size + (events.length > 0 ? 0.5 : 0)) / CURATION_STAGES.length) * 100)}%`,
            }}
          />
        </div>

        {workflowError && (
          <div className="mb-3 p-3 rounded-lg bg-error/10 border border-error/20">
            <p className="text-sm text-error">{workflowError}</p>
          </div>
        )}

        {activities.length > 0 && (
          <div className="border-t border-border pt-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Activity Log</span>
            </div>
            <div className="space-y-1 font-mono text-xs text-text-secondary max-h-48 overflow-y-auto">
              {activities.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    'px-2 py-1 rounded transition-opacity duration-300',
                    i === activities.length - 1 ? 'bg-bg-hover text-text-primary' : 'opacity-60',
                  )}
                >
                  {msg}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insights workflow diagram (shown while Process Insights is running)
// ---------------------------------------------------------------------------

const STAGE_TIMING_SEC = [0, 5, 15];

function WorkflowDiagram({ events }: { events: WorkflowProgressEvent[] }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const hasRealEvents = events.length > 0;
  let activeStage = 0;
  const completedStages = new Set<number>();
  let workflowError: string | null = null;
  const activities: string[] = [];

  if (hasRealEvents) {
    for (const evt of events) {
      if (evt.stage === 'stage_start' && evt.stageIndex != null) {
        activeStage = evt.stageIndex;
      } else if (evt.stage === 'stage_complete' && evt.stageIndex != null) {
        completedStages.add(evt.stageIndex);
      } else if (evt.stage === 'error') {
        workflowError = evt.error ?? 'Unknown error';
      } else if (evt.stage === 'activity' && evt.message) {
        activities.push(evt.message);
      }
    }
  } else {
    if (elapsed >= STAGE_TIMING_SEC[2]) activeStage = 2;
    else if (elapsed >= STAGE_TIMING_SEC[1]) activeStage = 1;
  }

  const visibleActivities = activities.slice(-6);

  return (
    <Card className="p-6">
      <h3 className="text-sm font-semibold text-text-secondary mb-6 text-center">Multi-Agent Pipeline</h3>

      <div className="flex items-start gap-0">
        {PIPELINE_STAGES.map((stage, i) => {
          const isDone = hasRealEvents ? completedStages.has(i) : i < activeStage;
          const status = isDone ? 'done' : i === activeStage ? 'active' : 'pending';
          return (
            <div key={stage.title} className="flex items-start flex-1 min-w-0">
              <div className="flex flex-col items-center flex-1 min-w-0">
                <div className="flex items-center w-full">
                  {i > 0 && (
                    <div className="flex-1 h-0.5 relative">
                      <div className="absolute inset-0 bg-bg-tertiary rounded-full" />
                      <div
                        className={cn(
                          'absolute inset-0 rounded-full transition-all duration-700',
                          status === 'pending' ? 'scale-x-0' : 'scale-x-100',
                          i <= activeStage ? 'bg-accent-primary' : 'bg-bg-tertiary',
                        )}
                        style={{ transformOrigin: 'left' }}
                      />
                    </div>
                  )}
                  <div
                    className={cn(
                      'relative flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500',
                      status === 'done' && 'bg-success',
                      status === 'active' && 'bg-accent-primary',
                      status === 'pending' && 'bg-bg-tertiary',
                    )}
                    style={status === 'active' ? { animation: 'pipeline-pulse 2s ease-in-out infinite' } : undefined}
                  >
                    {status === 'done' ? (
                      <svg
                        className="w-5 h-5 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2.5}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    ) : (
                      <StageIcon index={i} active={status === 'active'} />
                    )}
                  </div>
                  {i < PIPELINE_STAGES.length - 1 && (
                    <div className="flex-1 h-0.5 relative">
                      <div className="absolute inset-0 bg-bg-tertiary rounded-full" />
                      <div
                        className={cn(
                          'absolute inset-0 rounded-full transition-all duration-700',
                          i < activeStage ? 'scale-x-100 bg-accent-primary' : 'scale-x-0 bg-bg-tertiary',
                        )}
                        style={{ transformOrigin: 'left' }}
                      />
                    </div>
                  )}
                </div>
                <div
                  className={cn(
                    'mt-4 text-center px-2 transition-opacity duration-500',
                    status === 'pending' ? 'opacity-40' : 'opacity-100',
                  )}
                >
                  <p className="text-sm font-semibold text-text-primary">{stage.title}</p>
                  <div className="mt-1.5 flex flex-wrap justify-center gap-1">
                    {stage.agents.map((agent) => (
                      <span
                        key={agent}
                        className={cn(
                          'inline-block text-xs px-2 py-0.5 rounded-full',
                          status === 'active'
                            ? 'bg-accent-glow text-accent-primary'
                            : status === 'done'
                              ? 'bg-success/10 text-success'
                              : 'bg-bg-tertiary text-text-muted',
                        )}
                      >
                        {agent}
                      </span>
                    ))}
                    {stage.parallel && (
                      <span className="inline-block text-xs px-1.5 py-0.5 text-text-muted">(parallel)</span>
                    )}
                  </div>
                  <ul className="mt-2 space-y-0.5">
                    {stage.tasks.map((task) => (
                      <li key={task} className="text-xs text-text-muted">
                        {task}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {workflowError && (
        <div className="mt-4 p-3 rounded-lg bg-error/10 border border-error/20">
          <p className="text-sm text-error">{workflowError}</p>
        </div>
      )}

      {visibleActivities.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Live Activity</span>
          </div>
          <div className="space-y-1 font-mono text-xs text-text-secondary max-h-40 overflow-y-auto">
            {visibleActivities.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  'px-2 py-1 rounded transition-opacity duration-300',
                  i === visibleActivities.length - 1 ? 'bg-bg-hover text-text-primary' : 'opacity-60',
                )}
              >
                {msg}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-center gap-3">
        <p className="text-sm text-text-muted">
          {elapsed}s elapsed
          <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
        </p>
        {hasRealEvents && <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">LIVE</span>}
        {!hasRealEvents && elapsed > 3 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-bg-tertiary text-text-muted">simulated</span>
        )}
      </div>
    </Card>
  );
}

function StageIcon({ index, active }: { index: number; active: boolean }) {
  const cls = cn('w-5 h-5', active ? 'text-white' : 'text-text-muted');
  if (index === 0) {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
        />
      </svg>
    );
  }
  if (index === 1) {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
        />
      </svg>
    );
  }
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return date.toLocaleDateString();
}
