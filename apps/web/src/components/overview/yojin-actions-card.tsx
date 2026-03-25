import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from 'urql';

import { LATEST_INSIGHT_REPORT_QUERY } from '../../api/documents';
import type { LatestInsightReportQueryResult } from '../../api/types';
import { cn } from '../../lib/utils';
import { CardEmptyState } from '../common/card-empty-state';
import { DashboardCard } from '../common/dashboard-card';
import Spinner from '../common/spinner';
import { SignalChips } from './signal-chips';

function getPriority(text: string): { label: string; style: string } {
  if (text.startsWith('CRITICAL:')) return { label: 'CRITICAL', style: 'bg-error/15 text-error' };
  if (text.startsWith('HIGH:')) return { label: 'HIGH', style: 'bg-warning/15 text-warning' };
  if (text.startsWith('MEDIUM:')) return { label: 'MEDIUM', style: 'bg-info/15 text-info' };
  return { label: 'ACTION', style: 'bg-accent-primary/15 text-accent-primary' };
}

function stripPrefix(text: string): string {
  return text.replace(/^(CRITICAL|HIGH|MEDIUM|LOW):\s*/i, '');
}

export default function YojinActionsCard() {
  const [result] = useQuery<LatestInsightReportQueryResult>({ query: LATEST_INSIGHT_REPORT_QUERY });
  const report = result.data?.latestInsightReport;
  const navigate = useNavigate();

  // Build signalId → { title, url, sourceCount } lookup from all position keySignals
  const signalMap = useMemo(() => {
    const map = new Map<string, { title: string; url: string | null; sourceCount?: number }>();
    if (!report) return map;
    for (const pos of report.positions) {
      for (const sig of pos.keySignals ?? []) {
        map.set(sig.signalId, { title: sig.title, url: sig.url, sourceCount: sig.sourceCount });
      }
    }
    return map;
  }, [report]);

  if (result.fetching) {
    return (
      <DashboardCard title="Action Items" variant="feature" className="flex-1">
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <Spinner size="sm" label="Loading actions…" />
        </div>
      </DashboardCard>
    );
  }

  if (!report) {
    return (
      <DashboardCard title="Action Items" variant="feature" className="flex-1">
        <CardEmptyState
          icon={
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z"
              />
            </svg>
          }
          title="No action items"
          description="Run Process Insights to generate recommendations."
        />
      </DashboardCard>
    );
  }

  const actions = report.portfolio.actionItems;

  return (
    <DashboardCard
      title="Action Items"
      variant="feature"
      className="flex-1"
      headerAction={<span className="text-xs text-text-muted">{actions.length} items</span>}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 pb-5">
        {actions.map((item, i) => {
          const priority = getPriority(item.text);
          return (
            <div key={i}>
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'mt-0.5 flex-shrink-0 rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wider',
                    priority.style,
                  )}
                >
                  {priority.label}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-sm leading-relaxed text-text-secondary">{stripPrefix(item.text)}</span>
                  <SignalChips signalIds={item.signalIds} signalMap={signalMap} navigate={navigate} />
                </div>
              </div>
            </div>
          );
        })}

        {/* Top opportunities */}
        {report.portfolio.topOpportunities.length > 0 && (
          <div className="mt-1 space-y-1.5 border-t border-border pt-3">
            <span className="text-xs font-medium uppercase tracking-wider text-text-muted">Opportunities</span>
            {report.portfolio.topOpportunities.slice(0, 3).map((o, i) => (
              <div key={i}>
                <p className="text-sm leading-relaxed text-success/80">{o.text}</p>
                <SignalChips signalIds={o.signalIds} signalMap={signalMap} navigate={navigate} />
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
