import { useState } from 'react';
import { cn } from '../../lib/utils';

type ItemType = 'action' | 'alert' | 'insight';
type FilterTab = 'all' | 'actions' | 'alerts' | 'insights';
type IconName = 'rebalance' | 'dollar' | 'box' | 'warehouse' | 'clock' | 'trending' | 'bubble' | 'trending-up';

interface DataRow {
  label: string;
  value: string;
  highlight?: boolean;
}

interface RecommendationItem {
  id: string;
  type: ItemType;
  title: string;
  time: string;
  icon: IconName;
  description: string;
  data?: DataRow[];
  primaryAction: string;
}

const items: RecommendationItem[] = [
  {
    id: 'act-1',
    type: 'action',
    title: 'Rebalance Portfolio',
    time: 'Just now',
    icon: 'rebalance',
    description: 'Tech allocation exceeds 45% target by 8.2%. Consider trimming NVDA and MSFT to rebalance.',
    data: [
      { label: 'Current Tech %', value: '53.2%', highlight: true },
      { label: 'Target', value: '45%' },
    ],
    primaryAction: 'View Details',
  },
  {
    id: 'act-2',
    type: 'action',
    title: 'Review Tax-Loss Harvest',
    time: '2m',
    icon: 'dollar',
    description: 'You have 3 positions with unrealized losses eligible for tax-loss harvesting before quarter end.',
    data: [
      { label: 'Eligible Amount', value: '$4,280', highlight: true },
      { label: 'Positions', value: '3' },
    ],
    primaryAction: 'Review Positions',
  },
  {
    id: 'act-3',
    type: 'action',
    title: 'Review Stop Loss Orders',
    time: '15m',
    icon: 'box',
    description: 'META approaching -8% drawdown threshold. Current stop loss may trigger within the session.',
    data: [
      { label: 'Current Drawdown', value: '-7.4%', highlight: true },
      { label: 'Stop Loss At', value: '-8%' },
    ],
    primaryAction: 'Adjust Orders',
  },
  {
    id: 'alt-1',
    type: 'alert',
    title: 'Concentration Risk Exceeded',
    time: '5m',
    icon: 'warehouse',
    description: 'NVDA position now represents 18% of portfolio. Single-stock concentration limit is 15%.',
    data: [
      { label: 'NVDA Weight', value: '18.3%', highlight: true },
      { label: 'Limit', value: '15%' },
    ],
    primaryAction: 'View Details',
  },
  {
    id: 'alt-2',
    type: 'alert',
    title: 'Earnings Report in 3 Days',
    time: '30m',
    icon: 'clock',
    description: 'AAPL reports earnings Thursday after market close. Current position: 150 shares.',
    primaryAction: 'View Details',
  },
  {
    id: 'ins-1',
    type: 'insight',
    title: 'Demand Spike Detected',
    time: '2m',
    icon: 'trending',
    description:
      'Unusual volume spike detected in semiconductor sector. NVDA, AMD, AVGO all showing 2x average volume.',
    primaryAction: 'Explore',
  },
  {
    id: 'ins-2',
    type: 'insight',
    title: 'Correlation Shift: MSFT-GOOGL',
    time: '1h',
    icon: 'bubble',
    description: 'MSFT and GOOGL 30-day correlation dropped from 0.92 to 0.67. Diversification benefit increasing.',
    data: [
      { label: 'Previous Correlation', value: '0.92' },
      { label: 'Current Correlation', value: '0.67', highlight: true },
    ],
    primaryAction: 'Analyze',
  },
  {
    id: 'ins-3',
    type: 'insight',
    title: 'Sector Rotation Trending',
    time: '3h',
    icon: 'trending-up',
    description: 'Capital flowing from growth to value sectors over the past 2 weeks. Your portfolio is growth-heavy.',
    primaryAction: 'Explore',
  },
];

const typeLabel: Record<ItemType, string> = {
  action: 'ACTION',
  alert: 'ALERT',
  insight: 'INSIGHT',
};

const typeLabelColor: Record<ItemType, string> = {
  action: 'text-accent-primary',
  alert: 'text-warning',
  insight: 'text-success',
};

const typeIconBg: Record<ItemType, string> = {
  action: 'bg-accent-primary/12',
  alert: 'bg-warning/12',
  insight: 'bg-success/12',
};

const typeIconColor: Record<ItemType, string> = {
  action: 'text-accent-primary',
  alert: 'text-warning',
  insight: 'text-success',
};

const sectionHeaderColor: Record<ItemType, string> = {
  action: 'text-accent-primary/60',
  alert: 'text-warning/60',
  insight: 'text-success/60',
};

const sectionLineColor: Record<ItemType, string> = {
  action: 'bg-accent-primary/15',
  alert: 'bg-warning/15',
  insight: 'bg-success/15',
};

const dataAccentBorder: Record<ItemType, string> = {
  action: 'border-accent-primary/30',
  alert: 'border-warning/30',
  insight: 'border-success/30',
};

const filterTabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'actions', label: 'Actions' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'insights', label: 'Insights' },
];

const filterMap: Record<FilterTab, ItemType | null> = {
  all: null,
  actions: 'action',
  alerts: 'alert',
  insights: 'insight',
};

function ItemIcon({ icon, type }: { icon: IconName; type: ItemType }) {
  const svgClass = cn('h-4 w-4', typeIconColor[type]);

  const icons: Record<IconName, React.ReactNode> = {
    rebalance: (
      <svg
        className={svgClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 2v6h-6" />
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M3 22v-6h6" />
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      </svg>
    ),
    dollar: (
      <svg
        className={svgClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
    box: (
      <svg
        className={svgClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
    warehouse: (
      <svg
        className={svgClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" />
        <path d="M6 18h12" />
        <path d="M6 14h12" />
        <rect x="6" y="10" width="12" height="12" rx="1" />
      </svg>
    ),
    clock: (
      <svg
        className={svgClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    trending: (
      <svg
        className={svgClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </svg>
    ),
    bubble: (
      <svg
        className={svgClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        <path d="M8 12h.01" />
        <path d="M12 12h.01" />
        <path d="M16 12h.01" />
      </svg>
    ),
    'trending-up': (
      <svg
        className={svgClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 17 17 7" />
        <polyline points="7 7 17 7 17 17" />
      </svg>
    ),
  };

  return (
    <div className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl', typeIconBg[type])}>
      {icons[icon]}
    </div>
  );
}

function SectionHeader({ type }: { type: ItemType }) {
  return (
    <div className="flex items-center gap-2.5 px-1 pt-4 pb-2">
      <span className={cn('text-[10px] font-semibold tracking-[0.1em] uppercase', sectionHeaderColor[type])}>
        {typeLabel[type]}s
      </span>
      <div className={cn('h-px flex-1', sectionLineColor[type])} />
    </div>
  );
}

function RecommendationCard({
  item,
  expanded,
  onToggle,
}: {
  item: RecommendationItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        'rounded-xl bg-bg-tertiary/60 transition-colors cursor-pointer',
        expanded ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary',
      )}
    >
      {/* Collapsed header — always visible */}
      <div className="flex items-center gap-3 px-3 py-2.5" onClick={onToggle}>
        <ItemIcon icon={item.icon} type={item.type} />
        <div className="min-w-0 flex-1">
          <span className={cn('text-[10px] font-semibold tracking-wide uppercase', typeLabelColor[item.type])}>
            {typeLabel[item.type]}
          </span>
          <p className="text-[13px] font-medium leading-tight text-text-primary truncate">{item.title}</p>
        </div>
        <span className="flex-shrink-0 text-[11px] text-text-muted">{item.time}</span>
      </div>

      {/* Expanded content */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-0.5">
            {/* Description */}
            <p className="text-xs leading-relaxed text-text-secondary">{item.description}</p>

            {/* Data table */}
            {item.data && (
              <div className={cn('mt-2.5 border-l-2 pl-3 py-1.5', dataAccentBorder[item.type])}>
                {item.data.map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-0.5">
                    <span className="text-xs text-text-muted">{row.label}</span>
                    <span
                      className={cn('text-xs font-medium', row.highlight ? 'text-accent-primary' : 'text-text-primary')}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-3 flex gap-2">
              <button className="flex-1 rounded-lg border border-border bg-transparent px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary">
                Dismiss
              </button>
              <button className="flex-1 rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-secondary">
                {item.primaryAction}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RecommendationsPanel() {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredItems = filterMap[activeFilter] ? items.filter((item) => item.type === filterMap[activeFilter]) : items;

  const totalCount = filteredItems.length;

  // Group filtered items by type, preserving section order
  const sections: { type: ItemType; items: RecommendationItem[] }[] = [];
  const typeOrder: ItemType[] = ['action', 'alert', 'insight'];

  for (const type of typeOrder) {
    const typeItems = filteredItems.filter((item) => item.type === type);
    if (typeItems.length > 0) {
      sections.push({ type, items: typeItems });
    }
  }

  return (
    <aside className="flex w-[320px] flex-shrink-0 flex-col overflow-hidden border-l border-border bg-bg-secondary">
      {/* Header */}
      <div className="px-4 pt-3.5 pb-1">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium tracking-wide text-text-secondary uppercase">Recommendations</h2>
          <span className="text-[11px] tabular-nums text-text-muted">{totalCount} items</span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-0.5 border-b border-border px-4 pt-2">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={cn(
              'relative px-2.5 pb-2 text-xs font-medium transition-colors',
              activeFilter === tab.key ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary',
            )}
          >
            {tab.label}
            {activeFilter === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-text-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto px-3 pb-4">
        {sections.map((section) => (
          <div key={section.type}>
            <SectionHeader type={section.type} />
            <div className="space-y-1.5">
              {section.items.map((item) => (
                <RecommendationCard
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
