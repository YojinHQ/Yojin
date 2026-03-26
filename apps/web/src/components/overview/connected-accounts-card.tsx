import { useMemo, useState } from 'react';
import { usePositions } from '../../api';
import { useOnboardingStatus } from '../../lib/onboarding-context';
import Spinner from '../common/spinner';
import Button from '../common/button';
import { CardEmptyState } from '../common/card-empty-state';
import { DashboardCard } from '../common/dashboard-card';
import AddAccountModal from './add-account-modal';
import { PlatformLogo } from '../platforms/platform-logos';

const PLATFORM_DISPLAY: Record<string, string> = {
  INTERACTIVE_BROKERS: 'IBKR',
  ROBINHOOD: 'Robinhood',
  COINBASE: 'Coinbase',
  BINANCE: 'Binance',
  METAMASK: 'MetaMask',
  WEBULL: 'WeBull',
  SOFI: 'SoFi',
  SCHWAB: 'Schwab',
  FIDELITY: 'Fidelity',
  MOOMOO: 'Moomoo',
  PHANTOM: 'Phantom',
  MANUAL: 'Manual',
};

interface AccountSummary {
  platform: string;
  name: string;
  totalValue: number;
  change: number;
  positionCount: number;
}

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function ConnectedAccountsCard() {
  const [{ data, fetching, error }, reexecuteQuery] = usePositions();
  const [modalOpen, setModalOpen] = useState(false);
  const { openOnboarding, completed: onboardingComplete, skipped: onboardingSkipped } = useOnboardingStatus();

  const accounts = useMemo<AccountSummary[]>(() => {
    const positions = data?.positions ?? [];
    if (positions.length === 0) return [];

    const grouped: Record<string, { totalValue: number; change: number; count: number }> = {};
    for (const pos of positions) {
      const key = pos.platform;
      if (!grouped[key]) grouped[key] = { totalValue: 0, change: 0, count: 0 };
      grouped[key].totalValue += pos.marketValue;
      grouped[key].change += pos.dayChange ?? 0;
      grouped[key].count += 1;
    }

    return Object.entries(grouped)
      .map(([platform, agg]) => ({
        platform,
        name: PLATFORM_DISPLAY[platform] ?? platform,
        totalValue: agg.totalValue,
        change: agg.change,
        positionCount: agg.count,
      }))
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [data?.positions]);

  const connectedPlatformIds = accounts.map((a) => a.platform);

  const handleAddSuccess = () => {
    reexecuteQuery({ requestPolicy: 'network-only' });
  };

  const addButton = (
    <button
      onClick={() => setModalOpen(true)}
      className="cursor-pointer text-2xs font-medium text-accent-primary transition-colors hover:text-accent-primary/80"
    >
      +Add Account
    </button>
  );

  const modal = (
    <AddAccountModal
      open={modalOpen}
      onClose={() => setModalOpen(false)}
      onSuccess={handleAddSuccess}
      connectedPlatforms={connectedPlatformIds}
    />
  );

  if (fetching) {
    return (
      <DashboardCard title="Connected Accounts" headerAction={addButton}>
        <div className="flex flex-1 items-center justify-center px-4 pb-4">
          <Spinner size="md" label="Loading accounts…" />
        </div>
        {modal}
      </DashboardCard>
    );
  }

  if (error || accounts.length === 0) {
    const showContinueSetup = !onboardingComplete && !onboardingSkipped;
    return (
      <DashboardCard title="Connected Accounts">
        <CardEmptyState
          icon={
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
              />
            </svg>
          }
          title="No accounts connected"
          description="Link your investment platforms to track positions."
          action={
            showContinueSetup ? (
              <Button variant="primary" size="sm" onClick={openOnboarding}>
                Continue setup
              </Button>
            ) : undefined
          }
        />
        {modal}
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Connected Accounts" headerAction={addButton}>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
        <div className="grid grid-cols-2 gap-2">
          {accounts.map((account) => {
            const isPositive = account.change >= 0;
            return (
              <div
                key={account.platform}
                className="flex items-center gap-2.5 rounded-lg border border-border-light bg-bg-secondary/50 px-3 py-2.5"
              >
                <PlatformLogo platform={account.platform} size="xs" className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-medium text-text-primary">{account.name}</span>
                    <span className="flex-shrink-0 text-3xs text-text-muted">
                      {account.positionCount} {account.positionCount === 1 ? 'position' : 'positions'}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="text-xs font-semibold tabular-nums text-text-primary">
                      {formatCurrency(account.totalValue)}
                    </span>
                    <span className={`text-3xs tabular-nums ${isPositive ? 'text-success' : 'text-error'}`}>
                      {isPositive ? '+' : ''}
                      {formatCurrency(account.change)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {modal}
    </DashboardCard>
  );
}
