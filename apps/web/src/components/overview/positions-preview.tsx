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
    <div className="rounded-xl border border-border bg-bg-card">
      <div className="flex items-center justify-between px-6 pt-5 pb-4">
        <h3 className="font-headline text-lg text-text-primary">Top Positions</h3>
        <Link to="/portfolio" className="text-sm text-accent-primary hover:text-accent-primary/80 transition-colors">
          View All
        </Link>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted">
            <th className="px-6 pb-3 font-medium">Symbol</th>
            <th className="px-6 pb-3 font-medium">Name</th>
            <th className="px-6 pb-3 text-right font-medium">Value</th>
            <th className="px-6 pb-3 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => (
            <tr key={pos.symbol} className="border-b border-border last:border-b-0">
              <td className="px-6 py-3 text-sm font-medium text-accent-primary">{pos.symbol}</td>
              <td className="px-6 py-3 text-sm text-text-secondary">{pos.name}</td>
              <td className="px-6 py-3 text-right text-sm text-text-primary">{pos.value}</td>
              <td className={cn('px-6 py-3 text-right text-sm', pos.positive ? 'text-success' : 'text-error')}>
                {pos.change}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
