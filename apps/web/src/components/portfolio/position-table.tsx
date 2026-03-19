import { useMemo } from 'react';
import { Link } from 'react-router';
import { cn } from '../../lib/utils';
import EmptyState from '../common/empty-state';
import { SymbolLogo } from '../common/symbol-logo';
import type { Position } from '../../api';

const columns = ['Symbol', 'Platform', 'Class', 'Quantity', 'Price', 'Value', '% of Total', '% of Class', 'P&L'];

const PLATFORM_LABELS: Record<string, string> = {
  INTERACTIVE_BROKERS: 'IBKR',
  ROBINHOOD: 'Robinhood',
  COINBASE: 'Coinbase',
  MANUAL: 'Manual',
};

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export default function PositionTable({ positions }: { positions: Position[] }) {
  const totalValue = useMemo(() => positions.reduce((sum, p) => sum + p.marketValue, 0), [positions]);

  const classTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const p of positions) {
      totals[p.assetClass] = (totals[p.assetClass] ?? 0) + p.marketValue;
    }
    return totals;
  }, [positions]);

  if (positions.length === 0) {
    return <EmptyState title="No positions found" description="Import a portfolio to see your positions." />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="bg-bg-tertiary">
            {columns.map((col) => (
              <th key={col} className="px-4 py-2.5 text-2xs font-medium uppercase tracking-wider text-text-muted">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => (
            <tr key={pos.symbol} className="border-t border-border transition-colors hover:bg-bg-hover">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <SymbolLogo
                    symbol={pos.symbol}
                    assetClass={pos.assetClass.toLowerCase() as 'equity' | 'crypto'}
                    size="md"
                  />
                  <div>
                    <Link to={`/portfolio/${pos.symbol}`} className="font-medium text-text-primary">
                      {pos.symbol}
                    </Link>
                    <div className="text-2xs text-text-secondary">{pos.name}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-2.5 text-text-secondary">{PLATFORM_LABELS[pos.platform] ?? pos.platform}</td>
              <td className="px-4 py-2.5 text-text-secondary">
                {pos.assetClass.charAt(0) + pos.assetClass.slice(1).toLowerCase()}
              </td>
              <td className="px-4 py-2.5 text-text-secondary">{pos.quantity}</td>
              <td className="px-4 py-2.5 text-text-secondary">{formatCurrency(pos.currentPrice)}</td>
              <td className="px-4 py-2.5 font-medium text-text-primary">{formatCurrency(pos.marketValue)}</td>
              <td className="px-4 py-2.5 text-text-secondary">
                {totalValue > 0 ? `${((pos.marketValue / totalValue) * 100).toFixed(1)}%` : '-'}
              </td>
              <td className="px-4 py-2.5 text-text-secondary">
                {(classTotals[pos.assetClass] ?? 0) > 0
                  ? `${((pos.marketValue / classTotals[pos.assetClass]) * 100).toFixed(1)}%`
                  : '-'}
              </td>
              <td className="px-4 py-2.5">
                <span className={cn('font-medium', pos.unrealizedPnlPercent >= 0 ? 'text-success' : 'text-error')}>
                  {formatPercent(pos.unrealizedPnlPercent)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
