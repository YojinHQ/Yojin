import type { PortfolioSnapshot } from '../../api/types';
import { cn } from '../../lib/utils';

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface PortfolioStatsProps {
  portfolio: PortfolioSnapshot | null;
}

export default function PortfolioStats({ portfolio }: PortfolioStatsProps) {
  const stats = [
    { label: 'Total Positions', value: portfolio ? String(portfolio.positions.length) : '--' },
    {
      label: 'Total Value',
      value: portfolio ? formatCurrency(portfolio.totalValue) : '--',
    },
    {
      label: 'Total P&L',
      value: portfolio ? formatCurrency(portfolio.totalPnl) : '--',
      colorClass: portfolio ? (portfolio.totalPnl >= 0 ? 'text-success' : 'text-error') : undefined,
      sub:
        portfolio && portfolio.totalCost > 0
          ? `${portfolio.totalPnlPercent >= 0 ? '+' : ''}${portfolio.totalPnlPercent.toFixed(2)}%`
          : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted">{stat.label}</p>
          <p className={cn('mt-1.5 text-lg font-semibold text-text-primary', stat.colorClass)}>
            {stat.value}
            {stat.sub && <span className="ml-2 text-xs">{stat.sub}</span>}
          </p>
        </div>
      ))}
    </div>
  );
}
