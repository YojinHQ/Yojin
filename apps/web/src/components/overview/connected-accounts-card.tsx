import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { cn } from '../../lib/utils';
import { usePositions } from '../../api';
import Spinner from '../common/spinner';
import { DashboardCard } from '../common/dashboard-card';
import AddAccountModal from './add-account-modal';

const PLATFORM_DISPLAY: Record<string, { name: string; logo: string }> = {
  INTERACTIVE_BROKERS: { name: 'IBKR', logo: '/platforms/interactive-brokers.png' },
  ROBINHOOD: { name: 'Robinhood', logo: '/platforms/robinhood.png' },
  COINBASE: { name: 'Coinbase', logo: '/platforms/coinbase.png' },
  BINANCE: { name: 'Binance', logo: '/platforms/binance.png' },
  METAMASK: { name: 'MetaMask', logo: '/platforms/metamask.png' },
  WEBULL: { name: 'WeBull', logo: '/platforms/webull.png' },
  SOFI: { name: 'SoFi', logo: '/platforms/sofi.png' },
  SCHWAB: { name: 'Schwab', logo: '/platforms/schwab.png' },
  FIDELITY: { name: 'Fidelity', logo: '/platforms/fidelity.png' },
  MOOMOO: { name: 'Moomoo', logo: '/platforms/moomoo.png' },
  PHANTOM: { name: 'Phantom', logo: '/platforms/phantom.png' },
  MANUAL: { name: 'Manual', logo: '' },
};

const ASSET_CLASS_COLORS: Record<string, string> = {
  EQUITY: 'var(--color-accent-primary)',
  CRYPTO: 'var(--color-accent-secondary)',
  BOND: 'var(--color-success)',
  COMMODITY: 'var(--color-warning)',
  CURRENCY: 'var(--color-info)',
  OTHER: 'var(--color-text-muted)',
};

interface AccountSummary {
  platform: string;
  name: string;
  logo: string;
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

function formatChange(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '' : '';
  return `${sign}${n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`;
}

const LOGO_PALETTE = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#6366f1'];

function getInitialColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = char.charCodeAt(0) + ((hash << 5) - hash);
  return LOGO_PALETTE[Math.abs(hash) % LOGO_PALETTE.length];
}

function PlatformLogo({ name, logo }: { name: string; logo: string }) {
  const [imgError, setImgError] = useState(false);

  if (!logo || imgError) {
    return (
      <div
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: getInitialColor(name) }}
      >
        <span className="text-[9px] font-bold text-white">{name.slice(0, 2).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-tertiary">
      <img src={logo} alt={`${name} logo`} className="h-full w-full object-contain" onError={() => setImgError(true)} />
    </div>
  );
}

export default function ConnectedAccountsCard() {
  const [{ data, fetching, error }, reexecuteQuery] = usePositions();
  const [modalOpen, setModalOpen] = useState(false);

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
      .map(([platform, agg]) => {
        const info = PLATFORM_DISPLAY[platform];
        return {
          platform,
          name: info?.name ?? platform,
          logo: info?.logo ?? '',
          totalValue: agg.totalValue,
          change: agg.change,
        };
      })
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [data?.positions]);

  const allocation = useMemo<AllocationSlice[]>(() => {
    const positions = data?.positions ?? [];
    if (positions.length === 0) return [];

    const totals: Record<string, number> = {};
    for (const pos of positions) {
      totals[pos.assetClass] = (totals[pos.assetClass] ?? 0) + pos.marketValue;
    }

    return Object.entries(totals)
      .map(([assetClass, value]) => ({
        name: assetClass.charAt(0) + assetClass.slice(1).toLowerCase(),
        value,
        color: ASSET_CLASS_COLORS[assetClass] ?? ASSET_CLASS_COLORS.OTHER,
      }))
      .sort((a, b) => b.value - a.value);
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
          <Spinner size="sm" />
        </div>
        {modal}
      </DashboardCard>
    );
  }

  if (error || accounts.length === 0) {
    return (
      <DashboardCard title="Connected Accounts" headerAction={addButton}>
        <div className="flex flex-1 items-center justify-center px-4 pb-4">
          <p className="text-xs text-text-muted">No accounts connected yet</p>
        </div>
        {modal}
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Connected Accounts" headerAction={addButton}>
      <div className="flex min-h-0 flex-1 items-start gap-6 px-4 pb-4">
        {/* Account list */}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {accounts.map((account) => {
            const isPositive = account.change > 0;
            const isNeutral = account.change === 0;
            return (
              <div key={account.platform} className="flex items-center gap-2.5">
                <PlatformLogo name={account.name} logo={account.logo} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">{account.name}</span>
                <span className="text-xs font-medium text-text-primary tabular-nums">
                  {formatCurrency(account.totalValue)}
                </span>
                <span
                  className={cn(
                    'min-w-[52px] text-right text-xs tabular-nums',
                    isNeutral ? 'text-text-muted' : isPositive ? 'text-success' : 'text-error',
                  )}
                >
                  {formatChange(account.change)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Donut chart */}
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
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1.5 flex flex-col gap-0.5">
              {allocation.map((slice) => (
                <div key={slice.name} className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: slice.color }} />
                  <span className="text-[10px] leading-tight text-text-muted">{slice.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {modal}
    </DashboardCard>
  );
}
