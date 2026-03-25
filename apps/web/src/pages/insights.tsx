import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useSubscription } from 'urql';
import { cn } from '../lib/utils';
import {
  INSIGHTS_WORKFLOW_STATUS_QUERY,
  LATEST_INSIGHT_REPORT_QUERY,
  ON_WORKFLOW_PROGRESS_SUBSCRIPTION,
  PROCESS_INSIGHTS_MUTATION,
} from '../api/documents';
import type {
  InsightRating,
  InsightReport,
  InsightsWorkflowStatusQueryResult,
  LatestInsightReportQueryResult,
  OnWorkflowProgressSubscriptionResult,
  OnWorkflowProgressVariables,
  PortfolioHealth,
  PositionInsight,
  ProcessInsightsMutationResult,
  SignalSummary,
  WorkflowProgressEvent,
} from '../api/types';
import Badge from '../components/common/badge';
import type { BadgeVariant } from '../components/common/badge';
import Button from '../components/common/button';
import Card from '../components/common/card';

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
    tasks: ['Ratings & conviction scores', 'Thesis generation', 'Action items & memory update'],
  },
];

const ratingVariant: Record<InsightRating, BadgeVariant> = {
  STRONG_BUY: 'success',
  BUY: 'success',
  HOLD: 'warning',
  SELL: 'error',
  STRONG_SELL: 'error',
};

const ratingLabel: Record<InsightRating, string> = {
  STRONG_BUY: 'Strong Buy',
  BUY: 'Buy',
  HOLD: 'Hold',
  SELL: 'Sell',
  STRONG_SELL: 'Strong Sell',
};

const healthVariant: Record<PortfolioHealth, BadgeVariant> = {
  STRONG: 'success',
  HEALTHY: 'success',
  CAUTIOUS: 'warning',
  WEAK: 'error',
  CRITICAL: 'error',
};

const signalTypeVariant: Record<string, BadgeVariant> = {
  NEWS: 'info',
  FUNDAMENTAL: 'success',
  SENTIMENT: 'warning',
  TECHNICAL: 'neutral',
  MACRO: 'error',
};

