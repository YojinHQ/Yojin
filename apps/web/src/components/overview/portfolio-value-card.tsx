import { cn } from '../../lib/utils';
import { useFeatureStatus } from '../../lib/feature-status';
import { usePortfolio } from '../../api';
import { CardEmptyState } from '../common/card-empty-state';
import { CardBlurGate } from '../common/card-blur-gate';
import { FeatureCardGate } from '../common/feature-gate';
import Spinner from '../common/spinner';
import Button from '../common/button';
import { DashboardCard } from '../common/dashboard-card';
import { useAddPositionModal } from '../../lib/add-position-modal-context';

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
  const { openModal } = useAddPositionModal();

  if (!jintelConfigured) {
    return (
      <DashboardCard title="Portfolio Value">
        <CardBlurGate mockContent={<MockPortfolioValue />}>
          <FeatureCardGate requires="jintel" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  if (fetching) {
    return (
      <DashboardCard title="Portfolio Value">
        <div className="flex flex-1 items-center justify-center px-4 pb-4">
          <Spinner size="md" label="Fetching portfolio…" />
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
  const positionList = positions ?? [];

  if (positionList.length === 0) {
    return (
      <DashboardCard title="Portfolio Value">
        <CardBlurGate mockContent={<MockPortfolioValue />}>
          <CardEmptyState
            icon={
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
            }
            title="No portfolio data"
            description="Import positions to track your portfolio value."
            action={
              <Button variant="primary" size="sm" onClick={openModal}>
                Add position
              </Button>
            }
          />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  // Sum per-position dayChange for actual daily change (not all-time unrealized PnL)
  const change = positionList.reduce((sum, p) => sum + (p.dayChange ?? 0), 0 as number);
  const dayChangePercent = totalValue > 0 ? Math.round((change / (totalValue - change)) * 10000) / 100 : 0;

  const isPositive = change > 0;
  const isNeutral = change === 0;

  return (
    <DashboardCard title="Portfolio Value">
      <div className="px-4 pb-4 pt-2">
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

function MockPortfolioValue() {
  return (
    <div className="px-4 pb-4 pt-2">
      <p className="text-3xl font-bold text-text-primary">$127,450.32</p>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-success">
        <span className="text-2xs">▲</span>
        <span className="font-medium">+$1,234.56</span>
        <span className="font-medium">+0.98%</span>
        <span className="text-text-muted">today</span>
      </div>
    </div>
  );
}
