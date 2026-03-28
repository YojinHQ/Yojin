import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from 'urql';
import { DISMISS_SIGNAL_MUTATION, INTEL_FEED_QUERY, REFRESH_INTEL_FEED_MUTATION } from '../../api/documents';
import type { IntelFeedQueryResult, IntelFeedQueryVariables, RefreshIntelFeedMutationResult } from '../../api/types';
import { cn, timeAgo } from '../../lib/utils';
import Spinner from '../common/spinner';

type ItemType = 'action' | 'alert' | 'insight';
type FilterTab = 'all' | 'actions' | 'alerts' | 'insights';
type IconName = 'rebalance' | 'dollar' | 'box' | 'warehouse' | 'clock' | 'trending' | 'bubble' | 'trending-up';

interface DataRow {
  label: string;
  value: string;
  highlight?: boolean;
}

interface IntelFeedItem {
  id: string;
  type: ItemType;
  title: string;
  time: string;
  icon: IconName;
  description: string;
  data?: DataRow[];
  primaryAction: string;
}

/** Map signal type to an icon name. */
const signalTypeIcon: Record<string, IconName> = {
  NEWS: 'trending',
  FUNDAMENTAL: 'dollar',
  TECHNICAL: 'trending-up',
  MACRO: 'warehouse',
  SENTIMENT: 'bubble',
  FILINGS: 'box',
  SOCIALS: 'bubble',
  TRADING_LOGIC_TRIGGER: 'clock',
};

/** Classify a signal using its outputType field. */
function classifySignal(signal: { outputType?: string | null }): ItemType {
  if (signal.outputType === 'ALERT') return 'alert';
  if (signal.outputType === 'ACTION') return 'action';
  return 'insight';
}

/** Primary action label for each item type. */
const primaryActionLabel: Record<ItemType, string> = {
  action: 'Review',
  alert: 'View Details',
  insight: 'Explore',
};

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
  action: 'bg-accent-primary/10',
  alert: 'bg-warning/10',
  insight: 'bg-success/10',
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
  const svgClass = cn('h-3.5 w-3.5', typeIconColor[type]);

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
    <div className={cn('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg', typeIconBg[type])}>
      {icons[icon]}
    </div>
  );
}

function SectionHeader({ type }: { type: ItemType }) {
  return (
    <div className="flex items-center gap-2.5 px-1 pt-4 pb-2">
      <span className={cn('text-2xs font-semibold tracking-[0.1em] uppercase', sectionHeaderColor[type])}>
        {typeLabel[type]}s
      </span>
      <div className={cn('h-px flex-1', sectionLineColor[type])} />
    </div>
  );
}

