import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'urql';
import { DISMISS_SIGNAL_MUTATION, INTEL_FEED_QUERY } from '../../api/documents';
import type { IntelFeedQueryResult, IntelFeedQueryVariables } from '../../api/types';
import { cn, safeHref, timeAgo } from '../../lib/utils';
import { useFeatureStatus } from '../../lib/feature-status';
import { CardBlurGate } from '../common/card-blur-gate';
import { FeatureCardGate } from '../common/feature-gate';
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
  signalType: string;
  ticker: string;
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
  verdict: 'CRITICAL' | 'IMPORTANT' | 'NOISE' | null;
  thesisAlignment: 'SUPPORTS' | 'CHALLENGES' | 'NEUTRAL' | null;
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

/** Human-readable label for each signal type. */
const signalTypeLabel: Record<string, string> = {
  NEWS: 'News',
  FUNDAMENTAL: 'Fundamental',
  TECHNICAL: 'Technical',
  MACRO: 'Macro',
  SENTIMENT: 'Sentiment',
  FILINGS: 'Filing',
  SOCIALS: 'Social',
  TRADING_LOGIC_TRIGGER: 'Trigger',
};

/** Tailwind color class for each signal type badge. */
const signalTypeBadgeColor: Record<string, string> = {
  NEWS: 'bg-text-muted/10 text-text-muted',
  FUNDAMENTAL: 'bg-info/10 text-info',
  TECHNICAL: 'bg-accent-primary/10 text-accent-primary',
  MACRO: 'bg-warning/10 text-warning',
  SENTIMENT: 'bg-success/10 text-success',
  FILINGS: 'bg-info/10 text-info',
  SOCIALS: 'bg-accent-primary/10 text-accent-primary',
  TRADING_LOGIC_TRIGGER: 'bg-warning/10 text-warning',
};

/** Classify a signal using its outputType field. */
function classifySignal(signal: { outputType?: string | null }): ItemType {
  if (signal.outputType === 'ALERT') return 'alert';
  return 'insight';
}

const dataAccentBorder: Record<ItemType, string> = {
  alert: 'border-warning/30',
  insight: 'border-success/30',
};

const filterTabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'insights', label: 'Insights' },
];

const filterMap: Record<FilterTab, ItemType | null> = {
  all: null,
  alerts: 'alert',
  insights: 'insight',
};

const sentimentIconColor: Record<string, string> = {
  BULLISH: 'text-success',
  BEARISH: 'text-error',
  MIXED: 'text-warning',
  NEUTRAL: 'text-text-muted',
};

const sentimentIconBg: Record<string, string> = {
  BULLISH: 'bg-success/10',
  BEARISH: 'bg-error/10',
  MIXED: 'bg-warning/10',
  NEUTRAL: 'bg-bg-hover',
};

function ItemIcon({ icon, sentiment }: { icon: IconName; sentiment: string | null }) {
  const svgClass = cn('h-3.5 w-3.5', sentimentIconColor[sentiment ?? 'NEUTRAL'] ?? 'text-text-muted');

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
    <div
      className={cn(
        'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg',
        sentimentIconBg[sentiment ?? 'NEUTRAL'] ?? 'bg-bg-hover',
      )}
    >
      {icons[icon]}
    </div>
  );
}

type Sentiment = 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL';

const sentimentColor: Record<Sentiment, string> = {
  BULLISH: 'text-success',
  BEARISH: 'text-error',
  MIXED: 'text-warning',
  NEUTRAL: 'text-text-secondary',
};

const sentimentLineColor: Record<Sentiment, string> = {
  BULLISH: 'bg-success/20',
  BEARISH: 'bg-error/20',
  MIXED: 'bg-warning/20',
  NEUTRAL: 'bg-border',
};

const sentimentIcon: Record<Sentiment, React.ReactNode> = {
  BULLISH: (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  ),
  BEARISH: (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
      <polyline points="16 17 22 17 22 11" />
    </svg>
  ),
  MIXED: (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  NEUTRAL: (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  ),
};

/** Determine the dominant sentiment from a group of items. */
function dominantSentiment(items: IntelFeedItem[]): Sentiment {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const s = item.sentiment ?? 'NEUTRAL';
    counts[s] = (counts[s] ?? 0) + 1;
  }
  let best = 'NEUTRAL';
  let bestCount = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best as Sentiment;
}

function TickerSectionHeader({
  ticker,
  alertCount,
  itemCount,
  sentiment,
  collapsed,
  onToggle,
}: {
  ticker: string;
  alertCount: number;
  itemCount: number;
  sentiment: Sentiment;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button onClick={onToggle} className="flex w-full cursor-pointer items-center gap-2.5 px-1 pt-4 pb-2 text-left">
      <svg
        className={cn('h-3 w-3 transition-transform', sentimentColor[sentiment], collapsed ? '-rotate-90' : 'rotate-0')}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
      <span className={cn('text-2xs font-semibold tracking-[0.1em] uppercase', sentimentColor[sentiment])}>
        {ticker}
      </span>
      <span className={cn('flex items-center', sentimentColor[sentiment])}>{sentimentIcon[sentiment]}</span>
      {alertCount > 0 && (
        <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
          {alertCount} {alertCount === 1 ? 'alert' : 'alerts'}
        </span>
      )}
      <span className="text-[10px] tabular-nums text-text-muted">{itemCount}</span>
      <div className={cn('h-px flex-1', sentimentLineColor[sentiment])} />
    </button>
  );
}

