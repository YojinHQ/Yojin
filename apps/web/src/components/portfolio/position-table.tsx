import { useMemo } from 'react';
import { Link } from 'react-router';
import type { KnownPlatform, Position } from '../../api';
import { isKnownPlatform } from '../../api';
import { cn } from '../../lib/utils';
import EmptyState from '../common/empty-state';
import { SymbolLogo } from '../common/symbol-logo';

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatPnl(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatCurrency(value)}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

const PLATFORM_BADGE = 'bg-bg-tertiary text-text-muted';

const platformLabels: Record<KnownPlatform, string> = {
  INTERACTIVE_BROKERS: 'IBKR',
  ROBINHOOD: 'Robinhood',
  COINBASE: 'Coinbase',
  SCHWAB: 'Schwab',
  BINANCE: 'Binance',
  FIDELITY: 'Fidelity',
  POLYMARKET: 'Polymarket',
  PHANTOM: 'Phantom',
  METAMASK: 'MetaMask',
  WEBULL: 'Webull',
  SOFI: 'SoFi',
  MOOMOO: 'Moomoo',
  MANUAL: 'Manual',
};

function getPlatformLabel(platform: string): string {
  return isKnownPlatform(platform) ? platformLabels[platform] : platform;
}

const TH = 'px-4 py-2.5 text-2xs font-medium uppercase tracking-wider text-text-muted';

export default function PositionTable({ positions }: { positions: Position[] }) {
  const totalValue = useMemo(() => positions.reduce((sum, p) => sum + p.marketValue, 0), [positions]);

  if (positions.length === 0) {
    return <EmptyState title="No positions found" description="Import a portfolio to see your positions." />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="bg-bg-tertiary">
            <th className={TH} />
            <th className={TH}>Account</th>
            <th className={cn(TH, 'text-right')}>Qty</th>
            <th className={cn(TH, 'text-right')}>Avg Entry</th>
            <th className={cn(TH, 'text-right')}>Price</th>
            <th className={cn(TH, 'text-right')}>Value</th>
            <th className={cn(TH, 'text-right')}>Today ($)</th>
            <th className={cn(TH, 'text-right')}>Today (%)</th>
            <th className={cn(TH, 'text-right')}>Weight</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => {
            const weight = totalValue > 0 ? (pos.marketValue / totalValue) * 100 : 0;

            return (
              <tr
                key={`${pos.symbol}:${pos.platform}`}
                className="border-t border-border transition-colors hover:bg-bg-hover"
              >
                <td className="px-4 py-3">
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
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('inline-block rounded px-1.5 py-0.5 text-2xs font-medium', PLATFORM_BADGE)}>
                    {getPlatformLabel(pos.platform)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{pos.quantity}</td>
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                  {formatCurrency(pos.costBasis)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">
                  {formatCurrency(pos.currentPrice)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">
                  {formatCurrency(pos.marketValue)}
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right tabular-nums font-medium',
                    pos.unrealizedPnl >= 0 ? 'text-success' : 'text-error',
                  )}
                >
                  {formatPnl(pos.unrealizedPnl)}
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right tabular-nums font-medium',
                    pos.unrealizedPnlPercent >= 0 ? 'text-success' : 'text-error',
                  )}
                >
                  {formatPercent(pos.unrealizedPnlPercent)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">
                  {weight.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