function IntelFeedCard({
  item,
  expanded,
  onToggle,
  onDismiss,
  onExplore,
}: {
  item: IntelFeedItem;
  expanded: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  onExplore: () => void;
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
          <span className={cn('text-2xs font-semibold tracking-wide uppercase', typeLabelColor[item.type])}>
            {typeLabel[item.type]}
          </span>
          <p className="text-xs font-medium leading-tight text-text-primary truncate">{item.title}</p>
        </div>
        <span className="flex-shrink-0 text-2xs text-text-muted">{item.time}</span>
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
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss();
                }}
                className="flex-1 cursor-pointer rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                Dismiss
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExplore();
                }}
                className="flex-1 cursor-pointer rounded-lg bg-accent-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-secondary"
              >
                {item.primaryAction}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function IntelFeed() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, dismissSignal] = useMutation(DISMISS_SIGNAL_MUTATION);
  const [, refreshIntelFeed] = useMutation<RefreshIntelFeedMutationResult>(REFRESH_INTEL_FEED_MUTATION);

  const [{ data, fetching, error }, reexecute] = useQuery<IntelFeedQueryResult, IntelFeedQueryVariables>({
    query: INTEL_FEED_QUERY,
    variables: { limit: 30 },
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshIntelFeed({});
      reexecute({ requestPolicy: 'network-only' });
    } finally {
      setRefreshing(false);
    }
  };

  // Map API data into IntelFeedItem[]
  const items: IntelFeedItem[] = useMemo(() => {
    if (!data) return [];

    const signalItems: IntelFeedItem[] = data.curatedSignals.map((cs) => {
      const s = cs.signal;
      const itemType = classifySignal(s);
      const topScore =
        cs.scores.length > 0
          ? cs.scores.reduce((best, sc) => (sc.compositeScore > best.compositeScore ? sc : best), cs.scores[0])
          : null;
      return {
        id: s.id,
        type: itemType,
        title: s.title,
        time: timeAgo(s.publishedAt),
        icon: signalTypeIcon[s.type] ?? 'trending',
        description: s.tier1 ?? s.title,
        data:
          s.tickers.length > 0
            ? [
                { label: 'Tickers', value: s.tickers.join(', ') },
                { label: 'Confidence', value: `${Math.round(s.confidence * 100)}%`, highlight: s.confidence >= 0.8 },
                ...(topScore
                  ? [
                      {
                        label: 'Relevance',
                        value: `${Math.round(topScore.compositeScore * 100)}%`,
                        highlight: topScore.compositeScore >= 0.6,
                      },
                    ]
                  : []),
              ]
            : undefined,
        primaryAction: primaryActionLabel[itemType],
      };
    });

    const actionItems: IntelFeedItem[] = data.actions.map((a) => ({
      id: a.id,
      type: 'action' as const,
      title: a.what,
      time: timeAgo(a.createdAt),
      icon: 'rebalance' as const,
      description: a.why,
      data: [
        { label: 'Source', value: a.source },
        { label: 'Expires', value: timeAgo(a.expiresAt) },
      ],
      primaryAction: 'Review',
    }));

    return [...actionItems, ...signalItems];
  }, [data]);

  const filteredItems = filterMap[activeFilter] ? items.filter((item) => item.type === filterMap[activeFilter]) : items;

  const totalCount = filteredItems.length;

  // Group filtered items by type, preserving section order
  const sections: { type: ItemType; items: IntelFeedItem[] }[] = [];
  const typeOrder: ItemType[] = ['action', 'alert', 'insight'];

  for (const type of typeOrder) {
    const typeItems = filteredItems.filter((item) => item.type === type);
    if (typeItems.length > 0) {
      sections.push({ type, items: typeItems });
    }
  }

  // Determine content state
  const isLoading = fetching && !data;
  const hasError = !!error;
  const isEmpty = !fetching && !error && items.length === 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3.5 pb-1">
        <div className="flex items-center justify-between">
          <h2 className="text-2xs font-medium tracking-wide text-text-secondary uppercase">Intel Feed</h2>
          <div className="flex items-center gap-2">
            <span className="text-2xs tabular-nums text-text-muted">{totalCount} items</span>
            <button
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              title="Fetch latest signals and curate"
              className={cn(
                'cursor-pointer rounded p-0.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary',
                refreshing && 'animate-spin',
              )}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M21.015 4.356v4.992"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-0.5 border-b border-border px-4 pt-2">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={cn(
              'relative px-2 pb-2 text-2xs font-medium transition-colors',
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

      {/* Refreshing banner */}
      {refreshing && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-2xs text-accent-primary">
          <Spinner size="sm" />
          <span>Fetching signals and curating...</span>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto px-3 pb-4">
        {isLoading ? (
          <div className="flex items-center justify-center pt-12">
            <Spinner size="md" label="Loading intel..." />
          </div>
        ) : hasError ? (
          <div className="flex flex-col items-center justify-center gap-3 pt-12 text-center">
            <svg
              className="h-7 w-7 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
            <div>
              <p className="text-sm text-text-muted">Failed to load intel</p>
              <p className="mt-1 text-xs text-text-muted">{error.message}</p>
            </div>
            <button
              onClick={() => reexecute({ requestPolicy: 'network-only' })}
              className="mt-1 cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              Retry
            </button>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-3 pt-12 text-center">
            <svg
              className="h-7 w-7 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-text-secondary">No intel yet</p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                Click refresh to fetch signals from your data sources and curate them against your portfolio.
              </p>
            </div>
            <button
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="mt-1 cursor-pointer rounded-lg bg-accent-primary px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-secondary disabled:opacity-50"
            >
              {refreshing ? 'Refreshing...' : 'Refresh Intel'}
            </button>
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.type}>
              <SectionHeader type={section.type} />
              <div className="space-y-1.5">
                {section.items.map((item) => (
                  <IntelFeedCard
                    key={item.id}
                    item={item}
                    expanded={expandedId === item.id}
                    onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    onDismiss={() => {
                      if (expandedId === item.id) setExpandedId(null);
                      void dismissSignal({ signalId: item.id }).then(() =>
                        reexecute({ requestPolicy: 'network-only' }),
                      );
                    }}
                    onExplore={() => void navigate(`/signals?id=${item.id}`)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
