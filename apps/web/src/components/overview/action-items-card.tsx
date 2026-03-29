import { Link } from 'react-router';
import { DashboardCard } from '../common/dashboard-card';
import type { PortfolioItem } from '../../api/types';

export function ActionItemsCard({ items }: { items: PortfolioItem[] }) {
  if (items.length === 0) return null;

  const viewAllLink = (
    <Link to="/insights" className="text-2xs text-accent-primary transition-colors hover:text-accent-primary/80">
      View All
    </Link>
  );

  return (
    <DashboardCard title="Action Items" headerAction={viewAllLink}>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-text-primary leading-relaxed">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
              {item.text}
            </li>
          ))}
        </ul>
      </div>
    </DashboardCard>
  );
}
