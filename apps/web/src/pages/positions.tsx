import { usePortfolio } from '../api/hooks/use-portfolio';
import Spinner from '../components/common/spinner';
import EmptyState from '../components/common/empty-state';
import Button from '../components/common/button';
import PortfolioStats from '../components/portfolio/portfolio-stats';
import PositionTable from '../components/portfolio/position-table';
import CashBalancesCard from '../components/portfolio/cash-balances-card';
import { PageBlurGate } from '../components/common/page-blur-gate';
import { useAddPositionModal } from '../lib/add-position-modal-context';
import { cn } from '../lib/utils';

export default function Positions() {
  return (
    <PageBlurGate requires="jintel" mockContent={<MockPortfolioPage />}>
      <PositionsContent />
    </PageBlurGate>
  );
}

function PositionsContent() {
  const [{ data: portfolioData, fetching, error }] = usePortfolio();
  const { openModal: openAddPosition } = useAddPositionModal();

  const portfolio = portfolioData?.portfolio ?? null;
  const positions = portfolio?.positions ?? [];
  const cashBalances = portfolio?.cashBalances ?? [];

  if (fetching) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <Spinner size="lg" />
        <p className="text-sm text-text-muted">Loading portfolio...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 p-6">
        <PortfolioStats portfolio={portfolio} />
        <div className="mt-6">
          <CashBalancesCard cashBalances={cashBalances} />
        </div>
        <div className="mt-6">
          <EmptyState title="Failed to load portfolio" description={error.message} />
        </div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex-1 p-6">
        <PortfolioStats portfolio={portfolio} />
        <div className="mt-6">
          <CashBalancesCard cashBalances={cashBalances} />
        </div>
        <div className="mt-6">
          <EmptyState
            icon={
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
                />
              </svg>
            }
            title="No positions yet"
            description="Add your first position to get started with portfolio tracking."
            action={
              <Button variant="primary" size="sm" onClick={openAddPosition}>
                Add Position
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-6 max-w-5xl mx-auto">
      <div className="shrink-0 pb-4">
        <PortfolioStats portfolio={portfolio} />
      </div>
      <div className="shrink-0 pb-4">
        <CashBalancesCard cashBalances={cashBalances} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <PositionTable positions={positions} onAdd={openAddPosition} />
      </div>
    </div>
  );
}

// ─── Mock portfolio page shown behind blur gate ─────────────

const MOCK_STATS = [
  { label: 'Total Value', value: '$127,450.32' },
  { label: 'Total P&L', value: '$12,340.18', change: '+10.72%', positive: true },
  { label: 'Total Positions', value: '8' },
];

const MOCK_ROWS = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc',
    qty: '45',
    price: '$182.52',
    value: '$8,213',
    pnl: '+$1,234',
    pct: '+17.7%',
    up: true,
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corp',
    qty: '12',
    price: '$875.28',
    value: '$10,503',
    pnl: '+$3,890',
    pct: '+58.8%',
    up: true,
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    qty: '0.85',
    price: '$67,234',
    value: '$57,149',
    pnl: '+$8,420',
    pct: '+17.3%',
    up: true,
  },
  {
    symbol: 'TSLA',
    name: 'Tesla Inc',
    qty: '20',
    price: '$248.42',
    value: '$4,968',
    pnl: '-$432',
    pct: '-8.0%',
    up: false,
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft',
    qty: '30',
    price: '$415.60',
    value: '$12,468',
    pnl: '+$2,190',
    pct: '+21.3%',
    up: true,
  },
  {
    symbol: 'AMZN',
    name: 'Amazon',
    qty: '15',
    price: '$178.35',
    value: '$2,675',
    pnl: '+$340',
    pct: '+14.6%',
    up: true,
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    qty: '5.2',
    price: '$3,420',
    value: '$17,784',
    pnl: '-$1,205',
    pct: '-6.3%',
    up: false,
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet',
    qty: '25',
    price: '$152.80',
    value: '$3,820',
    pnl: '+$502',
    pct: '+15.1%',
    up: true,
  },
];

const TH = 'whitespace-nowrap px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-text-muted';

function MockPortfolioPage() {
  return (
    <div className="flex-1 overflow-hidden p-6 max-w-5xl mx-auto w-full">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {MOCK_STATS.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-bg-card p-4">
            <p className="text-xs uppercase tracking-wider text-text-muted">{stat.label}</p>
            <div className="mt-1.5 flex items-baseline gap-2">
              <p className="text-lg font-semibold text-text-primary">{stat.value}</p>
              {'change' in stat && stat.change && (
                <p className={cn('text-xs', stat.positive ? 'text-success' : 'text-error')}>{stat.change}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-bg-card">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border bg-bg-secondary/30">
              <th className={TH}>Asset</th>
              <th className={cn(TH, 'text-right')}>Quantity</th>
              <th className={cn(TH, 'text-right')}>Price</th>
              <th className={cn(TH, 'text-right')}>Value</th>
              <th className={cn(TH, 'text-right')}>P&L</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_ROWS.map((row) => (
              <tr key={row.symbol} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 flex-shrink-0 rounded-full bg-bg-tertiary" />
                    <div>
                      <span className="text-sm font-semibold text-text-primary">{row.symbol}</span>
                      <p className="text-xs text-text-muted">{row.name}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums text-text-secondary">{row.qty}</td>
                <td className="px-4 py-3 text-right text-sm tabular-nums text-text-primary">{row.price}</td>
                <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-text-primary">{row.value}</td>
                <td className={cn('px-4 py-3 text-right text-sm tabular-nums', row.up ? 'text-success' : 'text-error')}>
                  {row.pnl} <span className="text-xs">({row.pct})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
