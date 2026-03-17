import { Link } from 'react-router';
import StatusBadge from './status-badge';

interface Position {
  symbol: string;
  name: string;
  assetClass: string;
  shares: number;
  value: number;
  date: string;
  status: 'holding' | 'watching' | 'pending' | 'sold';
}

const columns = ['Symbol', 'Asset Class', 'Shares', 'Value', 'Date', 'Status'];

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function PositionTable({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-12 text-center">
        <p className="text-text-muted">No positions match the current filter.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="bg-bg-tertiary">
            {columns.map((col) => (
              <th
                key={col}
                className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => (
            <tr
              key={pos.symbol}
              className="border-t border-border transition-colors hover:bg-bg-hover"
            >
              <td className="px-4 py-3">
                <Link to={`/portfolio/${pos.symbol}`} className="font-medium text-accent-primary">
                  {pos.symbol}
                </Link>
                <div className="text-xs text-text-muted">{pos.name}</div>
              </td>
              <td className="px-4 py-3 text-text-secondary">{pos.assetClass}</td>
              <td className="px-4 py-3 text-text-secondary">{pos.shares}</td>
              <td className="px-4 py-3 text-text-primary font-medium">
                {formatCurrency(pos.value)}
              </td>
              <td className="px-4 py-3 text-text-secondary">{formatDate(pos.date)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={pos.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
