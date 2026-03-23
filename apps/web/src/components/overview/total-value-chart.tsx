import { useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { tooltipStyle, formatValue } from '../../lib/mock-chart-data';
import { usePortfolioHistory } from '../../api';
import Spinner from '../common/spinner';
import { DashboardCard } from '../common/dashboard-card';

const timeRanges = ['1W', '1M', '3M', '1Y', 'ALL'] as const;
type TimeRange = (typeof timeRanges)[number];

const RANGE_DAYS: Record<TimeRange, number> = {
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '1Y': 365,
  ALL: Infinity,
};

/** Format Y-axis values based on magnitude — avoids "$0k" for small portfolios. */
function formatYAxis(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `$${(val / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `$${(val / 1_000).toFixed(1)}k`;
  return `$${val.toFixed(0)}`;
}

/**
 * When only 1 data point exists, pad to 2 so Recharts can render a line.
 * Shifts the synthetic point back by 1 day.
 */
function ensureMinPoints(points: { date: string; value: number }[]): { date: string; value: number }[] {
  if (points.length >= 2) return points;
  if (points.length === 0) return [];
  const only = points[0];
  return [{ date: '', value: only.value }, only];
}

export default function TotalValueChart() {
  const [activeRange, setActiveRange] = useState<TimeRange>('ALL');
  const [{ data, fetching, error }] = usePortfolioHistory();

  const chartData = useMemo(() => {
    const history = data?.portfolioHistory ?? [];
    if (history.length === 0) return [];

    const days = RANGE_DAYS[activeRange];
    let filtered = history;
    if (days !== Infinity) {
      const latest = new Date(history[history.length - 1].timestamp).getTime();
      const cutoff = latest - days * 24 * 60 * 60 * 1000;
      filtered = history.filter((p) => new Date(p.timestamp).getTime() >= cutoff);
    }

    const mapped = filtered.map((p) => ({
      date: new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: p.totalValue,
    }));

    return ensureMinPoints(mapped);
  }, [data?.portfolioHistory, activeRange]);

  const baselineValue = chartData[0]?.value ?? 0;

  const timeRangeButtons = (
    <div className="flex gap-0.5">
      {timeRanges.map((range) => (
        <button
          key={range}
          onClick={() => setActiveRange(range)}
          className={cn(
            'cursor-pointer rounded px-1.5 py-px text-2xs font-medium transition-colors',
            activeRange === range ? 'bg-accent-primary text-white' : 'text-text-muted hover:text-text-secondary',
          )}
        >
          {range}
        </button>
      ))}
    </div>
  );

  if (fetching) {
    return (
      <DashboardCard title="Total Value" headerAction={timeRangeButtons} className="min-h-[120px] flex-1">
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="sm" />
        </div>
      </DashboardCard>
    );
  }

  if (error || chartData.length === 0) {
    return (
      <DashboardCard title="Total Value" className="min-h-[120px] flex-1">
        <div className="flex flex-1 flex-col items-center justify-center">
          <p className="text-xs text-text-muted">No history available</p>
          <p className="mt-0.5 text-2xs text-text-muted/60">Import portfolio snapshots to see value over time</p>
        </div>
      </DashboardCard>
    );
  }

  // Build a sensible Y domain: pad by 10% of value (min $5) so the line isn't at the edge
  const values = chartData.map((d) => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const pad = Math.max(5, (maxVal - minVal) * 0.1 || maxVal * 0.1);

  return (
    <DashboardCard title="Total Value" headerAction={timeRangeButtons} className="min-h-[120px] flex-1">
      <div className="min-h-0 flex-1 px-3 pb-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="totalValueGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent-primary)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--color-accent-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} opacity={0.4} />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
              domain={[Math.max(0, minVal - pad), maxVal + pad]}
              tickFormatter={formatYAxis}
            />
            <ReferenceLine
              y={baselineValue}
              stroke="var(--color-text-muted)"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
            />
            <Tooltip contentStyle={tooltipStyle} formatter={formatValue} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--color-accent-primary)"
              strokeWidth={2}
              fill="url(#totalValueGrad)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </DashboardCard>
  );
}
