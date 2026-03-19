import { cn } from '../../lib/utils';
import { usePortfolio } from '../../api';
import Spinner from '../common/spinner';

function formatCurrency(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return n < 0 ? `-${formatted}` : formatted;
}

function formatPercent(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export default function PortfolioStats() {
  const [{ data, fetching, error }] = usePortfolio();

  if (fetching) {
    return (
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-center rounded-xl border border-border bg-bg-card p-4">
            <Spinner size="sm" />
          </div>
        ))}
      </div>
    );
  }

  const portfolio = data?.portfolio;

  const stats = [
    { label: 'Total Positions', value: String(portfolio?.positions.length ?? 0) },
    {
      label: 'Total Value',
      value: portfolio ? formatCurrency(portfolio.totalValue) : 'N/A',
    },
    {
      label: 'Unrealized P&L',
      value: portfolio ? formatCurrency(portfolio.totalPnl) : 'N/A',
      change: portfolio ? formatPercent(portfolio.totalPnlPercent) : null,
      positive: portfolio ? portfolio.totalPnl >= 0 : undefined,
    },
  ];

  if (error) {
    return (
      <div className="grid grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-bg-card p-4">
            <p className="text-xs uppercase tracking-wider text-text-muted">{stat.label}</p>
            <p className="mt-1.5 text-lg font-semibold text-text-muted">N/A</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted">{stat.label}</p>
          <p className="mt-1.5 text-lg font-semibold text-text-primary">{stat.value}</p>
          {'change' in stat && stat.change && (
            <p className={cn('text-xs', stat.positive ? 'text-success' : 'text-error')}>{stat.change}</p>
          )}
        </div>
      ))}
    </div>
  );
}
