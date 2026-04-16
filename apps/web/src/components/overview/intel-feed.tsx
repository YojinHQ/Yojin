import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from 'urql';
import {
  ACTIONS_QUERY,
  BATCH_DISMISS_SIGNALS_MUTATION,
  DISMISS_ACTION_MUTATION,
  DISMISS_SIGNAL_MUTATION,
  INTEL_FEED_QUERY,
  SCHEDULER_STATUS_QUERY,
  TRIGGER_MICRO_ANALYSIS_MUTATION,
} from '../../api/documents';
import type {
  ActionsQueryResult,
  ActionsQueryVariables,
  FeedTarget,
  IntelFeedQueryResult,
  IntelFeedQueryVariables,
  SchedulerStatusQueryResult,
  TriggerStrength,
  ConvictionLevel,
} from '../../api/types';
import { cn, timeAgo } from '../../lib/utils';
import { useFeatureStatus } from '../../lib/feature-status';
import Button from '../common/button';
import { CardBlurGate } from '../common/card-blur-gate';
import { FeatureCardGate } from '../common/feature-gate';
import FeedDetailModal from './feed-detail-modal';
import type { FeedDetailData } from './feed-detail-modal';
import Spinner from '../common/spinner';
import { SymbolLogo } from '../common/symbol-logo';

type ItemType = 'alert' | 'insight' | 'action' | 'data';
type FilterTab = 'all' | 'alerts' | 'insights' | 'actions';
type IconName = 'rebalance' | 'dollar' | 'box' | 'warehouse' | 'clock' | 'trending' | 'bubble' | 'trending-up' | 'zap';

export interface FeedPendingUpdate {
  symbol: string;
  action: 'added' | 'removed';
}

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
  summary?: string | null;
  isAction?: boolean;
  verdict?: 'BUY' | 'SELL' | 'REVIEW';
  sizeGuidance?: string;
  triggerStrength?: TriggerStrength;
  strategyName?: string;
  riskContext?: string;
  expiresAt?: string;
  suggestedQuantity?: number | null;
  suggestedValue?: number | null;
  currentPrice?: number | null;
  entryRange?: string | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  horizon?: string | null;
  conviction?: ConvictionLevel | null;
  maxEntry?: number | null;
  catalystImpact?: string | null;
  pricedIn?: boolean | null;
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
  REGULATORY: 'box',
  TRADING_LOGIC_TRIGGER: 'clock',
  ACTION: 'zap',
};

/** Promote higher-severity items into the alerts lane.
 * Only CRITICAL signals and explicit SUMMARY outputs qualify as alerts —
 * HIGH signals remain visible as prominent insights but don't clutter the alerts tab.
 *
 * Signals sourced purely from Jintel ENRICHMENT (ownership breakdowns, fundamentals
 * snapshots, technicals readings) are raw data points, not synthesized insights, so
 * they classify as 'data' and stay out of the Insights tab. */
function classifySignal(signal: {
  outputType?: string | null;
  severity: IntelFeedItem['severity'];
  sources?: { type?: string | null }[];
}): ItemType {
  if (signal.severity === 'CRITICAL') return 'alert';
  if (signal.outputType === 'SUMMARY') return 'alert';
  const sources = signal.sources ?? [];
  if (sources.length > 0 && sources.every((s) => s.type === 'ENRICHMENT')) return 'data';
  return 'insight';
}

const categoryLabel: Record<ItemType, string> = {
  alert: 'ALERT',
  insight: 'INSIGHT',
  action: 'ACTION',
  data: 'DATA',
};

const filterTabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'insights', label: 'Insights' },
  { key: 'actions', label: 'Actions' },
];

/* ── Icons ──────────────────────────────────────────────────────────── */

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

