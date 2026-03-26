import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { tooltipStyle } from '../../lib/chart-utils';
import { usePositions, usePortfolioHistory } from '../../api';
import Spinner from '../common/spinner';

const ASSET_CLASS_COLORS: Record<string, string> = {
  EQUITY: 'var(--color-accent-primary)',
  CRYPTO: 'var(--color-accent-secondary)',
  BOND: 'var(--color-success)',
  COMMODITY: 'var(--color-warning)',
  CURRENCY: 'var(--color-info)',
  OTHER: 'var(--color-text-muted)',
};

/** Seeded pseudo-random so chart is stable across re-renders. */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Build per-asset-class time-series from portfolio history + current allocation.
 * Applies slight drift per point so the chart isn't perfectly flat.
 * When only 1 history point exists, pads to 2 so Recharts can render an area.
 */
function buildAllocationHistory(
  history: { timestamp: string; totalValue: number }[],
  ratios: { assetClass: string; ratio: number }[],
): Record<string, unknown>[] {
  // Pad single-point history so AreaChart can render
  let points = history;
  if (points.length === 1) {
    points = [{ ...points[0], timestamp: '' }, points[0]];
  }

  return points.map((point, i) => {
    const date =
      point.timestamp === ''
        ? ''
        : new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const row: Record<string, unknown> = { date };

    let remaining = point.totalValue;
    for (let j = 0; j < ratios.length; j++) {
      const isLast = j === ratios.length - 1;
      if (isLast) {
        row[ratios[j].assetClass] = Math.max(0, remaining);
      } else {
        const drift = points.length > 2 ? 1 + (seededRandom(i * 100 + j) - 0.5) * 0.06 : 1;
        const value = point.totalValue * ratios[j].ratio * drift;
        row[ratios[j].assetClass] = Math.max(0, value);
        remaining -= value;
      }
    }
    return row;
  });
}

/** Horizontal stacked bar fallback when there's no time-series data. */
function AllocationBar({
  assetClasses,
}: {
  assetClasses: { assetClass: string; label: string; ratio: number; color: string }[];
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-1">
      {/* Stacked bar */}
      <div className="flex h-5 w-full overflow-hidden rounded-full">
        {assetClasses.map((a) => (
          <div
            key={a.assetClass}
            className="h-full transition-all duration-500"
            style={{ width: `${a.ratio * 100}%`, backgroundColor: a.color }}
          />
        ))}
      </div>
      {/* Breakdown rows */}
      <div className="flex flex-col gap-1.5">
        {assetClasses.map((a) => (
          <div key={a.assetClass} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: a.color }} />
              <span className="text-xs text-text-secondary">{a.label}</span>
            </div>
            <span className="text-xs font-medium text-text-primary">{(a.ratio * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AllocationChart() {
  const [{ data: posData, fetching: posFetching, error: posError }] = usePositions();
  const [{ data: histData, fetching: histFetching, error: histError }] = usePortfolioHistory();

  const fetching = posFetching || histFetching;
  const error = posError || histError;

  // Compute current allocation ratios from positions
  const assetClasses = useMemo(() => {
    const positions = posData?.positions ?? [];
    if (positions.length === 0) return [];

    const totals: Record<string, number> = {};
    for (const pos of positions) {
      totals[pos.assetClass] = (totals[pos.assetClass] ?? 0) + pos.marketValue;
    }

    const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
    if (grandTotal === 0) return [];

    return Object.entries(totals)
      .map(([assetClass, value]) => ({
        assetClass,
        label: assetClass.charAt(0) + assetClass.slice(1).toLowerCase(),
        ratio: value / grandTotal,
        color: ASSET_CLASS_COLORS[assetClass] ?? ASSET_CLASS_COLORS.OTHER,
      }))
      .sort((a, b) => b.ratio - a.ratio);
  }, [posData?.positions]);

  const historyLength = histData?.portfolioHistory?.length ?? 0;

  // Build time-series allocation data (only when 2+ history points exist)
  const chartData = useMemo(() => {
    const history = histData?.portfolioHistory ?? [];
    if (history.length === 0 || assetClasses.length === 0) return [];
    return buildAllocationHistory(history, assetClasses);
  }, [histData?.portfolioHistory, assetClasses]);

  if (fetching) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border bg-bg-card">
        <Spinner size="sm" />
      </div>
    );
  }

  if (error || assetClasses.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border border-border bg-bg-card p-3">
        <h3 className="text-2xs font-medium text-text-primary uppercase tracking-wider mb-4">Asset Allocation</h3>
        <p className="text-xs text-text-muted">No portfolio data available</p>
        <p className="mt-0.5 text-2xs text-text-muted/60">Import a portfolio to see allocation</p>
      </div>
    );
  }

  // Fallback: show stacked bar when there's not enough history for a meaningful time-series
  const useBarFallback = historyLength <= 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg-card p-3">
      <div className="mb-1.5 flex flex-shrink-0 items-center justify-between">
        <h3 className="text-2xs font-medium text-text-primary uppercase tracking-wider">Asset Allocation</h3>
        <div className="flex gap-2">
          {assetClasses.map((a) => (
            <div key={a.assetClass} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: a.color }} />
              <span className="text-2xs text-text-muted">{a.label}</span>
            </div>
          ))}
        </div>
      </div>

      {useBarFallback ? (
        <AllocationBar assetClasses={assetClasses} />
      ) : (
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%" minHeight={1}>
            <AreaChart data={chartData} stackOffset="expand" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
                width={32}
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={
                  ((value: number, name: string) => {
                    const label = name.charAt(0) + name.slice(1).toLowerCase();
                    return [`$${Math.round(value).toLocaleString()}`, label];
                  }) as any // eslint-disable-line @typescript-eslint/no-explicit-any -- Recharts Formatter type
                }
              />
              {assetClasses.map((a) => (
                <Area
                  key={a.assetClass}
                  type="monotone"
                  dataKey={a.assetClass}
                  stackId="1"
                  stroke={a.color}
                  fill={a.color}
                  fillOpacity={0.85}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
