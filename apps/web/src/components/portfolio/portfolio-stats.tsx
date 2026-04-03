import type { PortfolioSnapshot } from '../../api/types';
import { cn } from '../../lib/utils';
import { formatPrice } from '../../lib/format';

function formatPercent(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

interface PortfolioStatsProps {
  portfolio: PortfolioSnapshot | null;
}

export default function PortfolioStats({ portfolio }: PortfolioStatsProps) {
  const stats = [
    {
      label: 'Total Value',
      value: portfolio ? formatPrice(portfolio.totalValue) : '--',
    },
    {
      label: 'Total P&L',
      value: portfolio ? formatPrice(portfolio.totalPnl) : '--',
      change: portfolio && portfolio.totalCost > 0 ? formatPercent(portfolio.totalPnlPercent) : null,
      positive: portfolio ? portfolio.totalPnl >= 0 : undefined,
    },
    { label: 'Total Positions', value: portfolio ? String(portfolio.positions.length) : '--' },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted">{stat.label}</p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <p className={cn('text-lg font-semibold text-text-primary', stat.positive === false && 'text-error')}>
              {stat.value}
            </p>
            {'change' in stat && stat.change && (
              <p className={cn('text-xs', stat.positive ? 'text-success' : 'text-error')}>{stat.change}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
