import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from 'urql';
import { DISMISS_SIGNAL_MUTATION, INTEL_FEED_QUERY } from '../../api/documents';
import type { FeedTarget, IntelFeedQueryResult, IntelFeedQueryVariables } from '../../api/types';
import { cn, timeAgo } from '../../lib/utils';
import { useFeatureStatus } from '../../lib/feature-status';
import Button from '../common/button';
import { CardBlurGate } from '../common/card-blur-gate';
import { FeatureCardGate } from '../common/feature-gate';
import FeedDetailModal from './feed-detail-modal';
import type { FeedDetailData } from './feed-detail-modal';
import Spinner from '../common/spinner';

type ItemType = 'alert' | 'insight';
type FilterTab = 'all' | 'alerts' | 'insights';
type IconName = 'rebalance' | 'dollar' | 'box' | 'warehouse' | 'clock' | 'trending' | 'bubble' | 'trending-up';

interface DataRow {
  label: string;
  value: string;
  highlight?: boolean;
}

interface IntelFeedItem {
  id: string;
  type: ItemType;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  signalType: string;
  ticker: string;
  tickers: string[];
  sentiment: string | null;
  title: string;
  time: string;
  publishedAt: string;
  ingestedAt: string;
  publishedTime: string;
  icon: IconName;
  description: string;
  source: string | null;
  link: string | null;
  data?: DataRow[];
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

/** Promote higher-severity items into the alerts lane. */
function classifySignal(signal: { outputType?: string | null; severity: IntelFeedItem['severity'] }): ItemType {
  if (signal.severity === 'CRITICAL' || signal.severity === 'HIGH') return 'alert';
  if (signal.outputType === 'ALERT') return 'alert';
  return 'insight';
}

const categoryIconBg: Record<ItemType, { default: string; expanded: string }> = {
  alert: { default: 'bg-warning/10', expanded: 'bg-warning/20' },
  insight: { default: 'bg-success/10', expanded: 'bg-success/20' },
};

const categoryIconText: Record<ItemType, string> = {
  alert: 'text-warning',
  insight: 'text-success',
};

const categoryLabel: Record<ItemType, string> = {
  alert: 'ALERT',
  insight: 'INSIGHT',
};

const filterTabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'insights', label: 'Insights' },
];

/* ── Icons ──────────────────────────────────────────────────────────── */

function ItemIcon({ icon, type, expanded }: { icon: IconName; type: ItemType; expanded: boolean }) {
  const strokeWidth = expanded ? '2.5' : '2';
  const svgClass = cn('h-3.5 w-3.5', categoryIconText[type]);

  const icons: Record<IconName, React.ReactNode> = {
    rebalance: (
      <svg
        className={svgClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
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
        strokeWidth={strokeWidth}
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
        strokeWidth={strokeWidth}
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
        strokeWidth={strokeWidth}
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
        strokeWidth={strokeWidth}
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
        strokeWidth={strokeWidth}
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
        strokeWidth={strokeWidth}
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
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 17 17 7" />
        <polyline points="7 7 17 7 17 17" />
      </svg>
    ),
  };

  return (
    <div
      className={cn(
        'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
        expanded ? categoryIconBg[type].expanded : categoryIconBg[type].default,
      )}
    >
      {icons[icon]}
    </div>
  );
}

function AgentIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
      />
    </svg>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-2.5 px-1 pt-4">
      <span className="whitespace-nowrap text-2xs font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/* ── Card ──────────────────────────────────────────────────────────── */

function IntelFeedCard({
  item,
  expanded,
  onToggle,
  onDismiss,
  onViewDetails,
  onAskYojin,
}: {
  item: IntelFeedItem;
  expanded: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  onViewDetails: () => void;
  onAskYojin: () => void;
}) {
  return (
    <div
      className={cn(
        'relative rounded-xl border border-border-light bg-bg-tertiary/60 transition-colors',
        expanded ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary',
      )}
    >
      {/* Collapsed header — always visible */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left"
      >
        <ItemIcon icon={item.icon} type={item.type} expanded={expanded} />
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              'inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-[0.08em]',
              item.type === 'alert' ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success',
            )}
          >
            {item.ticker}
          </span>
          <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-text-primary">{item.title}</p>
        </div>
        <span className="flex-shrink-0 text-2xs text-text-muted">{item.publishedTime}</span>
      </button>

      {/* Expanded content */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-0.5">
            {item.description && (
              <p className="line-clamp-5 text-xs leading-relaxed text-text-secondary">{item.description}</p>
            )}

            {/* Meta row */}
            <div className="mt-2 flex items-center gap-x-2 rounded-lg border border-border-light bg-bg-primary/50 px-2.5 py-1.5 text-2xs text-text-muted">
              {item.source && <span>{item.source}</span>}
              {item.source && <span className="text-border">|</span>}
              <span>{timeAgo(item.ingestedAt)}</span>
              <span className="text-border">|</span>
              <span>{item.signalType.replace(/_/g, ' ')}</span>
            </div>

            {/* CTA buttons */}
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDetails();
                }}
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7 17 17 7M7 7h10v10" />
                </svg>
                View
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onAskYojin();
                }}
              >
                <AgentIcon />
                Chat
              </Button>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss();
                }}
                className="ml-auto cursor-pointer rounded-lg border border-error/30 bg-error/10 px-2.5 py-1 text-xs font-medium text-error transition-colors hover:bg-error/20"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Gate wrapper ───────────────────────────────────────────────────── */

