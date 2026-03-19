import { BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { cn } from '../../../lib/utils';
import { usePortfolio } from '../../../api';
import { SymbolCell } from '../../common/symbol-logo';
import Spinner from '../../common/spinner';
import RichCard from '../rich-card';

type Period = 'today' | 'week' | 'ytd';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'TODAY',
  week: 'THIS WEEK',
  ytd: 'YTD',
};

function formatCurrency(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return n < 0 ? `-${formatted}` : n > 0 ? `+${formatted}` : formatted;
}

function formatPercent(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

interface PortfolioOverviewCardProps {
  period: Period;
}

export default function PortfolioOverviewCard({ period }: PortfolioOverviewCardProps) {
  const [{ data, fetching, error }] = usePortfolio();
  const navigate = useNavigate();

  if (fetching) {
    return (
      <RichCard>
        <RichCard.Header icon={BarChart3} title="Portfolio Performance" badge={PERIOD_LABELS[period]} />
        <div className="flex items-center justify-center px-6 py-8">
          <Spinner size="sm" />
        </div>
      </RichCard>
    );
  }

  if (error || !data?.portfolio) {
    return (
      <RichCard>
        <RichCard.Header icon={BarChart3} title="Portfolio Performance" badge={PERIOD_LABELS[period]} />
        <RichCard.Body>No portfolio data available. Connect a platform or add positions to get started.</RichCard.Body>
      </RichCard>
    );
  }

  const { totalValue, totalPnl, totalPnlPercent, positions } = data.portfolio;
  const isPositive = totalPnl >= 0;

  // Top 5 by market value for the summary table
  const top = [...positions].sort((a, b) => b.marketValue - a.marketValue).slice(0, 5);

  return (
    <RichCard>
      <RichCard.Header icon={BarChart3} title="Portfolio Performance" badge={PERIOD_LABELS[period]} />
      <RichCard.Body>
        Your portfolio is valued at {totalValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} across{' '}
        {positions.length} positions.{' '}
        <span className={cn(isPositive ? 'text-success' : 'text-error')}>
          {isPositive ? 'Up' : 'Down'} {formatCurrency(totalPnl)} ({formatPercent(totalPnlPercent)})
        </span>{' '}
        overall.
      </RichCard.Body>
      <RichCard.Stats
        items={[
          { value: totalValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' }), label: 'Total Value' },
          { value: formatCurrency(totalPnl), label: 'Unrealized P&L', highlight: true },
          { value: formatPercent(totalPnlPercent), label: 'Return' },
          { value: String(positions.length), label: 'Positions' },
        ]}
      />
      {top.length > 0 && (
        <>
          <RichCard.SectionLabel>Largest Holdings</RichCard.SectionLabel>
          <RichCard.Table
            columns={[
              { key: 'symbol', header: 'Symbol' },
              { key: 'value', header: 'Value', align: 'right' },
              { key: 'weight', header: 'Weight', align: 'right' },
              { key: 'change', header: 'P&L', align: 'right' },
            ]}
            rows={top.map((pos) => ({
              symbol: <SymbolCell symbol={pos.symbol} assetClass={pos.assetClass === 'CRYPTO' ? 'crypto' : 'equity'} />,
              value: pos.marketValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
              weight: totalValue > 0 ? `${((pos.marketValue / totalValue) * 100).toFixed(1)}%` : '—',
              change: (
                <span className={cn(pos.unrealizedPnlPercent >= 0 ? 'text-success' : 'text-error')}>
                  {formatPercent(pos.unrealizedPnlPercent)}
                </span>
              ),
            }))}
          />
        </>
      )}
      <RichCard.Divider />
      <RichCard.Actions
        actions={[
          { label: 'View All Positions', onClick: () => navigate('/portfolio') },
          { label: 'Risk Report', onClick: () => navigate('/chat', { state: { preset: 'Show me my risk report' } }) },
        ]}
      />
    </RichCard>
  );
}
