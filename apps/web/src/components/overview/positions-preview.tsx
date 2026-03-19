import { Link } from 'react-router';
import { cn } from '../../lib/utils';
import { SymbolLogo } from '../common/symbol-logo';
import { usePositions } from '../../api';
import Spinner from '../common/spinner';

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatPercent(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

export default function PositionsPreview() {
  const [{ data, fetching, error }] = usePositions();

  if (fetching) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-lg border border-border bg-bg-card">
        <Spinner size="sm" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg-card">
        <div className="flex flex-shrink-0 items-center justify-between px-3 py-2">
          <h3 className="text-2xs font-medium text-text-primary uppercase tracking-wider">Top Positions</h3>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-bg-card">
              <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-text-muted">
                <th className="px-3 pb-1.5 font-medium">Symbol</th>
                <th className="px-3 pb-1.5 font-medium">Name</th>
                <th className="px-3 pb-1.5 text-right font-medium">Value</th>
                <th className="px-3 pb-1.5 text-right font-medium">Change</th>
              </tr>
            </thead>
          </table>
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg-card">
      <div className="flex flex-shrink-0 items-center justify-between px-3 py-2">
        <h3 className="text-2xs font-medium text-text-primary uppercase tracking-wider">Top Positions</h3>
        <Link to="/portfolio" className="text-2xs text-accent-primary hover:text-accent-primary/80 transition-colors">
          View All
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-bg-card">
            <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-text-muted">
              <th className="px-3 pb-1.5 font-medium">Symbol</th>
              <th className="px-3 pb-1.5 font-medium">Name</th>
              <th className="px-3 pb-1.5 text-right font-medium">Value</th>
              <th className="px-3 pb-1.5 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {top.map((pos) => (
              <tr key={pos.symbol} className="border-b border-border last:border-b-0">
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <SymbolLogo symbol={pos.symbol} size="sm" />
                    <span className="text-xs font-medium text-text-primary">{pos.symbol}</span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-xs text-text-secondary">{pos.name}</td>
                <td className="px-3 py-1.5 text-right text-xs text-text-primary">{formatCurrency(pos.marketValue)}</td>
                <td
                  className={cn(
                    'px-3 py-1.5 text-right text-xs',
                    pos.unrealizedPnlPercent >= 0 ? 'text-success' : 'text-error',
                  )}
                >
                  {formatPercent(pos.unrealizedPnlPercent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