export default function IntelFeed({ feedTarget }: { feedTarget?: FeedTarget } = {}) {
  const { jintelConfigured, aiConfigured } = useFeatureStatus();

  if (!jintelConfigured || !aiConfigured) {
    const requirement = !jintelConfigured ? (!aiConfigured ? 'both' : 'jintel') : 'ai';
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-text-primary">Intel Feed</h2>
        </div>
        <CardBlurGate mockContent={<MockIntelFeed />}>
          <FeatureCardGate requires={requirement} />
        </CardBlurGate>
      </div>
    );
  }

  return <IntelFeedContent feedTarget={feedTarget} />;
}

/* ── Content ────────────────────────────────────────────────────────── */

const POLL_INTERVAL_MS = 30_000;

function IntelFeedContent({ feedTarget }: { feedTarget?: FeedTarget }) {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modalData, setModalData] = useState<FeedDetailData | null>(null);
  const [, dismissSignal] = useMutation(DISMISS_SIGNAL_MUTATION);

  const [{ data, fetching, error }, reexecute] = useQuery<IntelFeedQueryResult, IntelFeedQueryVariables>({
    query: INTEL_FEED_QUERY,
    variables: { limit: 20, feedTarget },
    requestPolicy: 'network-only',
  });

  // Poll for new data
  useEffect(() => {
    const id = setInterval(() => reexecute({ requestPolicy: 'network-only' }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [reexecute]);

  // Map API data into IntelFeedItem[]
  const items: IntelFeedItem[] = useMemo(() => {
    if (!data) return [];

    const signalItems: IntelFeedItem[] = data.curatedSignals.map((cs) => {
      const s = cs.signal;
      const severity = cs.severity ?? 'LOW';
      const itemType = classifySignal({ outputType: s.outputType, severity });
      const topScore =
        cs.scores.length > 0
          ? cs.scores.reduce((best, sc) => (sc.compositeScore > best.compositeScore ? sc : best), cs.scores[0])
          : null;
      const sourceName = s.sources?.[0]?.name;
      const ticker = topScore?.ticker ?? s.tickers[0] ?? 'MACRO';
      const headline = s.tier1 ?? s.title;
      const detail = s.content ?? s.tier2 ?? '';
      return {
        id: s.id,
        type: itemType,
        severity,
        signalType: s.type,
        ticker,
        tickers: s.tickers,
        sentiment: s.sentiment ?? null,
        title: headline,
        time: timeAgo(s.ingestedAt),
        publishedAt: s.publishedAt,
        ingestedAt: s.ingestedAt,
        publishedTime: timeAgo(s.publishedAt),
        icon: signalTypeIcon[s.type] ?? 'trending',
        description: detail !== headline ? detail : '',
        source: sourceName ?? null,
        link: s.link ?? null,
        data:
          s.tickers.length > 0
            ? [
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
      };
    });

    // Sort newest first
    signalItems.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    return signalItems;
  }, [data]);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return items;
    return items.filter((item) => item.type === (activeFilter === 'alerts' ? 'alert' : 'insight'));
  }, [items, activeFilter]);
  const totalCount = filteredItems.length;

  function openModal(item: IntelFeedItem) {
    setModalData({
      title: item.title,
      source: item.source ?? item.signalType,
      time: item.publishedTime,
      link: item.link,
      tag: categoryLabel[item.type],
      tagVariant: item.type === 'alert' ? 'warning' : 'success',
      sentiment:
        item.sentiment === 'bullish' || item.sentiment === 'bearish' || item.sentiment === 'neutral'
          ? item.sentiment
          : undefined,
      confidence: (() => {
        const row = item.data?.find((r) => r.label === 'Confidence');
        return row ? Math.round(parseFloat(row.value)) : undefined;
      })(),
      keyPoints: item.description ? [item.description] : [],
      analysis: item.description || item.title,
      relatedTickers: item.tickers,
    });
  }

  const isLoading = fetching && !data;
  const hasError = !!error;
  const isEmpty = !fetching && !error && filteredItems.length === 0;

  return (
    <>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-bg-secondary">
          <div className="flex items-center gap-2.5 px-4 pt-4 pb-1.5">
            <h2 className="font-headline text-base text-text-primary">Intel Feed</h2>
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-bg-tertiary px-1.5 text-[10px] font-bold text-text-secondary">
              {totalCount}
            </span>
          </div>

          <div className="flex gap-5 border-b border-border px-4">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveFilter(tab.key);
                  setExpandedId(null);
                }}
                className={cn(
                  'relative cursor-pointer pb-2.5 pt-1.5 text-xs font-medium transition-colors',
                  activeFilter === tab.key ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {tab.label}
                {activeFilter === tab.key && (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-accent-primary" />
                )}
              </button>
            ))}
          </div>
        </div>

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
                  d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-text-secondary">
                  {activeFilter === 'all' ? 'No intel yet' : `No ${activeFilter} yet`}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">
                  Intel signals will appear here once your data sources are configured and the curation pipeline runs.
                </p>
              </div>
            </div>
          ) : (
            <div>
              <SectionHeader
                label={activeFilter === 'all' ? 'All' : activeFilter === 'alerts' ? 'Alerts' : 'Insights'}
              />
              <div className="space-y-2">
                {filteredItems.map((item) => (
                  <IntelFeedCard
                    key={item.id}
                    item={item}
                    expanded={expandedId === item.id}
                    onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    onDismiss={() => {
                      if (expandedId === item.id) setExpandedId(null);
                      void dismissSignal({ signalId: item.id }).then((result) => {
                        if (result.error) {
                          console.error('Dismiss failed', result.error.message);
                          return;
                        }
                        reexecute({ requestPolicy: 'network-only' });
                      });
                    }}
                    onViewDetails={() => openModal(item)}
                    onAskYojin={() =>
                      navigate('/chat', {
                        state: {
                          newSession: true,
                          preset: `Analyze this ${categoryLabel[item.type].toLowerCase()}: "${item.title}"${item.description ? ` — ${item.description}` : ''}`,
                        },
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <FeedDetailModal open={modalData !== null} onClose={() => setModalData(null)} data={modalData} />
    </>
  );
}

/* ── Mock Intel Feed (blur gate preview) ────────────────────────────── */

const MOCK_ALERTS = [
  { icon: 'trending' as IconName, ticker: 'NVDA', title: 'NVDA beats Q4 earnings estimates by 12%', time: '2h ago' },
  { icon: 'dollar' as IconName, ticker: 'AAPL', title: 'Supply chain delays in China operations', time: '3h ago' },
];

function MockIntelFeed() {
  return (
    <div aria-hidden="true" className="pointer-events-none select-none flex flex-1 flex-col overflow-hidden">
      {/* Mock header */}
      <div className="sticky top-0 z-10 bg-bg-secondary">
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-1.5">
          <span className="font-headline text-base text-text-primary">Intel Feed</span>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-bg-tertiary px-1.5 text-[10px] font-bold text-text-secondary">
            {MOCK_ALERTS.length}
          </span>
        </div>
        <div className="flex gap-5 border-b border-border px-4">
          {(['All', 'Alerts', 'Insights'] as const).map((tab, i) => (
            <div
              key={tab}
              className={cn(
                'relative pb-2.5 pt-1.5 text-xs font-medium',
                i === 0 ? 'text-text-primary' : 'text-text-muted',
              )}
            >
              {tab}
              {i === 0 && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-accent-primary" />}
            </div>
          ))}
        </div>
      </div>

      {/* Mock alerts */}
      <div className="flex-1 overflow-hidden px-3 pb-4">
        <div className="mb-2.5 flex items-center gap-2.5 px-1 pt-4">
          <span className="whitespace-nowrap text-2xs font-semibold uppercase tracking-[0.12em] text-text-muted">
            All
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="space-y-2">
          {MOCK_ALERTS.map((item, i) => (
            <div key={i} className="rounded-xl border border-border-light bg-bg-tertiary/60 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-warning/10">
                  <div className="h-3 w-3 rounded-sm bg-warning/30" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="inline-block rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-[0.08em] text-warning">
                    {item.ticker}
                  </span>
                  <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-text-primary">{item.title}</p>
                </div>
                <span className="flex-shrink-0 text-2xs text-text-muted">{item.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
