import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { tooltipStyle } from '../../lib/mock-chart-data';
import { usePositions } from '../../api';
import Spinner from '../common/spinner';

const ASSET_CLASS_COLORS: Record<string, string> = {
  EQUITY: 'var(--color-accent-primary)',
  CRYPTO: 'var(--color-accent-secondary)',
  BOND: 'var(--color-success)',
  COMMODITY: 'var(--color-warning)',
  CURRENCY: 'var(--color-info)',
  OTHER: 'var(--color-text-muted)',
};

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function AllocationChart() {
  const [{ data, fetching, error }] = usePositions();

  const allocation = useMemo(() => {
    const positions = data?.positions ?? [];
    if (positions.length === 0) return [];

    const totals: Record<string, number> = {};
    for (const pos of positions) {
      totals[pos.assetClass] = (totals[pos.assetClass] ?? 0) + pos.marketValue;
    }

    const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
    return Object.entries(totals)
      .map(([assetClass, value]) => ({
        name: assetClass.charAt(0) + assetClass.slice(1).toLowerCase(),
        value,
        percent: grandTotal > 0 ? (value / grandTotal) * 100 : 0,
        color: ASSET_CLASS_COLORS[assetClass] ?? ASSET_CLASS_COLORS.OTHER,
      }))
      .sort((a, b) => b.value - a.value);
  }, [data?.positions]);

  if (fetching) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border bg-bg-card">
        <Spinner size="sm" />
      </div>
    );
  }

  if (error || allocation.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border border-border bg-bg-card p-3">
        <h3 className="text-2xs font-medium text-text-primary uppercase tracking-wider mb-4">Asset Allocation</h3>
        <p className="text-xs text-text-muted">No portfolio data available</p>
        <p className="mt-0.5 text-2xs text-text-muted/60">Import a portfolio to see allocation</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg-card p-3">
      <div className="mb-1.5 flex flex-shrink-0 items-center justify-between">
        <h3 className="text-2xs font-medium text-text-primary uppercase tracking-wider">Asset Allocation</h3>
        <div className="flex gap-2">
          {allocation.map((a) => (
            <div key={a.name} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: a.color }} />
              <span className="text-2xs text-text-muted">{a.name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-4">
        <div className="h-full w-1/2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={allocation}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={2}
                strokeWidth={0}
              >
                {allocation.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts Formatter type is overly strict */}
              <Tooltip contentStyle={tooltipStyle} formatter={((value: number) => [formatCurrency(value)]) as any} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          {allocation.map((a) => (
            <div key={a.name} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: a.color }} />
                <span className="text-xs text-text-secondary">{a.name}</span>
              </div>
              <span className="text-xs font-medium text-text-primary">{a.percent.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
