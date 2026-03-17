import { cn } from '../../lib/utils';

type FilterStatus = 'all' | 'holding' | 'watching' | 'pending' | 'sold';

interface FilterTabsProps {
  activeFilter: FilterStatus;
  onChange: (filter: FilterStatus) => void;
  counts: Record<FilterStatus, number>;
}

const filters: FilterStatus[] = ['all', 'holding', 'watching', 'pending', 'sold'];

export default function FilterTabs({ activeFilter, onChange, counts }: FilterTabsProps) {
  return (
    <div className="flex gap-1 rounded-lg bg-bg-tertiary/50 p-1">
      {filters.map((filter) => (
        <button
          key={filter}
          onClick={() => onChange(filter)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            activeFilter === filter
              ? 'border border-border bg-bg-card text-text-primary'
              : 'border border-transparent text-text-muted hover:text-text-secondary',
          )}
        >
          {filter.charAt(0).toUpperCase() + filter.slice(1)} ({counts[filter]})
        </button>
      ))}
    </div>
  );
}

export type { FilterStatus };
