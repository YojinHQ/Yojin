import { cn } from '../../lib/utils';

interface StatCard {
  label: string;
  value: string;
  change: string | null;
  positive?: boolean;
}

const stats: StatCard[] = [
  { label: 'Total Value', value: '$124,850.32', change: null },
  { label: "Today's P&L", value: '+$1,245.67', change: '+1.01%', positive: true },
  { label: 'Total Return', value: '+$18,432.10', change: '+17.3%', positive: true },
  { label: 'Trades Today', value: '3', change: null },
  { label: 'Positions', value: '12', change: null },
  { label: 'Accounts', value: '2', change: null },
];

export default function PortfolioValueStrip() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted">{stat.label}</p>
          <p className="mt-2 text-xl font-semibold text-text-primary">{stat.value}</p>
          {stat.change && (
            <p className={cn('mt-1 text-sm', stat.positive ? 'text-success' : 'text-error')}>{stat.change}</p>
          )}
        </div>
      ))}
    </div>
  );
}
