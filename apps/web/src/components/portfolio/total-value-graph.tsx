import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { tooltipStyle } from '../../lib/mock-chart-data';
import { usePortfolioHistory } from '../../api';
import Spinner from '../common/spinner';
import type { TimeScale } from '../../data/mocks/performance';

interface TotalValueGraphProps {
  scale: TimeScale;
}

const SCALE_DAYS: Record<TimeScale, number> = {
  '7D': 7,
  '1M': 30,
  '3M': 90,
  YTD: Infinity,
};

function getScaleDays(scale: TimeScale): number {
  if (scale === 'YTD') {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    return Math.ceil((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  }
  return SCALE_DAYS[scale];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts tooltip payload type
function ValueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.[0]) return null;
  const value = payload[0].value as number;
  const formatted = `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  return (
    <div style={tooltipStyle}>
      <p style={{ margin: 0, padding: '4px 8px' }}>
        <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
        {' · '}
        <span style={{ fontWeight: 600 }}>{formatted}</span>
      </p>
    </div>
  );
}

function ensureMinPoints(points: { date: string; value: number }[]): { date: string; value: number }[] {
  if (points.length >= 2) return points;
  if (points.length === 0) return [];
  const only = points[0];
  return [{ date: '', value: only.value }, only];
}

export function TotalValueGraph({ scale }: TotalValueGraphProps) {
  const [{ data, fetching, error }] = usePortfolioHistory();

  const chartData = useMemo(() => {
    const history = data?.portfolioHistory ?? [];
    if (history.length === 0) return [];

    const days = getScaleDays(scale);
    const latest = new Date(history[history.length - 1].timestamp).getTime();
    const cutoff = latest - days * 24 * 60 * 60 * 1000;
    const filtered = history.filter((p) => new Date(p.timestamp).getTime() >= cutoff);

    const mapped = filtered.map((p) => ({
      date: new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: p.totalValue,
    }));

    return ensureMinPoints(mapped);
  }, [data?.portfolioHistory, scale]);

  const baselineValue = chartData[0]?.value ?? 0;

  if (fetching) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="sm" />
      </div>
    );
  }

  if (error || chartData.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <p className="text-xs text-text-muted">No history available</p>
        <p className="mt-0.5 text-2xs text-text-muted/60">Import portfolio snapshots to see value over time</p>
      </div>
    );
  }

  const values = chartData.map((d) => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const pad = Math.max(5, (maxVal - minVal) * 0.1 || maxVal * 0.1);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <defs>
          <linearGradient id="totalValueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-primary)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--color-accent-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" hide />
        <YAxis hide domain={[Math.max(0, minVal - pad), maxVal + pad]} />
        <ReferenceLine y={baselineValue} stroke="var(--color-text-muted)" strokeDasharray="4 4" strokeOpacity={0.6} />
        <Tooltip content={<ValueTooltip />} />
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
  );
}
