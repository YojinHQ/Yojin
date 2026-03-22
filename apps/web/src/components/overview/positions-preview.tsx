import { useMemo } from 'react';
import { Link } from 'react-router';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { cn } from '../../lib/utils';
import { SymbolLogo } from '../common/symbol-logo';
import { usePositions } from '../../api';
import Spinner from '../common/spinner';

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

/** Seeded pseudo-random for stable sparkline data across re-renders. */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/** Generate a small sparkline dataset from the position's price + P&L direction. */
function generateSparkline(symbol: string, currentPrice: number, pnlPercent: number): { v: number }[] {
  const points = 20;
  let hash = 0;
  for (const c of symbol) hash = c.charCodeAt(0) + ((hash << 5) - hash);

  const isFlat = pnlPercent === 0;
  const trend = pnlPercent > 0 ? 1 : pnlPercent < 0 ? -1 : 0;
  const data: { v: number }[] = [];

  // When P&L is 0, generate a neutral oscillating line (not flat/boring)
  const noiseScale = isFlat ? 0.015 : 0.008;
  let price = isFlat ? currentPrice * (1 - 0.01) : currentPrice * (1 - trend * Math.abs(pnlPercent) * 0.005);

  for (let i = 0; i < points; i++) {
    const noise = (seededRandom(hash + i * 7) - 0.5) * currentPrice * noiseScale;
    const drift = isFlat ? 0 : (trend * currentPrice * 0.002 * i) / points;
    price += noise + drift;
    data.push({ v: price });
  }
  data[data.length - 1] = { v: currentPrice };
  return data;
}

/** Tiny inline sparkline chart — green when up, red when down, muted when flat. */
function Sparkline({ symbol, currentPrice, pnlPercent }: { symbol: string; currentPrice: number; pnlPercent: number }) {
  const data = useMemo(() => generateSparkline(symbol, currentPrice, pnlPercent), [symbol, currentPrice, pnlPercent]);
  const color =
    pnlPercent > 0 ? 'var(--color-success)' : pnlPercent < 0 ? 'var(--color-error)' : 'var(--color-text-muted)';

  return (
    <div className="h-6 w-14 flex-shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PositionsPreview() {
  const [{ data, fetching, error }] = usePositions();

  if (fetching) {
    return (
      <div className="flex min-h-0 min-w-0 flex-[1.2] items-center justify-center rounded-lg border border-border bg-bg-card">
        <Spinner size="sm" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-0 min-w-0 flex-[1.2] flex-col overflow-hidden rounded-lg border border-border bg-bg-card">
        <div className="flex flex-shrink-0 items-center justify-between px-3 py-2">
          <h3 className="text-2xs font-medium text-text-primary uppercase tracking-wider">Top Positions</h3>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="grid grid-cols-[1fr_56px_auto_auto_auto] gap-x-2 border-b border-border px-3 pb-1.5 text-2xs uppercase tracking-wider text-text-muted">
            <span className="font-medium">Asset</span>
            <span />
            <span className="text-right font-medium">Price</span>
            <span className="text-right font-medium">Change</span>
            <span className="text-right font-medium">%</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center text-text-muted">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="mb-2 h-8 w-8 opacity-40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
              />
            </svg>
            <p className="text-xs">No position data available</p>
            <p className="mt-0.5 text-2xs text-text-muted/60">Connect a portfolio to see your holdings</p>
          </div>
        </div>
      </div>
    );
  }

  // Sort by market value descending, show top 5
  const top = [...data.positions].sort((a, b) => b.marketValue - a.marketValue).slice(0, 5);

  return (
    <div className="flex min-h-0 min-w-0 flex-[1.2] flex-col overflow-hidden rounded-lg border border-border bg-bg-card">
      <div className="flex flex-shrink-0 items-center justify-between px-3 py-2">
        <h3 className="text-2xs font-medium text-text-primary uppercase tracking-wider">Top Positions</h3>
        <Link to="/portfolio" className="text-2xs text-accent-primary hover:text-accent-primary/80 transition-colors">
          View All
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 grid grid-cols-[1fr_56px_auto_auto_auto] items-center gap-x-2 border-b border-border bg-bg-card px-3 pb-1.5 text-2xs uppercase tracking-wider text-text-muted">
          <span className="font-medium">Asset</span>
          <span />
          <span className="text-right font-medium">Price</span>
          <span className="text-right font-medium">Change</span>
          <span className="text-right font-medium">%</span>
        </div>

        {/* Rows */}
        {top.map((pos) => {
          const isUp = pos.unrealizedPnlPercent > 0;
          const isDown = pos.unrealizedPnlPercent < 0;
          const colorClass = isUp ? 'text-success' : isDown ? 'text-error' : 'text-text-muted';
          const arrow = isUp ? '\u25B2' : isDown ? '\u25BC' : '';

          return (
            <div
              key={pos.symbol}
              className="grid grid-cols-[1fr_56px_auto_auto_auto] items-center gap-x-2 border-b border-border px-3 py-1.5 last:border-b-0"
            >
              {/* Asset: logo + symbol + name */}
              <div className="flex items-center gap-2 min-w-0">
                <SymbolLogo symbol={pos.symbol} size="sm" />
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-text-primary leading-tight">{pos.symbol}</span>
                  <span className="text-2xs text-text-muted leading-tight truncate">{pos.name}</span>
                </div>
              </div>

              {/* Sparkline */}
              <Sparkline symbol={pos.symbol} currentPrice={pos.currentPrice} pnlPercent={pos.unrealizedPnlPercent} />

              {/* Price */}
              <span className="text-right text-xs font-medium text-text-primary whitespace-nowrap">
                {formatCurrency(pos.currentPrice)}
              </span>

              {/* Change $ */}
              <span className={cn('text-right text-xs whitespace-nowrap', colorClass)}>
                {arrow && <span className="text-2xs mr-0.5">{arrow}</span>}
                {formatChange(pos.unrealizedPnl)}
              </span>

              {/* Change % */}
              <span className={cn('text-right text-xs whitespace-nowrap', colorClass)}>
                {arrow && <span className="text-2xs mr-0.5">{arrow}</span>}
                {formatPercent(pos.unrealizedPnlPercent)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