function IntelFeedCard({
  item,
  expanded,
  isNew,
  onToggle,
  onDismiss,
}: {
  item: IntelFeedItem;
  expanded: boolean;
  isNew?: boolean;
  onToggle: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className={cn(
        'rounded-xl bg-bg-tertiary/60 transition-colors cursor-pointer',
        expanded ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary',
        isNew && 'animate-new-item',
      )}
    >
      {/* Collapsed header — always visible */}
      <div className="flex items-center gap-3 px-3 py-2.5" onClick={onToggle}>
        <ItemIcon icon={item.icon} sentiment={item.sentiment} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none uppercase tracking-wide',
                signalTypeBadgeColor[item.signalType] ?? 'bg-text-muted/10 text-text-muted',
              )}
            >
              {signalTypeLabel[item.signalType] ?? item.signalType}
            </span>
            {item.type === 'alert' && (
              <span className="text-2xs font-semibold tracking-wide uppercase text-warning">ALERT</span>
            )}
            {item.verdict && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none',
                  item.verdict === 'CRITICAL' && 'bg-error/20 text-error',
                  item.verdict === 'IMPORTANT' && 'bg-warning/20 text-warning',
                  item.verdict === 'NOISE' && 'bg-text-muted/10 text-text-muted',
                )}
              >
                {item.verdict}
              </span>
            )}
          </div>
          <p className="text-xs font-medium leading-tight text-text-primary line-clamp-2">{item.title}</p>
        </div>
        <span className="flex-shrink-0 text-2xs text-text-muted">{item.publishedTime}</span>
      </div>

      {/* Expanded content — show both dates */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-0.5">
            {/* Description */}
            {item.description && <p className="text-xs leading-relaxed text-text-secondary">{item.description}</p>}
            {item.source && <p className="mt-1 text-[10px] text-text-muted">via {item.source}</p>}
            <p className="mt-1 text-[10px] text-text-muted">
              Published {item.publishedTime} · Updated {item.time}
            </p>

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

            {/* Actions row */}
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss();
                }}
                className="cursor-pointer rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                Dismiss
              </button>
              {item.link && (
                <a
                  href={safeHref(item.link, '#')}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto flex items-center gap-1 text-xs text-accent-primary transition-colors hover:text-accent-primary/80"
                >
                  View source
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function IntelFeed() {
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

  return <IntelFeedContent />;
}

const POLL_INTERVAL_MS = 30_000;
const NEW_ITEM_GLOW_MS = 3_000;

function IntelFeedContent() {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsedTickers, setCollapsedTickers] = useState<Set<string>>(new Set());
  const [, dismissSignal] = useMutation(DISMISS_SIGNAL_MUTATION);
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const glowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [{ data, fetching, error }, reexecute] = useQuery<IntelFeedQueryResult, IntelFeedQueryVariables>({
    query: INTEL_FEED_QUERY,
    variables: { limit: 10 },
    requestPolicy: 'network-only',
  });

  // Poll for new data
  useEffect(() => {
    const id = setInterval(() => reexecute({ requestPolicy: 'network-only' }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [reexecute]);

  // Detect new items and trigger glow animation
  const detectNewItems = useCallback((currentIds: string[]) => {
    if (knownIdsRef.current.size === 0) {
      // First load — seed known IDs without animation
      knownIdsRef.current = new Set(currentIds);
      return;
    }

    const fresh = currentIds.filter((id) => !knownIdsRef.current.has(id));
    if (fresh.length === 0) return;

    knownIdsRef.current = new Set(currentIds);
    setNewItemIds(new Set(fresh));

    // Clear glow after animation — cancel previous timer to avoid race condition
    if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
    glowTimerRef.current = setTimeout(() => setNewItemIds(new Set()), NEW_ITEM_GLOW_MS);
  }, []);

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
      const sourceName = s.sources?.[0]?.name;
      const ticker = topScore?.ticker ?? s.tickers[0] ?? 'MACRO';
      // Prefer LLM summaries; fall back to raw title (which is unique per signal)
      const headline = s.tier1 ?? s.title;
      const detail = s.tier2 ?? (s.tier1 ? s.title : '');
      return {
        id: s.id,
        type: itemType,
        signalType: s.type,
        ticker,
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
        verdict: cs.verdict ?? null,
        thesisAlignment: cs.thesisAlignment ?? null,
      };
    });

    // Sort by newest ingested date first
    signalItems.sort((a, b) => new Date(b.ingestedAt).getTime() - new Date(a.ingestedAt).getTime());
    return signalItems;
  }, [data]);

  // Detect new items for glow animation
  useEffect(() => {
    if (items.length > 0) detectNewItems(items.map((i) => i.id));
  }, [items, detectNewItems]);

  const filteredItems = filterMap[activeFilter] ? items.filter((item) => item.type === filterMap[activeFilter]) : items;

  const totalCount = filteredItems.length;

  // Group filtered items by ticker, preserving order of first appearance (highest score first)
  const tickerSections: { ticker: string; items: IntelFeedItem[] }[] = [];
  const tickerMap = new Map<string, IntelFeedItem[]>();

  for (const item of filteredItems) {
    const group = tickerMap.get(item.ticker);
    if (group) {
      group.push(item);
    } else {
      const newGroup = [item];
      tickerMap.set(item.ticker, newGroup);
      tickerSections.push({ ticker: item.ticker, items: newGroup });
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
          <span className="text-2xs tabular-nums text-text-muted">{totalCount} items</span>
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
                Intel signals will appear here once your data sources are configured and the curation pipeline runs.
              </p>
            </div>
          </div>
        ) : (
          tickerSections.map((section) => {
            const isCollapsed = collapsedTickers.has(section.ticker);
            return (
              <div key={section.ticker}>
                <TickerSectionHeader
                  ticker={section.ticker}
                  alertCount={section.items.filter((i) => i.type === 'alert').length}
                  itemCount={section.items.length}
                  sentiment={dominantSentiment(section.items)}
                  collapsed={isCollapsed}
                  onToggle={() => {
                    setCollapsedTickers((prev) => {
                      const next = new Set(prev);
                      if (next.has(section.ticker)) {
                        next.delete(section.ticker);
                      } else {
                        next.add(section.ticker);
                      }
                      return next;
                    });
                  }}
                />
                {!isCollapsed && (
                  <div className="space-y-1.5">
                    {section.items.map((item) => (
                      <IntelFeedCard
                        key={item.id}
                        item={item}
                        expanded={expandedId === item.id}
                        isNew={newItemIds.has(item.id)}
                        onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                        onDismiss={() => {
                          if (expandedId === item.id) setExpandedId(null);
                          void dismissSignal({ signalId: item.id }).then(() =>
                            reexecute({ requestPolicy: 'network-only' }),
                          );
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Mock Intel Feed ────────────────────────────────────────

const MOCK_INTEL = [
  {
    ticker: 'NVDA',
    sentiment: 'BULLISH',
    items: [
      { type: 'alert' as const, signal: 'News', title: 'NVDA beats Q4 earnings estimates by 12%', time: '2h ago' },
      {
        type: 'insight' as const,
        signal: 'Technical',
        title: 'RSI breakout above 70, momentum strong',
        time: '4h ago',
      },
    ],
  },
  {
    ticker: 'AAPL',
    sentiment: 'BEARISH',
    items: [
      { type: 'alert' as const, signal: 'News', title: 'Supply chain delays in China operations', time: '3h ago' },
      { type: 'insight' as const, signal: 'Fundamental', title: 'Revenue growth slowing vs consensus', time: '6h ago' },
    ],
  },
  {
    ticker: 'BTC',
    sentiment: 'BULLISH',
    items: [
      { type: 'insight' as const, signal: 'Sentiment', title: 'Social volume spike: +340% in 24h', time: '1h ago' },
    ],
  },
];

function MockIntelFeed() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Filter tabs */}
      <div className="flex gap-0.5 border-b border-border px-4 pt-2">
        {['All', 'Alerts', 'Insights'].map((tab, i) => (
          <div
            key={tab}
            className={cn('relative px-2 pb-2 text-2xs font-medium', i === 0 ? 'text-text-primary' : 'text-text-muted')}
          >
            {tab}
            {i === 0 && <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-text-primary" />}
          </div>
        ))}
      </div>

      {/* Mock items */}
      <div className="flex-1 overflow-hidden px-3 pb-4">
        {MOCK_INTEL.map((section) => (
          <div key={section.ticker}>
            <div className="flex items-center gap-2.5 px-1 pt-4 pb-2">
              <span
                className={cn(
                  'text-2xs font-semibold tracking-[0.1em] uppercase',
                  section.sentiment === 'BULLISH' ? 'text-success' : 'text-error',
                )}
              >
                {section.ticker}
              </span>
              <span className="text-[10px] tabular-nums text-text-muted">{section.items.length}</span>
              <div className={cn('h-px flex-1', section.sentiment === 'BULLISH' ? 'bg-success/20' : 'bg-error/20')} />
            </div>
            <div className="space-y-1.5">
              {section.items.map((item, i) => (
                <div key={i} className="rounded-xl bg-bg-tertiary/60 px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'text-2xs font-semibold tracking-wide uppercase',
                        item.type === 'alert' ? 'text-warning' : 'text-success',
                      )}
                    >
                      {item.type === 'alert' ? 'ALERT' : 'INSIGHT'}
                    </span>
                    <span className="rounded-full bg-text-muted/10 px-1.5 py-0.5 text-[9px] font-medium text-text-muted">
                      {item.signal}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs font-medium leading-tight text-text-primary">{item.title}</p>
                  <span className="text-2xs text-text-muted">{item.time}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
