import { useState } from 'react';
import { cn } from '../../lib/utils';
import { timeScales, type TimeScale } from '../../data/mocks/performance';
import { DashboardCard } from '../common/dashboard-card';
import { TotalValueGraph } from './total-value-graph';
import { PerformanceOvertime } from './performance-overtime';

export function PortfolioOverview() {
  const [scale, setScale] = useState<TimeScale>('7D');

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

  return (
    <DashboardCard title="Total Value" headerAction={timeScaleButtons} className="min-h-[120px] flex-1">
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Total Value */}
        <div className="min-h-0 flex-[3] border-b border-border px-3 pb-1">
          <TotalValueGraph scale={scale} />
        </div>

        {/* Performance Over Time */}
        <div className="flex min-h-0 flex-[2] flex-col">
          <span className="px-4 pt-2 text-2xs font-medium uppercase tracking-wider text-text-muted">P&L</span>
          <div className="min-h-0 flex-1 px-3 pb-1">
            <PerformanceOvertime scale={scale} />
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}
