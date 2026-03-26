import { useState } from 'react';
import { cn } from '../../lib/utils';
import { usePortfolioHistory } from '../../api';
import { CardEmptyState } from '../common/card-empty-state';
import Spinner from '../common/spinner';
import { timeScales, type TimeScale } from '../../lib/time-scales';
import { DashboardCard } from '../common/dashboard-card';
import { TotalValueGraph } from './total-value-graph';
import { PerformanceOvertime } from './performance-overtime';

export function PortfolioOverview() {
  const [scale, setScale] = useState<TimeScale>('7D');
  const [{ data: historyData, fetching }] = usePortfolioHistory();
  const history = historyData?.portfolioHistory ?? [];
  const hasHistory = history.length > 0;

  const timeScaleButtons = (
    <div className="flex gap-0.5">
      {timeScales.map((s) => (
        <button
          key={s}
          onClick={() => setScale(s)}
          className={cn(
            'cursor-pointer rounded px-1.5 py-px text-2xs font-medium transition-colors',
            scale === s ? 'bg-accent-primary text-white' : 'text-text-muted hover:text-text-secondary',
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );

  if (fetching) {
    return (
      <DashboardCard title="Total Value" className="min-h-[120px] flex-1">
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <Spinner size="md" label="Loading history…" />
        </div>
      </DashboardCard>
    );
  }

  if (!hasHistory) {
    return (
      <DashboardCard title="Total Value" className="min-h-[120px] flex-1">
        <CardEmptyState
          icon={
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605"
              />
            </svg>
          }
          title="No history available"
          description="Import portfolio snapshots to see value and P&L over time."
        />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Total Value" headerAction={timeScaleButtons} className="min-h-[120px] flex-1">
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Total Value */}
        <div className="min-h-0 flex-[3] border-b border-border px-3 pb-1">
          <TotalValueGraph scale={scale} history={history} />
        </div>

        {/* Performance Over Time */}
        <div className="flex min-h-0 flex-[2] flex-col">
          <span className="px-4 pt-2 text-2xs font-medium uppercase tracking-wider text-text-muted">P&L</span>
          <div className="min-h-0 flex-1 px-3 pb-1">
            <PerformanceOvertime scale={scale} history={history} />
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}
