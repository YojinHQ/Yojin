import { useMemo } from 'react';
import { Link } from 'react-router';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { cn } from '../../lib/utils';
import { SymbolLogo } from '../common/symbol-logo';
import { usePositions } from '../../api';
import { CardEmptyState } from '../common/card-empty-state';
import Spinner from '../common/spinner';
import { DashboardCard } from '../common/dashboard-card';

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatChange(n: number): string {
  const abs = Math.abs(n);
  return `$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(n: number): string {
  return `${Math.abs(n).toFixed(2)}%`;
}

/** Inline sparkline area chart — green when up, red when down, muted when flat. */
function Sparkline({ symbol, data, dayChangePercent }: { symbol: string; data: number[]; dayChangePercent: number }) {
  const chartData = useMemo(() => data.map((v) => ({ v })), [data]);
  const color =
    dayChangePercent > 0
      ? 'var(--color-success)'
      : dayChangePercent < 0
        ? 'var(--color-error)'
        : 'var(--color-text-muted)';

  return (
    <div className="pointer-events-none h-8 w-[100px]">
      <ResponsiveContainer width="100%" height="100%" minHeight={1}>
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={`positions-preview-spark-${symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#positions-preview-spark-${symbol})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const TH = 'whitespace-nowrap px-3 py-2 text-2xs font-medium uppercase tracking-wider text-text-muted';

export default function PositionsPreview() {
  const [{ data, fetching, error }] = usePositions();

  const viewAllLink = (
    <Link to="/portfolio" className="text-2xs text-accent-primary transition-colors hover:text-accent-primary/80">
      View All
    </Link>
  );

  if (fetching) {
    return (
      <DashboardCard title="Top Positions" headerAction={viewAllLink}>
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="md" label="Fetching positions…" />
        </div>
      </DashboardCard>
    );
  }

  if (error || !data || data.positions.length === 0) {
    return (
      <DashboardCard title="Top Positions">
        <CardEmptyState
          icon={
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
              />
            </svg>
          }
          title="No position data"
          description="Connect a platform to see your holdings."
        />
      </DashboardCard>
    );
  }

  // Sort by market value descending, show top 5
  const top = [...data.positions].sort((a, b) => b.marketValue - a.marketValue).slice(0, 5);

  return (
    <DashboardCard title="Top Positions" headerAction={viewAllLink}>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 z-10 bg-bg-card">
            <tr className="border-b border-border">
              <th className={TH}>Asset</th>
              <th className={cn(TH, 'w-[100px]')} />
              <th className={cn(TH, 'text-right')}>Price Today</th>
              <th className={cn(TH, 'text-right')}>Change $</th>
              <th className={cn(TH, 'text-right')}>Change %</th>
            </tr>
          </thead>
          <tbody>
            {top.map((pos) => {
              const dc = pos.dayChange;
              const dcp = pos.dayChangePercent;
              const isUp = dc != null && dc > 0;
              const isDown = dc != null && dc < 0;
              const colorClass = isUp ? 'text-success' : isDown ? 'text-error' : 'text-text-muted';
              const arrow = isUp ? '\u25B2' : isDown ? '\u25BC' : '';

              return (
                <tr key={`${pos.symbol}:${pos.platform}`} className="border-b border-border last:border-b-0">
                  {/* Asset: logo + symbol + name */}
                  <td className="px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <SymbolLogo
                        symbol={pos.symbol}
                        assetClass={pos.assetClass.toLowerCase() as 'equity' | 'crypto'}
                        size="sm"
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="text-xs font-semibold leading-tight text-text-primary">{pos.symbol}</span>
                        <span className="truncate text-2xs leading-tight text-text-muted">{pos.name}</span>
                      </div>
                    </div>
                  </td>

                  {/* Sparkline */}
                  <td className="px-3 py-2">
                    {pos.sparkline ? (
                      <Sparkline symbol={pos.symbol} data={pos.sparkline} dayChangePercent={dcp ?? 0} />
                    ) : (
                      <div className="flex h-8 w-[100px] items-center justify-center">
                        <span className="text-2xs text-text-muted/40">—</span>
                      </div>
                    )}
                  </td>

                  {/* Price Today */}
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium tabular-nums text-text-primary">
                    {formatCurrency(pos.currentPrice)}
                  </td>

                  {/* Change $ */}
                  <td className={cn('whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums', colorClass)}>
                    {dc != null ? (
                      <>
                        {arrow && <span className="mr-0.5 text-2xs">{arrow}</span>}
                        {formatChange(dc)}
                      </>
                    ) : (
                      <span className="text-text-muted/40">—</span>
                    )}
                  </td>

                  {/* Change % */}
                  <td className={cn('whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums', colorClass)}>
                    {dcp != null ? (
                      <>
                        {arrow && <span className="mr-0.5 text-2xs">{arrow}</span>}
                        {formatPercent(dcp)}
                      </>
                    ) : (
                      <span className="text-text-muted/40">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DashboardCard>
  );
}
