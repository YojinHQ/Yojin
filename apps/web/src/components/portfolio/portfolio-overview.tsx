import { useState, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { useFeatureStatus } from '../../lib/feature-status';
import { usePortfolio } from '../../api';
import { CardEmptyState } from '../common/card-empty-state';
import { CardBlurGate } from '../common/card-blur-gate';
import { FeatureCardGate } from '../common/feature-gate';
import Spinner from '../common/spinner';
import Button from '../common/button';
import { useAddPositionModal } from '../../lib/add-position-modal-context';
import { timeScales, getScaleDays, type TimeScale } from '../../lib/time-scales';
import { DashboardCard } from '../common/dashboard-card';
import { TotalValueGraph } from './total-value-graph';
import { PerformanceOvertime } from './performance-overtime';

export function PortfolioOverview() {
  const { jintelConfigured } = useFeatureStatus();
  const { openModal } = useAddPositionModal();
  const [scale, setScale] = useState<TimeScale>('7D');
  const days = useMemo(() => getScaleDays(scale), [scale]);
  const vars = useMemo(() => ({ historyDays: days }), [days]);
  const [{ data: portfolioData, fetching }] = usePortfolio(vars);
  const history = portfolioData?.portfolio?.history ?? [];
  const hasHistory = history.length > 0;

  if (!jintelConfigured) {
    return (
      <DashboardCard title="Total Value" className="min-h-[120px] flex-1">
        <CardBlurGate mockContent={<MockTotalValue />}>
          <FeatureCardGate requires="jintel" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

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
        <CardBlurGate mockContent={<MockTotalValue />}>
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
            description="Import portfolio to see value and P&L over time."
            action={
              <Button variant="primary" size="sm" onClick={openModal}>
                Add position
              </Button>
            }
          />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Total Value" headerAction={timeScaleButtons} className="min-h-[120px] flex-1">
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Total Value */}
        <div className="min-h-0 flex-[3] border-b border-border px-3 pb-1">
          <TotalValueGraph history={history} />
        </div>

        {/* Performance Over Time */}
        <div className="flex min-h-0 flex-[2] flex-col">
          <span className="px-4 pt-2 text-2xs font-medium uppercase tracking-wider text-text-muted">P&L</span>
          <div className="min-h-0 flex-1 px-3 pb-1">
            <PerformanceOvertime history={history} />
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}

/** SVG chart mockup to hint at what the total value graph looks like. */
function MockTotalValue() {
  // Upward-trending mock line chart
  const points = '0,90 20,85 40,80 60,75 80,65 100,70 120,55 140,50 160,45 180,35 200,30 220,25 240,20 260,18 280,15';
  // Mock P&L bars
  const bars = [
    { x: 10, h: 12, up: true },
    { x: 40, h: 8, up: false },
    { x: 70, h: 15, up: true },
    { x: 100, h: 6, up: true },
    { x: 130, h: 10, up: false },
    { x: 160, h: 18, up: true },
    { x: 190, h: 5, up: true },
    { x: 220, h: 14, up: true },
    { x: 250, h: 9, up: false },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Total Value chart area */}
      <div className="min-h-0 flex-[3] border-b border-border px-3 pb-1">
        <svg viewBox="0 0 280 100" className="h-full w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="mock-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-success)" stopOpacity="0.15" />
              <stop offset="100%" stopColor="var(--color-success)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,100 ${points} 280,100`} fill="url(#mock-grad)" />
          <polyline points={points} fill="none" stroke="var(--color-success)" strokeWidth="1.5" />
        </svg>
      </div>

      {/* P&L bar area */}
      <div className="flex min-h-0 flex-[2] flex-col">
        <span className="px-4 pt-2 text-2xs font-medium uppercase tracking-wider text-text-muted">P&L</span>
        <div className="min-h-0 flex-1 px-3 pb-1">
          <svg viewBox="0 0 280 40" className="h-full w-full" preserveAspectRatio="none">
            {bars.map((b, i) => (
              <rect
                key={i}
                x={b.x}
                y={b.up ? 20 - b.h : 20}
                width={18}
                height={b.h}
                rx={2}
                fill={b.up ? 'var(--color-success)' : 'var(--color-error)'}
                opacity={0.5}
              />
            ))}
            <line x1="0" y1="20" x2="280" y2="20" stroke="var(--color-border)" strokeWidth="0.5" />
          </svg>
        </div>
      </div>
    </div>
  );
}
