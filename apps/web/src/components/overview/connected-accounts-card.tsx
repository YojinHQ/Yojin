import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
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

const PLATFORM_PALETTE = [
  'var(--color-accent-primary)',
  'var(--color-accent-secondary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-info)',
  'var(--color-text-muted)',
];

interface AccountSummary {
  platform: string;
  name: string;
  totalValue: number;
  change: number;
}

interface AllocationSlice {
  name: string;
  value: number;
  color: string;
}

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function DonutTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number }>;
  total: number;
}) {
  if (!active || !payload?.[0]) return null;
  const pct = total > 0 ? ((payload[0].value / total) * 100).toFixed(1) : '0';
  return (
    <div className="rounded-lg border border-border bg-bg-card px-2.5 py-1.5 text-2xs shadow-lg">
      <span className="text-text-primary">{payload[0].name}</span>
      <span className="ml-1.5 text-text-muted">{pct}%</span>
    </div>
  );
}

export default function ConnectedAccountsCard() {
  const [{ data, fetching, error }, reexecuteQuery] = usePositions();
  const [modalOpen, setModalOpen] = useState(false);
  const { openOnboarding, completed: onboardingComplete, skipped: onboardingSkipped } = useOnboardingStatus();

  const accounts = useMemo<AccountSummary[]>(() => {
    const positions = data?.positions ?? [];
    if (positions.length === 0) return [];

    const grouped: Record<string, { totalValue: number; change: number }> = {};
    for (const pos of positions) {
      const key = pos.platform;
      if (!grouped[key]) grouped[key] = { totalValue: 0, change: 0 };
      grouped[key].totalValue += pos.marketValue;
      grouped[key].change += pos.dayChange ?? 0;
    }

    return Object.entries(grouped)
      .map(([platform, agg]) => ({
        platform,
        name: PLATFORM_DISPLAY[platform] ?? platform,
        totalValue: agg.totalValue,
        change: agg.change,
      }))
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [data?.positions]);

  const allocation = useMemo<AllocationSlice[]>(() => {
    if (accounts.length === 0) return [];

    return accounts.map((account, idx) => ({
      name: account.name,
      value: account.totalValue,
      color: PLATFORM_PALETTE[idx % PLATFORM_PALETTE.length],
    }));
  }, [accounts]);

  const allocationTotal = useMemo(() => allocation.reduce((s, a) => s + a.value, 0), [allocation]);

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
          <Spinner size="sm" />
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
      <div className="flex min-h-0 flex-1 items-start gap-6 px-4 pb-4">
        {/* Account list */}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {accounts.map((account) => (
            <div key={account.platform} className="flex items-center gap-2">
              <PlatformLogo platform={account.platform} size="xs" className="flex-shrink-0" />
              <span className="text-xs font-medium text-text-primary">{account.name}</span>
              <span className="text-xs font-medium text-text-primary tabular-nums">
                {formatCurrency(account.totalValue)}
              </span>
            </div>
          ))}
        </div>

        {/* Donut chart — labels only on hover */}
        {allocation.length > 0 && (
          <div className="flex flex-shrink-0 flex-col items-center">
            <div className="h-[72px] w-[72px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocation}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={20}
                    outerRadius={34}
                    strokeWidth={1}
                    stroke="var(--color-bg-card)"
                  >
                    {allocation.map((slice) => (
                      <Cell key={slice.name} fill={slice.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<DonutTooltip total={allocationTotal} />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {modal}
    </DashboardCard>
  );
}