export default function Insights() {
  const [queryResult, reexecuteQuery] = useQuery<LatestInsightReportQueryResult>({
    query: LATEST_INSIGHT_REPORT_QUERY,
  });

  const [mutationResult, processInsights] = useMutation<ProcessInsightsMutationResult>(PROCESS_INSIGHTS_MUTATION);

  // Check if a workflow is already running (e.g. user navigated away and back)
  const [statusResult, reexecuteStatusQuery] = useQuery<InsightsWorkflowStatusQueryResult>({
    query: INSIGHTS_WORKFLOW_STATUS_QUERY,
    requestPolicy: 'network-only',
  });

  const [reconnecting, setReconnecting] = useState(false);
  const reconnectStartedAt = useRef<string | null>(null);

  // Detect running workflow on mount and set reconnecting state
  const backendRunning = statusResult.data?.insightsWorkflowStatus.running ?? false;
  useEffect(() => {
    if (backendRunning && !mutationResult.fetching && !reconnecting) {
      setReconnecting(true);
      reconnectStartedAt.current = statusResult.data?.insightsWorkflowStatus.startedAt ?? null;
    }
  }, [backendRunning, mutationResult.fetching, reconnecting, statusResult.data]);

  const loading = mutationResult.fetching || reconnecting;
  const error = mutationResult.error;

  // Subscribe to real-time workflow progress while processing.
  // The handler accumulates events into an array so WorkflowDiagram
  // can derive its state during render without effects or refs.
  const [progressResult] = useSubscription<
    OnWorkflowProgressSubscriptionResult,
    WorkflowProgressEvent[],
    OnWorkflowProgressVariables
  >(
    {
      query: ON_WORKFLOW_PROGRESS_SUBSCRIPTION,
      variables: { workflowId: 'process-insights' },
      pause: !loading,
    },
    (prev = [], data) => [...prev, data.onWorkflowProgress],
  );

  const progressEvents = progressResult.data ?? [];
  const lastEvent = progressEvents[progressEvents.length - 1];

  // Handle workflow completion via effect (keep subscription reducer pure)
  useEffect(() => {
    if (lastEvent?.stage === 'complete' || lastEvent?.stage === 'error') {
      setReconnecting(false);
      reexecuteQuery({ requestPolicy: 'network-only' });
      reexecuteStatusQuery({ requestPolicy: 'network-only' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reexecuteQuery/reexecuteStatusQuery are stable
  }, [lastEvent?.stage]);

  const handleProcess = async () => {
    setReconnecting(false);
    await processInsights({});
    // reexecuteQuery is triggered by the subscription 'complete' event
  };

  const report = mutationResult.data?.processInsights ?? queryResult.data?.latestInsightReport ?? null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between px-6 pt-6 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Insights</h1>
          {report && (
            <p className="mt-1 text-sm text-text-muted">
              {new Date(report.createdAt).toLocaleString()} · {(report.durationMs / 1000).toFixed(1)}s
            </p>
          )}
        </div>
        <Button size="lg" onClick={handleProcess} loading={loading}>
          {loading ? 'Processing...' : 'Process Insights'}
        </Button>
      </header>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {loading && <WorkflowDiagram events={progressEvents} />}

        {/* Error display */}
        {!loading && error && (
          <Card className="p-5 mb-6 border border-error/30 bg-error/5">
            <div className="flex items-start gap-3">
              <svg
                className="h-5 w-5 text-error flex-shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-error">Processing failed</p>
                <p className="mt-1 text-sm text-text-secondary break-words">{error.message}</p>
              </div>
              <Button size="sm" onClick={handleProcess}>
                Retry
              </Button>
            </div>
          </Card>
        )}

        {!loading && !report && !error && !queryResult.fetching && (
          <div className="flex flex-col items-center justify-center gap-4 py-24">
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
            <p className="text-base text-text-muted">No insights yet. Click "Process Insights" to run analysis.</p>
          </div>
        )}

        {report && <InsightReportView report={report} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report view
// ---------------------------------------------------------------------------

function InsightReportView({ report }: { report: InsightReport }) {
  return (
    <div className="space-y-6">
      {/* Health + Confidence row */}
      <div className="grid grid-cols-2 gap-5">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text-secondary">Portfolio Health</h3>
            <Badge variant={healthVariant[report.portfolio.overallHealth]} size="md">
              {report.portfolio.overallHealth}
            </Badge>
          </div>
          <p className="text-sm text-text-primary leading-relaxed">{report.portfolio.summary}</p>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-text-secondary mb-4">Agent Confidence</h3>
          <div className="space-y-4">
            <ConfidenceBar label="Confidence" value={report.emotionState.confidence} />
            <ConfidenceBar label="Risk Appetite" value={report.emotionState.riskAppetite} />
          </div>
          <p className="mt-4 text-sm text-text-muted leading-relaxed">{report.emotionState.reason}</p>
        </Card>
      </div>

      {/* Action Items */}
      {report.portfolio.actionItems.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-text-secondary mb-3">Action Items</h3>
          <ul className="space-y-2">
            {report.portfolio.actionItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-text-primary">
                <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-accent-primary" />
                {item.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Positions */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-text-primary">Positions</h2>
        <div className="space-y-2">
          {report.positions.map((pos) => (
            <PositionInsightCard key={pos.symbol} position={pos} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Position insight card
// ---------------------------------------------------------------------------

function PositionInsightCard({ position }: { position: PositionInsight }) {
  const [expanded, setExpanded] = useState(false);

  // Group signals by impact
  const positiveSignals = position.keySignals.filter((s) => s.impact === 'POSITIVE');
  const negativeSignals = position.keySignals.filter((s) => s.impact === 'NEGATIVE');
  const neutralSignals = position.keySignals.filter((s) => s.impact !== 'POSITIVE' && s.impact !== 'NEGATIVE');

  return (
    <Card className="p-5">
      <button
        type="button"
        className="flex w-full items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-text-primary">{position.symbol}</span>
          <Badge variant={ratingVariant[position.rating]} size="md">
            {ratingLabel[position.rating]}
          </Badge>
          <span className="text-sm text-text-muted">{position.name}</span>
        </div>
        <div className="flex items-center gap-4">
          {/* Signal count indicator */}
          {position.keySignals.length > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-bg-tertiary">
              <svg
                className="h-3 w-3 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546"
                />
              </svg>
              <span className="text-xs text-text-muted">{position.keySignals.length}</span>
              {/* Mini impact dots */}
              {positiveSignals.length > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-success" title={`${positiveSignals.length} positive`} />
              )}
              {negativeSignals.length > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-error" title={`${negativeSignals.length} negative`} />
              )}
            </div>
          )}
          <ConvictionMeter value={position.conviction} />
          {position.priceTarget != null && (
            <span className="text-sm text-text-muted">Target: ${position.priceTarget}</span>
          )}
          <svg
            className={cn('h-5 w-5 text-text-muted transition-transform', expanded && 'rotate-180')}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="mt-4 border-t border-border pt-4 space-y-4">
          <p className="text-sm text-text-secondary leading-relaxed">{position.thesis}</p>

          {/* Key Signals — grouped by impact */}
          {position.keySignals.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Key Signals</h4>
                <Link
                  to={`/signals?search=${encodeURIComponent(position.name || position.symbol)}`}
                  className="text-xs font-medium text-accent-primary hover:underline flex items-center gap-1"
                >
                  View all {position.symbol} signals
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
              </div>

              {/* Positive signals */}
              {positiveSignals.length > 0 && <SignalGroup signals={positiveSignals} impact="POSITIVE" />}

              {/* Negative signals */}
              {negativeSignals.length > 0 && <SignalGroup signals={negativeSignals} impact="NEGATIVE" />}

              {/* Neutral signals */}
              {neutralSignals.length > 0 && <SignalGroup signals={neutralSignals} impact="NEUTRAL" />}
            </div>
          )}

          <div className="grid grid-cols-2 gap-6">
            {position.risks.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Risks</h4>
                <ul className="space-y-1.5">
                  {position.risks.map((risk) => (
                    <li key={risk} className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-error" />
                      {risk}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {position.opportunities.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Opportunities</h4>
                <ul className="space-y-1.5">
                  {position.opportunities.map((opp) => (
                    <li key={opp} className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-success" />
                      {opp}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {position.memoryContext && <p className="text-sm italic text-text-muted">{position.memoryContext}</p>}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Signal group (positive / negative / neutral)
// ---------------------------------------------------------------------------

function SignalGroup({ signals, impact }: { signals: SignalSummary[]; impact: string }) {
  const config: Record<string, { icon: string; color: string; borderColor: string; bgColor: string; label: string }> = {
    POSITIVE: {
      icon: '↑',
      color: 'text-success',
      borderColor: 'border-success/20',
      bgColor: 'bg-success/5',
      label: 'Bullish',
    },
    NEGATIVE: {
      icon: '↓',
      color: 'text-error',
      borderColor: 'border-error/20',
      bgColor: 'bg-error/5',
      label: 'Bearish',
    },
    NEUTRAL: {
      icon: '→',
      color: 'text-text-muted',
      borderColor: 'border-border',
      bgColor: 'bg-bg-secondary',
      label: 'Neutral',
    },
  };
  const c = config[impact] ?? config.NEUTRAL;

  return (
    <div className={cn('rounded-lg border p-3', c.borderColor, c.bgColor)}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className={cn('text-sm font-bold', c.color)}>{c.icon}</span>
        <span className={cn('text-xs font-semibold', c.color)}>{c.label}</span>
        <span className="text-xs text-text-muted">({signals.length})</span>
      </div>
      <div className="space-y-1.5">
        {signals.map((signal) => (
          <Link
            key={signal.signalId}
            to={`/signals?highlight=${encodeURIComponent(signal.signalId)}`}
            className="flex items-center gap-2 group"
          >
            <Badge variant={signalTypeVariant[signal.type] ?? 'neutral'} size="xs">
              {signal.type}
            </Badge>
            <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors flex-1 min-w-0 truncate">
              {signal.title}
            </span>
            <SignalConfidenceDot confidence={signal.confidence} />
            <svg
              className="h-3 w-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SignalConfidenceDot({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  return (
    <span
      className={cn(
        'text-2xs font-medium flex-shrink-0',
        pct >= 80 ? 'text-success' : pct >= 50 ? 'text-warning' : 'text-text-muted',
      )}
      title={`${pct}% confidence`}
    >
      {pct}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Confidence / conviction meters
// ---------------------------------------------------------------------------

function ConfidenceBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-text-secondary">{label}</span>
        <span className="text-sm font-semibold text-text-primary">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-bg-tertiary">
        <div
          className={cn(
            'h-2 rounded-full transition-all',
            pct >= 70 ? 'bg-success' : pct >= 40 ? 'bg-warning' : 'bg-error',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ConvictionMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-text-muted">Conviction</span>
      <span
        className={cn('text-sm font-semibold', pct >= 70 ? 'text-success' : pct >= 40 ? 'text-warning' : 'text-error')}
      >
        {pct}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-Agent Workflow Diagram
// ---------------------------------------------------------------------------

const STAGE_TIMING_SEC = [0, 5, 15]; // fallback simulated stage transitions

function WorkflowDiagram({ events }: { events: WorkflowProgressEvent[] }) {
  const [elapsed, setElapsed] = useState(0);

  // Timer for elapsed counter (setState in interval callback is fine)
  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Derive all diagram state from the accumulated events array during render
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
    // Fallback: simulated timing when no real events arrive
    if (elapsed >= STAGE_TIMING_SEC[2]) activeStage = 2;
    else if (elapsed >= STAGE_TIMING_SEC[1]) activeStage = 1;
  }

  // Show last N activities (most recent at bottom)
  const MAX_VISIBLE_ACTIVITIES = 6;
  const visibleActivities = activities.slice(-MAX_VISIBLE_ACTIVITIES);

  return (
    <div className="py-8">
      <Card className="p-6">
        <h3 className="text-sm font-semibold text-text-secondary mb-6 text-center">Multi-Agent Pipeline</h3>

        {/* Horizontal pipeline */}
        <div className="flex items-start gap-0">
          {PIPELINE_STAGES.map((stage, i) => {
            const isDone = hasRealEvents ? completedStages.has(i) : i < activeStage;
            const status = isDone ? 'done' : i === activeStage ? 'active' : 'pending';
            return (
              <div key={stage.title} className="flex items-start flex-1 min-w-0">
                {/* Stage node */}
                <div className="flex flex-col items-center flex-1 min-w-0">
                  {/* Circle + connector row */}
                  <div className="flex items-center w-full">
                    {/* Left connector */}
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
                        {status === 'active' && (
                          <div
                            className="absolute inset-0 rounded-full h-0.5"
                            style={{
                              background: 'linear-gradient(90deg, transparent, rgba(255,90,94,0.6), transparent)',
                              backgroundSize: '200% 100%',
                              animation: 'pipeline-data-flow 2s linear infinite',
                            }}
                          />
                        )}
                      </div>
                    )}

                    {/* Circle */}
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

                    {/* Right connector */}
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

                  {/* Stage details */}
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

        {/* Workflow error */}
        {workflowError && (
          <div className="mt-4 p-3 rounded-lg bg-error/10 border border-error/20">
            <p className="text-sm text-error">{workflowError}</p>
          </div>
        )}

        {/* Live activity feed */}
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

        {/* Elapsed time + live indicator */}
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
    </div>
  );
}

function StageIcon({ index, active }: { index: number; active: boolean }) {
  const cls = cn('w-5 h-5', active ? 'text-white' : 'text-text-muted');
  if (index === 0) {
    // Magnifying glass — data gathering
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
    // Two bars — parallel analysis
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
  // Brain — synthesis
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
