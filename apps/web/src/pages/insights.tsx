import { useEffect, useState } from 'react';
import { useMutation, useQuery, useSubscription } from 'urql';
import { cn } from '../lib/utils';
import {
  LATEST_INSIGHT_REPORT_QUERY,
  ON_WORKFLOW_PROGRESS_SUBSCRIPTION,
  PROCESS_INSIGHTS_MUTATION,
} from '../api/documents';
import type {
  InsightRating,
  InsightReport,
  LatestInsightReportQueryResult,
  OnWorkflowProgressSubscriptionResult,
  OnWorkflowProgressVariables,
  PortfolioHealth,
  PositionInsight,
  ProcessInsightsMutationResult,
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

export default function Insights() {
  const [queryResult, reexecuteQuery] = useQuery<LatestInsightReportQueryResult>({
    query: LATEST_INSIGHT_REPORT_QUERY,
  });

  const [mutationResult, processInsights] = useMutation<ProcessInsightsMutationResult>(PROCESS_INSIGHTS_MUTATION);

  const loading = mutationResult.fetching;
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

  const handleProcess = async () => {
    await processInsights({});
    reexecuteQuery({ requestPolicy: 'network-only' });
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
            {report.portfolio.actionItems.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-text-primary">
                <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-accent-primary" />
                {item}
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

function PositionInsightCard({ position }: { position: PositionInsight }) {
  const [expanded, setExpanded] = useState(false);

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

          {position.keySignals.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {position.keySignals.map((signal) => {
                const variant =
                  signal.impact === 'POSITIVE' ? 'success' : signal.impact === 'NEGATIVE' ? 'error' : 'neutral';
                return signal.url ? (
                  <a
                    key={signal.signalId}
                    href={signal.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center hover:opacity-80 transition-opacity"
                  >
                    <Badge variant={variant as BadgeVariant} size="sm">
                      {signal.title}
                      <svg
                        className="ml-1 h-3 w-3 inline"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                        />
                      </svg>
                    </Badge>
                  </a>
                ) : (
                  <Badge key={signal.signalId} variant={variant as BadgeVariant} size="sm">
                    {signal.title}
                  </Badge>
                );
              })}
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

  if (hasRealEvents) {
    for (const evt of events) {
      if (evt.stage === 'stage_start' && evt.stageIndex != null) {
        activeStage = evt.stageIndex;
      } else if (evt.stage === 'stage_complete' && evt.stageIndex != null) {
        completedStages.add(evt.stageIndex);
      } else if (evt.stage === 'error') {
        workflowError = evt.error ?? 'Unknown error';
      }
    }
  } else {
    // Fallback: simulated timing when no real events arrive
    if (elapsed >= STAGE_TIMING_SEC[2]) activeStage = 2;
    else if (elapsed >= STAGE_TIMING_SEC[1]) activeStage = 1;
  }

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

        {/* Elapsed time + live indicator */}
        <div className="mt-6 flex items-center justify-center gap-3">
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
