import { Link } from 'react-router';
import { cn } from '../../lib/utils';

interface Position {
  symbol: string;
  name: string;
  value: string;
  change: string;
  positive: boolean;
}

const positions: Position[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', value: '$18,432.50', change: '+2.4%', positive: true },
  { symbol: 'MSFT', name: 'Microsoft Corp.', value: '$15,221.80', change: '+1.8%', positive: true },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', value: '$12,845.20', change: '-0.6%', positive: false },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', value: '$11,534.00', change: '+3.1%', positive: true },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', value: '$22,150.75', change: '+5.2%', positive: true },
];

export default function PositionsPreview() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg-card">
      <div className="flex flex-shrink-0 items-center justify-between px-3 py-2">
        <h3 className="text-sm font-medium text-text-primary">Top Positions</h3>
        <Link to="/portfolio" className="text-xs text-accent-primary hover:text-accent-primary/80 transition-colors">
          View All
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-bg-card">
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-muted">
              <th className="px-3 pb-1.5 font-medium">Symbol</th>
              <th className="px-3 pb-1.5 font-medium">Name</th>
              <th className="px-3 pb-1.5 text-right font-medium">Value</th>
              <th className="px-3 pb-1.5 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => (
              <tr key={pos.symbol} className="border-b border-border last:border-b-0">
                <td className="px-3 py-1.5 text-xs font-medium text-accent-primary">{pos.symbol}</td>
                <td className="px-3 py-1.5 text-xs text-text-secondary">{pos.name}</td>
                <td className="px-3 py-1.5 text-right text-xs text-text-primary">{pos.value}</td>
                <td className={cn('px-3 py-1.5 text-right text-xs', pos.positive ? 'text-success' : 'text-error')}>
                  {pos.change}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
