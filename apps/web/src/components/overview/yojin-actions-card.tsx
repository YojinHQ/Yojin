import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from 'urql';

import { LATEST_INSIGHT_REPORT_QUERY } from '../../api/documents';
import type { LatestInsightReportQueryResult } from '../../api/types';
import { cn } from '../../lib/utils';
import { DashboardCard } from '../common/dashboard-card';

function getPriority(text: string): { label: string; style: string } {
  if (text.startsWith('CRITICAL:')) return { label: 'CRITICAL', style: 'bg-error/15 text-error' };
  if (text.startsWith('HIGH:')) return { label: 'HIGH', style: 'bg-warning/15 text-warning' };
  if (text.startsWith('MEDIUM:')) return { label: 'MEDIUM', style: 'bg-info/15 text-info' };
  return { label: 'ACTION', style: 'bg-accent-primary/15 text-accent-primary' };
}

function stripPrefix(text: string): string {
  return text.replace(/^(CRITICAL|HIGH|MEDIUM|LOW):\s*/i, '');
}

function SignalChips({
  signalIds,
  signalMap,
  navigate,
}: {
  signalIds: string[];
  signalMap: Map<string, { title: string; url: string | null }>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  if (signalIds.length === 0) return null;
  const resolved = signalIds.map((id) => ({ id, ...signalMap.get(id) })).filter((s) => s.title);
  if (resolved.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {resolved.map((sig) => (
        <a
          key={sig.id}
          href={sig.url ?? `/signals?highlight=${sig.id}`}
          target={sig.url ? '_blank' : undefined}
          rel={sig.url ? 'noopener noreferrer' : undefined}
          onClick={(e) => {
            if (!sig.url) {
              e.preventDefault();
              navigate(`/signals?highlight=${sig.id}`);
            }
          }}
          className="inline-flex items-center gap-1 rounded bg-bg-secondary px-1.5 py-0.5 text-[11px] text-accent-primary transition-colors hover:bg-accent-primary/10"
          title={sig.title}
        >
          <svg
            className="h-2.5 w-2.5 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
            />
          </svg>
          <span className="max-w-[120px] truncate">{sig.title}</span>
        </a>
      ))}
    </div>
  );
}

export default function YojinActionsCard() {
  const [result] = useQuery<LatestInsightReportQueryResult>({ query: LATEST_INSIGHT_REPORT_QUERY });
  const report = result.data?.latestInsightReport;
  const navigate = useNavigate();

  // Build signalId → { title, url } lookup from all position keySignals
  const signalMap = useMemo(() => {
    const map = new Map<string, { title: string; url: string | null }>();
    if (!report) return map;
    for (const pos of report.positions) {
      for (const sig of pos.keySignals ?? []) {
        map.set(sig.signalId, { title: sig.title, url: sig.url });
      }
    }
    return map;
  }, [report]);

  if (!report) {
    return (
      <DashboardCard title="Action Items" variant="feature" className="flex-1">
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <p className="text-base text-text-secondary">No insights yet.</p>
        </div>
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
