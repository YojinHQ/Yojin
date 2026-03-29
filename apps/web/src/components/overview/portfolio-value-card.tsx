import { cn } from '../../lib/utils';
import { useFeatureStatus } from '../../lib/feature-status';
import { usePortfolio } from '../../api';
import Spinner from '../common/spinner';

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
  const { jintelConfigured } = useFeatureStatus();
  const [{ data, fetching, error }] = usePortfolio();

  if (!jintelConfigured || error || (!fetching && !data?.portfolio)) {
    return null;
  }

  if (fetching) {
    return (
      <div className="flex h-10 items-center gap-3">
        <Spinner size="sm" />
        <span className="text-sm text-text-muted">Loading portfolio...</span>
      </div>
    );
  }

  const portfolio = data?.portfolio;
  if (!portfolio) return null;
  const { totalValue, positions } = portfolio;
  const positionList = positions ?? [];

  if (positionList.length === 0) return null;

  const change = positionList.reduce((sum, p) => sum + (p.dayChange ?? 0), 0 as number);
  const dayChangePercent = totalValue > 0 ? Math.round((change / (totalValue - change)) * 10000) / 100 : 0;

  const isPositive = change > 0;
  const isNeutral = change === 0;

  return (
    <div className="flex items-baseline gap-4">
      <span className="text-2xl font-bold text-text-primary">{formatCurrency(totalValue)}</span>
      <div
        className={cn(
          'flex items-center gap-1.5 text-sm',
          isNeutral ? 'text-text-muted' : isPositive ? 'text-success' : 'text-error',
        )}
      >
        {!isNeutral && <span className="text-xs">{isPositive ? '\u25B2' : '\u25BC'}</span>}
        <span className="font-medium">{formatChange(change)}</span>
        <span className="font-medium">({formatPercent(dayChangePercent)})</span>
        <span className="text-text-muted">today</span>
      </div>
    </div>
  );
}
