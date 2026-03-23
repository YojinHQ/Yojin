import { cn } from '../../lib/utils';
import { usePortfolio } from '../../api';
import Spinner from '../common/spinner';
import { DashboardCard } from '../common/dashboard-card';

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatChange(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`;
}

function formatPercent(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export default function PortfolioValueCard() {
  const [{ data, fetching, error }] = usePortfolio();

  if (fetching) {
    return (
      <DashboardCard title="Portfolio Value">
        <div className="flex flex-1 items-center justify-center px-4 pb-4">
          <Spinner size="sm" />
        </div>
      </DashboardCard>
    );
  }

  if (error || !data?.portfolio) {
    return (
      <DashboardCard title="Portfolio Value">
        <p className="px-4 pb-4 text-3xl font-bold text-text-muted">N/A</p>
      </DashboardCard>
    );
  }

  const { totalValue, positions } = data.portfolio;

  // Sum per-position dayChange for actual daily change (not all-time unrealized PnL)
  const change = (positions ?? []).reduce((sum: number, p: { dayChange?: number }) => sum + (p.dayChange ?? 0), 0);
  const dayChangePercent = totalValue > 0 ? Math.round((change / (totalValue - change)) * 10000) / 100 : 0;

  const isPositive = change > 0;
  const isNeutral = change === 0;

  return (
    <DashboardCard title="Portfolio Value">
      <div className="px-4 pb-4">
        <p className="text-3xl font-bold text-text-primary">{formatCurrency(totalValue)}</p>
        <div
          className={cn(
            'mt-1.5 flex items-center gap-1.5 text-xs',
            isNeutral ? 'text-text-muted' : isPositive ? 'text-success' : 'text-error',
          )}
        >
          {!isNeutral && <span className="text-2xs">{isPositive ? '\u25B2' : '\u25BC'}</span>}
          <span className="font-medium">{formatChange(change)}</span>
          <span className="font-medium">{formatPercent(dayChangePercent)}</span>
          <span className="text-text-muted">today</span>
        </div>
      </div>
    </DashboardCard>
  );
}