function SectionHeader({
  label,
  selectMode,
  selectedCount,
  onSelectToggle,
  onDismissSelected,
}: {
  label: string;
  selectMode: boolean;
  selectedCount: number;
  onSelectToggle: () => void;
  onDismissSelected: () => void;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-2.5 px-1 pt-4">
      <span className="whitespace-nowrap text-2xs font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
      {selectMode ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSelectToggle}
            className="cursor-pointer rounded-md border border-border bg-bg-secondary px-2.5 py-1 text-2xs font-semibold uppercase tracking-[0.08em] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDismissSelected}
            disabled={selectedCount === 0}
            className="cursor-pointer rounded-md border border-error/40 bg-error/15 px-2.5 py-1 text-2xs font-semibold uppercase tracking-[0.08em] text-error transition-colors hover:bg-error/25 disabled:cursor-default disabled:opacity-40"
          >
            Dismiss{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelectToggle}
          className="cursor-pointer whitespace-nowrap text-2xs font-semibold uppercase tracking-[0.12em] text-text-muted transition-colors hover:text-text-secondary"
        >
          Select
        </button>
      )}
    </div>
  );
}

/* ── Last update label ──────────────────────────────────────────────── */

function LastUpdateLabel({ ingestedAt }: { ingestedAt: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return <>Last Update: {timeAgo(ingestedAt)}</>;
}

/* ── Card ──────────────────────────────────────────────────────────── */

function IntelFeedCard({
  item,
  expanded,
  isNew,
  selectMode,
  selected,
  onToggle,
  onToggleSelect,
  onDismiss,
  onViewDetails,
  onAskYojin,
}: {
  item: IntelFeedItem;
  expanded: boolean;
  isNew: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onToggleSelect: () => void;
  onDismiss: () => void;
  onViewDetails: () => void;
  onAskYojin: () => void;
}) {
  return (
    <div
      className={cn(
        'relative rounded-xl border transition-colors',
        selected
          ? 'border-accent-primary/40 bg-accent-primary/5'
          : item.verdict === 'BUY'
            ? 'border-success/30 bg-success/[0.06]'
            : item.verdict === 'SELL'
              ? 'border-error/30 bg-error/[0.06]'
              : 'border-border-light bg-bg-tertiary/60',
        !selectMode && (expanded ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'),
        isNew &&
          (item.type === 'alert' ? 'motion-safe:animate-new-event-alert' : 'motion-safe:animate-new-event-insight'),
      )}
    >
      {isNew && (
        <span
          className={cn(
            'absolute -top-2 -right-2 z-10 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wider text-white shadow-sm motion-safe:animate-badge-in',
            item.verdict === 'BUY'
              ? 'bg-success'
              : item.verdict === 'SELL'
                ? 'bg-error'
                : item.type === 'alert'
                  ? 'bg-warning'
                  : 'bg-success',
          )}
        >
          {item.verdict ?? 'NEW'}
        </span>
      )}
      {/* Collapsed header — always visible */}
      <div className="flex w-full items-center gap-3 px-3 py-4">
        <button
          type="button"
          aria-expanded={selectMode ? undefined : expanded}
          aria-pressed={selectMode ? selected : undefined}
          aria-label={selectMode ? `${selected ? 'Deselect' : 'Select'} ${item.title}` : undefined}
          onClick={selectMode ? onToggleSelect : onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
        >
          <SymbolLogo symbol={item.ticker} size="sm" className="flex-shrink-0" />
          <div className="min-w-0 flex-1">
            {item.verdict && (
              <span
                className={cn(
                  'mb-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wider',
                  item.verdict === 'BUY'
                    ? 'bg-success/15 text-success'
                    : item.verdict === 'SELL'
                      ? 'bg-error/15 text-error'
                      : 'bg-info/15 text-info',
                )}
              >
                {item.verdict}
              </span>
            )}
            <p className="line-clamp-2 text-sm font-medium leading-snug text-text-primary">{item.title}</p>
          </div>
          {selectMode ? (
            <div
              className={cn(
                'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors',
                selected
                  ? 'border-accent-primary bg-accent-primary'
                  : 'border-border bg-transparent hover:border-text-muted',
              )}
            >
              {selected && (
                <svg
                  className="h-2.5 w-2.5 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
            </div>
          ) : (
            <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
              <span className="inline-block rounded bg-bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-[0.08em] text-text-muted">
                {item.signalType.replace(/_/g, ' ')}
              </span>
              <span className="text-2xs text-text-muted">{item.publishedTime}</span>
            </div>
          )}
        </button>
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
            {(item.summary || item.description) && (
              <p className="line-clamp-3 text-xs leading-relaxed text-text-secondary">
                {item.summary ?? item.description}
              </p>
            )}

            {item.sizeGuidance && (
              <div
                className={cn(
                  'mt-2 rounded-md border px-2.5 py-1.5 text-xs font-medium',
                  item.verdict === 'BUY'
                    ? 'border-success/30 bg-success/10 text-success'
                    : item.verdict === 'SELL'
                      ? 'border-error/30 bg-error/10 text-error'
                      : 'border-border-light bg-bg-primary/50 text-text-secondary',
                )}
              >
                <span className="mr-1.5 text-2xs font-bold uppercase tracking-wider opacity-70">Size</span>
                {item.sizeGuidance}
              </div>
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

export default function IntelFeed({
  feedTarget,
  pendingUpdate,
  onScanComplete,
}: {
  feedTarget?: FeedTarget;
  pendingUpdate?: FeedPendingUpdate | null;
  onScanComplete?: () => void;
} = {}) {
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

  return <IntelFeedContent feedTarget={feedTarget} pendingUpdate={pendingUpdate} onScanComplete={onScanComplete} />;
}

/* ── Content ────────────────────────────────────────────────────────── */

const POLL_INTERVAL_MS = 30_000;
// v2: bumped alongside the FETCH_LIMIT=100 rollout so old 20-item snapshots
// don't classify backlog items 21–100 as "new" on first refresh (which would
// spuriously light up the NEW badge and the important-signals pill).
const SEEN_IDS_KEY_PREFIX = 'intel-feed-seen-v2-';
const PAGE_SIZE = 20;
const FETCH_LIMIT = 100;

function persistSeenIds(key: string, ids: Set<string>) {
  try {
    sessionStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // sessionStorage unavailable or quota exceeded
  }
}

function IntelFeedContent({
  feedTarget,
  pendingUpdate,
  onScanComplete,
}: {
  feedTarget?: FeedTarget;
  pendingUpdate?: FeedPendingUpdate | null;
  onScanComplete?: () => void;
}) {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modalData, setModalData] = useState<FeedDetailData | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const initialIdsRef = useRef<Set<string> | null>(null);
  const newIdTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [, dismissSignal] = useMutation(DISMISS_SIGNAL_MUTATION);
  const [, dismissAction] = useMutation(DISMISS_ACTION_MUTATION);
  const [, batchDismissSignals] = useMutation(BATCH_DISMISS_SIGNALS_MUTATION);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Scan lifecycle state ────────────────────────────────────────────
  const [scanState, setScanState] = useState<{
    symbol: string;
    phase: 'scanning' | 'found' | 'not-found';
    foundCount: number;
  } | null>(null);
  const scanPreIdsRef = useRef<Set<string> | null>(null);
  const scanStartTimeRef = useRef(0);
  const scanVerifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScanCompleteRef = useRef(onScanComplete);
  useEffect(() => {
    onScanCompleteRef.current = onScanComplete;
  });
  const latestItemsRef = useRef<IntelFeedItem[]>([]);

  // Restore seen IDs from sessionStorage so remounts don't lose the snapshot
  const storageKey = `${SEEN_IDS_KEY_PREFIX}${feedTarget ?? 'default'}`;
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        initialIdsRef.current = new Set(JSON.parse(stored) as string[]);
      }
    } catch {
      // sessionStorage unavailable
    }
  }, [storageKey]);

  const [{ data, fetching, error }, reexecute] = useQuery<IntelFeedQueryResult, IntelFeedQueryVariables>({
    query: INTEL_FEED_QUERY,
    variables: { limit: FETCH_LIMIT, feedTarget },
    requestPolicy: 'cache-and-network',
  });

  const actionQueryVars = useMemo<ActionsQueryVariables>(
    () => ({ status: 'PENDING', limit: FETCH_LIMIT, dismissed: false }),
    [],
  );
  const [{ data: actionsData, error: actionsError }, reexecuteActions] = useQuery<
    ActionsQueryResult,
    ActionsQueryVariables
  >({
    query: ACTIONS_QUERY,
    variables: actionQueryVars,
    requestPolicy: 'cache-and-network',
  });

  // Client-side pagination — backend returns up to FETCH_LIMIT, we show
  // PAGE_SIZE at a time and reveal more via an IntersectionObserver sentinel.
  const [displayedCount, setDisplayedCount] = useState(PAGE_SIZE);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  // "N new important signals" pill — tracks HIGH/CRITICAL signals that arrived
  // after the initial load but haven't been seen yet (user is scrolled away
  // from the top). Click the pill → smooth-scroll to top and mark as seen.
  const [unseenImportantIds, setUnseenImportantIds] = useState<Set<string>>(new Set());
  const [isScrolledDown, setIsScrolledDown] = useState(false);
  const unseenImportantRef = useRef(unseenImportantIds);
  useEffect(() => {
    unseenImportantRef.current = unseenImportantIds;
  }, [unseenImportantIds]);

  const [{ data: schedulerData }, reexecuteScheduler] = useQuery<SchedulerStatusQueryResult>({
    query: SCHEDULER_STATUS_QUERY,
    requestPolicy: 'cache-and-network',
  });
  const [, triggerMicroAnalysis] = useMutation(TRIGGER_MICRO_ANALYSIS_MUTATION);

  // Auto-trigger micro analysis when user is actively using the page and assets are throttled.
  // Fires at most once per configured LLM interval — the server re-checks pendingAnalysis before
  // running, so a stale trigger (assets already analyzed) is always a no-op.
  const lastTriggeredRef = useRef<number>(0);
  useEffect(() => {
    if (!schedulerData || schedulerData.schedulerStatus.pendingCount === 0) return;

    const intervalMs = schedulerData.schedulerStatus.microLlmIntervalHours * 60 * 60 * 1000;

    function onActivity() {
      const now = Date.now();
      if (now - lastTriggeredRef.current < intervalMs) return;
      lastTriggeredRef.current = now;
      void triggerMicroAnalysis({});
    }

    window.addEventListener('mousemove', onActivity);
    window.addEventListener('mousedown', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('touchstart', onActivity);
    return () => {
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('mousedown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('touchstart', onActivity);
    };
  }, [schedulerData, triggerMicroAnalysis]);

  // Refetch when watchlist changes (add/remove)
  useEffect(() => {
    if (pendingUpdate) {
      reexecute({ requestPolicy: 'network-only' });
    }
  }, [pendingUpdate, reexecute]);

  // Poll for new data
  useEffect(() => {
    const id = setInterval(() => {
      reexecute({ requestPolicy: 'network-only' });
      reexecuteActions({ requestPolicy: 'network-only' });
      reexecuteScheduler({ requestPolicy: 'network-only' });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [reexecute, reexecuteActions, reexecuteScheduler]);

  // Map API data into IntelFeedItem[]
  const items: IntelFeedItem[] = useMemo(() => {
    const signalItems: IntelFeedItem[] = (data?.curatedSignals ?? []).map((cs) => {
      const s = cs.signal;
      const severity = cs.severity ?? 'LOW';
      const itemType = classifySignal({ outputType: s.outputType, severity, sources: s.sources });
      const topScore =
        cs.scores.length > 0
          ? cs.scores.reduce((best, sc) => (sc.compositeScore > best.compositeScore ? sc : best), cs.scores[0])
          : null;
      const sourceName = s.sources?.[0]?.name;
      const ticker = topScore?.ticker ?? s.tickers[0] ?? 'MACRO';
      const headline = s.tier1 ?? s.title;
      const detail = s.tier2 ?? s.content ?? '';
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

    const actionItems: IntelFeedItem[] = (actionsData?.actions ?? []).map((action) => ({
      id: `action:${action.id}`,
      type: 'action' as const,
      severity: action.severityLabel as IntelFeedItem['severity'],
      signalType: 'ACTION',
      ticker: action.tickers[0] ?? action.strategyName,
      tickers: action.tickers,
      sentiment: null,
      title: action.what,
      time: timeAgo(action.createdAt),
      publishedAt: action.createdAt,
      ingestedAt: action.createdAt,
      publishedTime: timeAgo(action.createdAt),
      icon: 'zap' as IconName,
      description: action.why,
      summary: action.summary,
      source: action.strategyName,
      link: null,
      isAction: true,
      verdict: action.verdict,
      triggerStrength: action.triggerStrength,
      strategyName: action.strategyName,
      riskContext: action.riskContext ?? undefined,
      expiresAt: action.expiresAt,
      sizeGuidance: action.sizeGuidance ?? undefined,
      suggestedQuantity: action.suggestedQuantity,
      suggestedValue: action.suggestedValue,
      currentPrice: action.currentPrice,
      entryRange: action.entryRange,
      targetPrice: action.targetPrice,
      stopLoss: action.stopLoss,
      horizon: action.horizon,
      conviction: action.conviction,
      maxEntry: action.maxEntry,
      catalystImpact: action.catalystImpact,
      pricedIn: action.pricedIn,
    }));

    const merged = [...signalItems, ...actionItems];
    merged.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    return merged;
  }, [data, actionsData]);

  useEffect(() => {
    latestItemsRef.current = items;
  }, [items]);

  // Track which items are "new" (arrived after initial load)
  useEffect(() => {
    if (items.length === 0) return;

    // First data load — snapshot IDs, no animation
    if (initialIdsRef.current === null) {
      initialIdsRef.current = new Set(items.map((i) => i.id));
      persistSeenIds(storageKey, initialIdsRef.current);
      return;
    }

    const seenIds = initialIdsRef.current;
    const freshIdSet = new Set(items.filter((i) => !seenIds.has(i.id)).map((i) => i.id));

    // Always sync current items into the stored set
    for (const item of items) seenIds.add(item.id);
    persistSeenIds(storageKey, seenIds);

    if (freshIdSet.size === 0) return;

    // Mark as new (for the 10s "NEW" badge animation)
    setNewIds((prev) => {
      const next = new Set(prev);
      for (const id of freshIdSet) next.add(id);
      return next;
    });

    // Surface HIGH/CRITICAL freshly-arrived signals in the "N new" pill, but
    // only if the user is actually scrolled away from the top — otherwise
    // they can already see the new item land and don't need a pill reminder.
    // Reading scrollTop directly (rather than the debounced isScrolledDown
    // state) avoids a race where fresh items arrive before the scroll
    // handler has fired for the current viewport.
    const isAwayFromTop = (scrollContainerRef.current?.scrollTop ?? 0) > 100;
    if (isAwayFromTop) {
      const importantFresh = items.filter(
        (i) => freshIdSet.has(i.id) && (i.severity === 'CRITICAL' || i.severity === 'HIGH'),
      );
      if (importantFresh.length > 0) {
        setUnseenImportantIds((prev) => {
          const next = new Set(prev);
          for (const i of importantFresh) next.add(i.id);
          return next;
        });
      }
    }
    const freshIds = [...freshIdSet];

    // Clear badge after 10s
    for (const id of freshIds) {
      const prev = newIdTimersRef.current.get(id);
      if (prev) clearTimeout(prev);
      const timer = setTimeout(() => {
        setNewIds((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
        newIdTimersRef.current.delete(id);
      }, 10_000);
      newIdTimersRef.current.set(id, timer);
    }
  }, [items, storageKey]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = newIdTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  // ── Scan: initialize when a new symbol is added ─────────────────────
  useEffect(() => {
    if (pendingUpdate?.action !== 'added') return;
    scanPreIdsRef.current = new Set(latestItemsRef.current.map((i) => i.id));
    scanStartTimeRef.current = Date.now();
    setTimeout(() => setScanState({ symbol: pendingUpdate.symbol, phase: 'scanning', foundCount: 0 }), 0);
    if (scanVerifyTimerRef.current) {
      clearTimeout(scanVerifyTimerRef.current);
      scanVerifyTimerRef.current = null;
    }
  }, [pendingUpdate]);

  // ── Scan: fast polling while scanning ───────────────────────────────
  const isScanning = scanState?.phase === 'scanning';
  useEffect(() => {
    if (!isScanning) return;
    const id = setInterval(() => reexecute({ requestPolicy: 'network-only' }), 4_000);
    return () => clearInterval(id);
  }, [isScanning, reexecute]);

  // ── Scan: detect new items or timeout ───────────────────────────────
  useEffect(() => {
    if (!scanState || scanState.phase !== 'scanning' || !scanPreIdsRef.current) return;
    const preScanIds = scanPreIdsRef.current;
    const newForSymbol = items.filter(
      (i) => !preScanIds.has(i.id) && (i.tickers.includes(scanState.symbol) || i.ticker === scanState.symbol),
    );
    if (newForSymbol.length > 0) {
      setScanState((prev) => (prev ? { ...prev, phase: 'found', foundCount: newForSymbol.length } : null));
      scanPreIdsRef.current = null;
      scanVerifyTimerRef.current = setTimeout(() => {
        setScanState(null);
        onScanCompleteRef.current?.();
        scanVerifyTimerRef.current = null;
      }, 3_000);
      return;
    }
    if (Date.now() - scanStartTimeRef.current > 45_000) {
      setScanState((prev) => (prev ? { ...prev, phase: 'not-found' } : null));
      scanPreIdsRef.current = null;
      scanVerifyTimerRef.current = setTimeout(() => {
        setScanState(null);
        onScanCompleteRef.current?.();
        scanVerifyTimerRef.current = null;
      }, 3_000);
    }
  }, [items, scanState]);

  // Cleanup scan verification timer on unmount
  useEffect(() => {
    return () => {
      if (scanVerifyTimerRef.current) clearTimeout(scanVerifyTimerRef.current);
    };
  }, []);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return items;
    if (activeFilter === 'alerts') return items.filter((item) => item.type === 'alert');
    if (activeFilter === 'insights') return items.filter((item) => item.type === 'insight');
    if (activeFilter === 'actions') return items.filter((item) => item.type === 'action');
    return items;
  }, [items, activeFilter]);
  const totalCount = filteredItems.length;

  // Reset the visible page (and the unseen-important pill) when the user
  // switches filter or feed target — a tab switch is a "fresh view", jumping
  // back to the most-important items. Uses the React "store info from
  // previous renders" pattern to avoid an effect-driven reset that would
  // trip `react-hooks/set-state-in-effect`.
  const [prevViewKey, setPrevViewKey] = useState(`${activeFilter}|${feedTarget ?? ''}`);
  const viewKey = `${activeFilter}|${feedTarget ?? ''}`;
  if (viewKey !== prevViewKey) {
    setPrevViewKey(viewKey);
    setDisplayedCount(PAGE_SIZE);
    setUnseenImportantIds(new Set());
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  // Jump the scroll container back to the top on view change. Without this,
  // the sentinel can still be in the IntersectionObserver root margin and
  // immediately re-grow `displayedCount`, so the intended reset to PAGE_SIZE
  // would never visually "stick".
  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [viewKey]);

  // Track whether the scroll container is scrolled away from the top. This
  // drives the "N new important signals" pill visibility and auto-dismisses
  // the pill when the user scrolls back to the top.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const scrolled = el.scrollTop > 100;
      setIsScrolledDown(scrolled);
      if (!scrolled && unseenImportantRef.current.size > 0) {
        setUnseenImportantIds(new Set());
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  function scrollToTopAndDismiss() {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setUnseenImportantIds(new Set());
  }

  const visibleItems = useMemo(() => filteredItems.slice(0, displayedCount), [filteredItems, displayedCount]);
  const hasMore = displayedCount < filteredItems.length;

  // IntersectionObserver sentinel — bump displayedCount by PAGE_SIZE as the
  // sentinel scrolls into view. Scoped to the scroll container so it doesn't
  // fire when the sentinel is offscreen behind other content.
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = loadMoreSentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setDisplayedCount((c) => c + PAGE_SIZE);
        }
      },
      { root, rootMargin: '200px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore]);

  function openModal(item: IntelFeedItem) {
    const displaySource = item.isAction ? (item.strategyName ?? 'Action') : (item.source ?? item.signalType);
    setModalData({
      title: item.title,
      source: displaySource,
      time: item.publishedTime,
      link: item.link,
      tag: item.verdict ?? categoryLabel[item.type],
      tagVariant:
        item.verdict === 'BUY'
          ? 'success'
          : item.verdict === 'SELL'
            ? 'error'
            : item.verdict === 'REVIEW'
              ? 'info'
              : item.type === 'alert'
                ? 'warning'
                : 'success',
      sentiment:
        item.sentiment === 'bullish' || item.sentiment === 'bearish' || item.sentiment === 'neutral'
          ? item.sentiment
          : undefined,
      confidence: (() => {
        const row = item.data?.find((r) => r.label === 'Confidence');
        return row ? Math.round(parseFloat(row.value)) : undefined;
      })(),
      triggerStrength: item.triggerStrength,
      keyPoints: item.isAction ? [] : item.description ? [item.description] : [],
      analysis: item.isAction ? item.description || '' : item.description || item.title,
      verdict: item.verdict,
      relatedTickers: item.tickers,
      actionMeta: item.isAction
        ? {
            strategyName: item.strategyName ?? null,
            severity: item.severity,
            riskContext: item.riskContext ?? null,
            expiresAt: item.expiresAt ?? '',
            sizeGuidance: item.sizeGuidance ?? null,
            suggestedQuantity: item.suggestedQuantity,
            suggestedValue: item.suggestedValue,
            currentPrice: item.currentPrice,
            entryRange: item.entryRange ?? null,
            targetPrice: item.targetPrice ?? null,
            stopLoss: item.stopLoss ?? null,
            horizon: item.horizon ?? null,
            conviction: item.conviction ?? null,
            maxEntry: item.maxEntry ?? null,
            catalystImpact: item.catalystImpact ?? null,
            pricedIn: item.pricedIn ?? null,
          }
        : undefined,
    });
  }

  const isLoading = fetching && !data;
  const hasError = !!(error || actionsError);
  const isEmpty = !fetching && !hasError && filteredItems.length === 0;

  const latestItem = useMemo(
    () => (items.length > 0 ? items.reduce((a, b) => (a.ingestedAt > b.ingestedAt ? a : b)) : null),
    [items],
  );

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
            {latestItem && (
              <Link
                to="/settings#intelligence-schedule"
                className="ml-auto text-[10px] font-medium uppercase tracking-wider text-text-muted transition-colors hover:text-text-secondary"
              >
                <LastUpdateLabel ingestedAt={latestItem.ingestedAt} />
              </Link>
            )}
          </div>

          <div className="flex gap-5 border-b border-border px-4">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveFilter(tab.key);
                  setExpandedId(null);
                  setSelectMode(false);
                  setSelectedIds(new Set());
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

          {(() => {
            const s = schedulerData?.schedulerStatus;
            if (!s?.lastLlmError || !s.lastLlmErrorAt) return null;
            if (s.lastLlmSuccessAt && s.lastLlmErrorAt <= s.lastLlmSuccessAt) return null;
            return (
              <div className="mx-4 mt-2 mb-1 flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-[11px] text-warning">
                <span className="mt-px shrink-0">⚠</span>
                <span>
                  AI analysis paused — credentials may be invalid.{' '}
                  <Link to="/settings#ai-provider" className="underline hover:text-text-primary">
                    Check Settings
                  </Link>
                </span>
              </div>
            );
          })()}
        </div>

        {/* Scrollable content */}
        <div ref={scrollContainerRef} className="flex-1 overflow-auto px-3 pb-4">
          {/* "N new important signals" pill — shown only while the user is
              scrolled away from the top, and never on the Insights tab
              (HIGH/CRITICAL items classify as alerts, so clicking the CTA
              there would scroll to a list that can't contain the announced
              items). Click to jump back and mark as seen. */}
          {unseenImportantIds.size > 0 && isScrolledDown && activeFilter !== 'insights' && (
            <div className="pointer-events-none sticky top-2 z-20 flex justify-center">
              <button
                type="button"
                onClick={scrollToTopAndDismiss}
                className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-full bg-accent-primary px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-lg transition-transform hover:scale-105 motion-safe:animate-[fadeSlideIn_0.25s_ease-out]"
                aria-label={`Jump to ${unseenImportantIds.size} new important signal${unseenImportantIds.size !== 1 ? 's' : ''}`}
              >
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="18 15 12 9 6 15" />
                </svg>
                {unseenImportantIds.size} new important signal{unseenImportantIds.size !== 1 ? 's' : ''}
              </button>
            </div>
          )}
          {/* Scan progress / verification banner */}
          {scanState && (
            <div
              key={`scan-${scanState.phase}`}
              className={cn(
                'mx-0.5 mt-3 flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs font-medium motion-safe:animate-[fadeSlideIn_0.25s_ease-out]',
                scanState.phase === 'scanning'
                  ? 'border-accent-primary/20 bg-accent-primary/5 text-accent-primary'
                  : scanState.phase === 'found'
                    ? 'border-success/20 bg-success/5 text-success'
                    : 'border-border-light bg-bg-tertiary text-text-secondary',
              )}
            >
              {scanState.phase === 'scanning' && (
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary animate-pulse" />
              )}
              {scanState.phase === 'found' && (
                <svg
                  className="h-3.5 w-3.5 flex-shrink-0 text-success"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              <span>
                {scanState.phase === 'scanning'
                  ? `Scanning intel for ${scanState.symbol}\u2026`
                  : scanState.phase === 'found'
                    ? `Found ${scanState.foundCount} new item${scanState.foundCount !== 1 ? 's' : ''} for ${scanState.symbol}`
                    : `No new intel found for ${scanState.symbol}`}
              </span>
            </div>
          )}
          {/* Removal banner */}
          {pendingUpdate?.action === 'removed' && (
            <div className="mx-0.5 mt-3 flex items-center gap-2.5 rounded-lg border border-border-light bg-bg-tertiary px-3 py-2 text-xs font-medium text-text-secondary motion-safe:animate-[fadeSlideIn_0.25s_ease-out]">
              <span>{pendingUpdate.symbol} removed from feed</span>
            </div>
          )}
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
                <p className="mt-1 text-xs text-text-muted">{(error ?? actionsError)?.message}</p>
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
                label={
                  activeFilter === 'all'
                    ? 'All'
                    : activeFilter === 'alerts'
                      ? 'Alerts'
                      : activeFilter === 'actions'
                        ? 'Actions'
                        : 'Insights'
                }
                selectMode={selectMode}
                selectedCount={selectedIds.size}
                onSelectToggle={() => {
                  setSelectMode((prev) => !prev);
                  setSelectedIds(new Set());
                  setExpandedId(null);
                }}
                onDismissSelected={() => {
                  const ids = [...selectedIds];
                  const actionIds = ids
                    .filter((id) => id.startsWith('action:'))
                    .map((id) => id.replace(/^action:/, ''));
                  const signalIds = ids.filter((id) => !id.startsWith('action:'));
                  if (actionIds.length > 0) {
                    void Promise.all(actionIds.map((id) => dismissAction({ id }))).then(() => {
                      reexecuteActions({ requestPolicy: 'network-only' });
                    });
                  }
                  if (signalIds.length > 0) {
                    void batchDismissSignals({ signalIds }).then((result) => {
                      if (result.error || result.data?.batchDismissSignals !== true) {
                        console.error('Batch dismiss failed', result.error?.message ?? 'Mutation returned false');
                        return;
                      }
                      reexecute({ requestPolicy: 'network-only' });
                    });
                  }
                  setSelectMode(false);
                  setSelectedIds(new Set());
                }}
              />
              <div className="space-y-2.5">
                {visibleItems.map((item) => (
                  <IntelFeedCard
                    key={item.id}
                    item={item}
                    expanded={expandedId === item.id}
                    isNew={newIds.has(item.id)}
                    selectMode={selectMode}
                    selected={selectedIds.has(item.id)}
                    onToggleSelect={() =>
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      })
                    }
                    onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    onDismiss={() => {
                      if (expandedId === item.id) setExpandedId(null);
                      if (item.isAction) {
                        const actionId = item.id.replace(/^action:/, '');
                        void dismissAction({ id: actionId }).then((result) => {
                          if (result.error) {
                            console.error('Dismiss action failed', result.error.message);
                            return;
                          }
                          reexecuteActions({ requestPolicy: 'network-only' });
                        });
                        return;
                      }
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
              {hasMore && (
                <div ref={loadMoreSentinelRef} className="flex items-center justify-center py-4">
                  <Spinner size="sm" label="Loading more..." />
                </div>
              )}
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
          {(['All', 'Alerts', 'Insights', 'Actions'] as const).map((tab, i) => (
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
                  <span className="inline-flex items-center gap-1 rounded bg-bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-[0.08em] text-text-primary">
                    <span className="h-3 w-3 flex-shrink-0 rounded-full bg-bg-tertiary" />
                    {item.ticker}
                  </span>
                  <p className="mt-0.5 text-sm font-medium leading-snug text-text-primary">{item.title}</p>
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
