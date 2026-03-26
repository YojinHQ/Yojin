import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { tooltipStyle } from '../../lib/chart-utils';
import { getScaleDays, type TimeScale } from '../../lib/time-scales';
import type { PortfolioHistoryPoint } from '../../api/types';

const GREEN = '#4ade80';
const RED = '#f87171';

interface PnlDataPoint {
  date: string;
  pnl: number;
}

interface PerformanceOvertimeProps {
  scale: TimeScale;
  history: PortfolioHistoryPoint[];
}

/** Format a Date to "Mon DD" locale string. */
function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Derive daily P&L from portfolio history snapshots.
 *
 * Builds a lookup of snapshot totalValue by date (YYYY-MM-DD), then walks
 * every calendar day in the time-scale window. Each day's P&L is the delta
 * from the previous known snapshot value. Days without snapshot changes
 * get pnl = 0, which keeps the BarChart populated with enough data points
 * for stable tooltip behaviour.
 */
function derivePnlFromHistory(history: PortfolioHistoryPoint[], scale: TimeScale): PnlDataPoint[] {
  if (history.length < 2) return [];

  const days = getScaleDays(scale);
  const latestTs = new Date(history[history.length - 1].timestamp);
  const cutoff = new Date(latestTs.getTime() - days * 24 * 60 * 60 * 1000);

  // Build date → totalValue map (latest snapshot per day wins)
  const valueByDay = new Map<string, number>();
  for (const h of history) {
    const day = h.timestamp.slice(0, 10);
    valueByDay.set(day, h.totalValue);
  }

  // Walk every calendar day from cutoff to latest
  const points: PnlDataPoint[] = [];
  const cursor = new Date(cutoff);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(latestTs);
  end.setHours(23, 59, 59, 999);

  let prevValue: number | undefined;

  // Find the most recent snapshot value at or before cutoff for the starting baseline
  for (const h of history) {
    const t = new Date(h.timestamp);
    if (t <= cutoff) {
      prevValue = h.totalValue;
    }
  }

  while (cursor <= end) {
    const dayKey = cursor.toISOString().slice(0, 10);
    const value = valueByDay.get(dayKey);

    if (value !== undefined) {
      const pnl = prevValue !== undefined ? Math.round((value - prevValue) * 100) / 100 : 0;
      points.push({ date: fmtDate(cursor), pnl });
      prevValue = value;
    } else if (prevValue !== undefined) {
      // No snapshot on this day — zero change
      points.push({ date: fmtDate(cursor), pnl: 0 });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts tooltip payload type
function PnlTooltip({ active, payload, label }: any) {
  if (!active || !payload?.[0]) return null;
  const value = payload[0].value as number;
  if (value === 0) return null;
  const isPositive = value >= 0;
  const formatted = `${isPositive ? '+' : '-'}$${Math.abs(value).toLocaleString('en-US')}`;

  return (
    <div style={tooltipStyle}>
      <p style={{ margin: 0, padding: '4px 8px' }}>
        <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
        {' · '}
        <span style={{ color: isPositive ? GREEN : RED, fontWeight: 600 }}>{formatted}</span>
      </p>
    </div>
  );
}

export function PerformanceOvertime({ scale, history }: PerformanceOvertimeProps) {
  const data = useMemo(() => derivePnlFromHistory(history, scale), [history, scale]);

  if (data.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-2xs text-text-muted/60">No P&L data yet</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={1}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <XAxis dataKey="date" hide />
        <YAxis hide />
        <Tooltip content={<PnlTooltip />} cursor={{ fill: 'var(--color-bg-hover)', opacity: 0.5 }} />
        <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.pnl >= 0 ? GREEN : RED} fillOpacity={entry.pnl === 0 ? 0 : 0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
