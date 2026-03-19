import { Link } from 'react-router';
import type { Position } from '../../api/types';
import { cn } from '../../lib/utils';
import Badge from '../common/badge';
import EmptyState from '../common/empty-state';
import { SymbolLogo } from '../common/symbol-logo';

const columns = ['Symbol', 'Asset Class', 'Qty', 'Cost Basis', 'Mkt Value', 'P&L'];

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPnlPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export default function PositionTable({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return <EmptyState title="No positions found" description="No positions match the current filter." />;
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
            <tr
              key={`${pos.symbol}:${pos.platform}`}
              className="border-t border-border transition-colors hover:bg-bg-hover"
            >
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <SymbolLogo
                    symbol={pos.symbol}
                    assetClass={pos.assetClass.toLowerCase() as 'equity' | 'crypto'}
                    size="md"
                  />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Link to={`/portfolio/${pos.symbol}`} className="font-medium text-text-primary">
                        {pos.symbol}
                      </Link>
                      {pos.platform === 'MANUAL' && (
                        <Badge variant="neutral" size="xs">
                          manual
                        </Badge>
                      )}
                    </div>
                    <div className="text-2xs text-text-secondary">{pos.name}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-2.5 text-text-secondary capitalize">{pos.assetClass.toLowerCase()}</td>
              <td className="px-4 py-2.5 text-text-secondary">{pos.quantity}</td>
              <td className="px-4 py-2.5 text-text-secondary">{formatCurrency(pos.costBasis)}</td>
              <td className="px-4 py-2.5 text-text-primary font-medium">{formatCurrency(pos.marketValue)}</td>
              <td className="px-4 py-2.5">
                <div className={cn('font-medium', pos.unrealizedPnl >= 0 ? 'text-success' : 'text-error')}>
                  {formatCurrency(pos.unrealizedPnl)}
                  <span className="ml-1 text-2xs">({formatPnlPercent(pos.unrealizedPnlPercent)})</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
