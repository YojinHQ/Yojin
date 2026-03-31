import { cn } from '../../lib/utils';
import { usePortfolio } from '../../api';
import Spinner from '../common/spinner';

interface StatCard {
  label: string;
  value: string;
  change: string | null;
  positive?: boolean;
}

function formatCurrency(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return n < 0 ? `-${formatted}` : n > 0 ? `+${formatted}` : formatted;
}

function formatPercent(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function buildStats(
  totalValue: number,
  totalCost: number,
  totalPnl: number,
  totalPnlPercent: number,
  positionCount: number,
): StatCard[] {
  return [
    {
      label: 'Total Value',
      value: totalValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
      change: null,
    },
    {
      label: 'Unrealized P&L',
      value: formatCurrency(totalPnl),
      change: formatPercent(totalPnlPercent),
      positive: totalPnl >= 0,
    },
    {
      label: 'Total Return',
      value: formatCurrency(totalPnl),
      change: totalCost > 0 ? formatPercent(totalPnlPercent) : null,
      positive: totalPnl >= 0,
    },
    { label: 'Positions', value: String(positionCount), change: null },
  ];
}

export default function PortfolioValueStrip() {
  const [{ data, fetching, error }] = usePortfolio();

  if (fetching) {
    return (
      <div className="grid flex-shrink-0 grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-center rounded-lg border border-border bg-bg-card px-4 py-5"
          >
            <Spinner size="sm" label="Fetching prices…" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !data?.portfolio) {
    const placeholders: StatCard[] = [
      { label: 'Total Value', value: 'N/A', change: null },
      { label: 'Unrealized P&L', value: 'N/A', change: null },
      { label: 'Total Return', value: 'N/A', change: null },
      { label: 'Positions', value: 'N/A', change: null },
    ];
    return (
      <div className="grid flex-shrink-0 grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {placeholders.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-bg-card px-4 py-3">
            <p className="text-2xs uppercase tracking-wider text-text-secondary">{stat.label}</p>
            <p className="mt-0.5 text-sm font-semibold text-text-muted">{stat.value}</p>
          </div>
        ))}
      </div>
    );
  }

  const { totalValue, totalCost, totalPnl, totalPnlPercent, positions } = data.portfolio;
  const stats = buildStats(totalValue, totalCost, totalPnl, totalPnlPercent, positions.length);

  return (
    <div className="grid flex-shrink-0 grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-lg border border-border bg-bg-card px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-text-secondary">{stat.label}</p>
          <p className="mt-1 text-sm font-semibold text-text-primary">{stat.value}</p>
          {stat.change && (
            <p className={cn('text-2xs', stat.positive ? 'text-success' : 'text-error')}>{stat.change}</p>
          )}
        </div>
      ))}
    </div>
  );
}
