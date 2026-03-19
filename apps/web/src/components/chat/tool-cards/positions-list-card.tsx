import { Briefcase, TrendingUp, TrendingDown, Activity, List } from 'lucide-react';
import { useNavigate } from 'react-router';
import { cn } from '../../../lib/utils';
import { usePositions } from '../../../api';
import type { Position } from '../../../api';
import { SymbolCell } from '../../common/symbol-logo';
import Spinner from '../../common/spinner';
import RichCard from '../rich-card';

type Variant = 'top' | 'worst' | 'movers' | 'all';

const VARIANT_CONFIG: Record<
  Variant,
  { title: string; badge: string; icon: typeof Briefcase; sort: (a: Position, b: Position) => number; limit: number }
> = {
  top: {
    title: 'Top Performers',
    badge: 'GAINERS',
    icon: TrendingUp,
    sort: (a, b) => b.unrealizedPnlPercent - a.unrealizedPnlPercent,
    limit: 5,
  },
  worst: {
    title: 'Underperformers',
    badge: 'LAGGING',
    icon: TrendingDown,
    sort: (a, b) => a.unrealizedPnlPercent - b.unrealizedPnlPercent,
    limit: 5,
  },
  movers: {
    title: "Today's Movers",
    badge: 'ACTIVE',
    icon: Activity,
    sort: (a, b) => Math.abs(b.unrealizedPnl) - Math.abs(a.unrealizedPnl),
    limit: 5,
  },
  all: {
    title: 'All Positions',
    badge: 'PORTFOLIO',
    icon: List,
    sort: (a, b) => b.marketValue - a.marketValue,
    limit: 50,
  },
};

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatPnl(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

interface PositionsListCardProps {
  variant: Variant;
}

export default function PositionsListCard({ variant }: PositionsListCardProps) {
  const [{ data, fetching, error }] = usePositions();
  const navigate = useNavigate();
  const config = VARIANT_CONFIG[variant];

  if (fetching) {
    return (
      <RichCard>
        <RichCard.Header icon={config.icon} title={config.title} badge={config.badge} />
        <div className="flex items-center justify-center px-6 py-8">
          <Spinner size="sm" />
        </div>
      </RichCard>
    );
  }

  if (error || !data?.positions.length) {
    return (
      <RichCard>
        <RichCard.Header icon={config.icon} title={config.title} badge={config.badge} />
        <RichCard.Body>
          No position data available. Connect a portfolio or add positions manually to get started.
        </RichCard.Body>
      </RichCard>
    );
  }

  const sorted = [...data.positions].sort(config.sort).slice(0, config.limit);
  const totalValue = sorted.reduce((sum, p) => sum + p.marketValue, 0);

  return (
    <RichCard>
      <RichCard.Header icon={config.icon} title={config.title} badge={config.badge} />
      <RichCard.Stats
        items={[
          { value: String(sorted.length), label: variant === 'all' ? 'Total Positions' : 'Positions' },
          { value: formatCurrency(totalValue), label: 'Market Value' },
        ]}
      />
      <RichCard.Table
        columns={[
          { key: 'symbol', header: 'Symbol' },
          { key: 'value', header: 'Value', align: 'right' },
          { key: 'change', header: 'P&L', align: 'right' },
        ]}
        rows={sorted.map((pos) => ({
          symbol: <SymbolCell symbol={pos.symbol} assetClass={pos.assetClass === 'CRYPTO' ? 'crypto' : 'equity'} />,
          value: formatCurrency(pos.marketValue),
          change: (
            <span className={cn(pos.unrealizedPnlPercent >= 0 ? 'text-success' : 'text-error')}>
              {formatPnl(pos.unrealizedPnlPercent)}
            </span>
          ),
        }))}
      />
      <RichCard.Divider />
      <RichCard.Actions
        actions={[
          { label: 'View Portfolio', onClick: () => navigate('/portfolio') },
          {
            label: 'Add Position',
            onClick: () => navigate('/chat', { state: { preset: 'I want to add a position manually' } }),
          },
        ]}
      />
    </RichCard>
  );
}
