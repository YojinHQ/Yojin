import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from 'urql';

import { LATEST_INSIGHT_REPORT_QUERY } from '../../api/documents';
import type { LatestInsightReportQueryResult, PortfolioItem, PositionInsight } from '../../api/types';
import { cn, timeAgo } from '../../lib/utils';
import Button from '../common/button';
import FeedDetailModal from './feed-detail-modal';
import type { FeedDetailData } from './feed-detail-modal';
import { SignalChips } from './signal-chips';

/* ── Types ─────────────────────────────────────────────────────────── */

type EventCategory = 'Action' | 'Alert' | 'Insight';
type FilterTab = 'All' | EventCategory;

export interface SignalLink {
  signalId: string;
  title: string;
  url: string | null;
}

export interface FeedItem {
  category: EventCategory;
  source: string;
  time: string;
  title: string;
  description?: string;
  urgency?: 'high' | 'medium' | 'low';
  preview: string;
  signals: SignalLink[];
  detail: {
    keyPoints: string[];
    analysis: string;
    recommendation?: string;
    relatedTickers?: string[];
    sentiment?: 'bullish' | 'bearish' | 'neutral';
    impact?: 'high' | 'medium' | 'low';
    confidence?: number;
  };
}

/* ── Category config ────────────────────────────────────────────────── */

const categoryConfig: Record<
  EventCategory,
  { variant: 'accent' | 'warning' | 'success'; color: string; iconBg: string }
> = {
  Action: { variant: 'accent', color: 'text-accent-primary/60', iconBg: 'bg-accent-primary/5' },
  Alert: { variant: 'warning', color: 'text-warning/60', iconBg: 'bg-warning/5' },
  Insight: { variant: 'success', color: 'text-success/60', iconBg: 'bg-success/5' },
};

const SECTION_ORDER: EventCategory[] = ['Action', 'Alert', 'Insight'];

const FILTER_TABS: { label: string; value: FilterTab }[] = [
  { label: 'All', value: 'All' },
  { label: 'Actions', value: 'Action' },
  { label: 'Alerts', value: 'Alert' },
  { label: 'Insights', value: 'Insight' },
];

/* ── Icons ──────────────────────────────────────────────────────────── */

function ActionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
      />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}

function InsightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
      />
    </svg>
  );
}

const categoryIcon: Record<EventCategory, typeof ActionIcon> = {
  Action: ActionIcon,
  Alert: AlertIcon,
  Insight: InsightIcon,
};

/* ── Button icons ────────────────────────────────────────────────── */

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

/* ── Build feed items from insight report ────────────────────────── */

function ratingToSentiment(rating: string): 'bullish' | 'bearish' | 'neutral' {
  if (rating === 'STRONG_BUY' || rating === 'BUY') return 'bullish';
  if (rating === 'STRONG_SELL' || rating === 'SELL') return 'bearish';
  return 'neutral';
}

function priorityFromPrefix(item: string): 'high' | 'medium' | 'low' {
  if (item.startsWith('CRITICAL:')) return 'high';
  if (item.startsWith('HIGH:')) return 'high';
  if (item.startsWith('MEDIUM:')) return 'medium';
  return 'low';
}

function stripPrefix(s: string): string {
  return s.replace(/^(CRITICAL|HIGH|MEDIUM|LOW):\s*/i, '');
}

function buildFeedItems(report: {
  portfolio: {
    actionItems: PortfolioItem[];
    topRisks: PortfolioItem[];
    topOpportunities: PortfolioItem[];
    summary: string;
    sectorThemes: string[];
    macroContext: string;
  };
  positions: PositionInsight[];
  createdAt: string;
}): FeedItem[] {
  const ts = timeAgo(report.createdAt);
  const items: FeedItem[] = [];

  // Build a signalId → SignalLink lookup from all position keySignals
  const signalMap = new Map<string, SignalLink>();
  for (const pos of report.positions) {
    for (const sig of pos.keySignals ?? []) {
      signalMap.set(sig.signalId, { signalId: sig.signalId, title: sig.title, url: sig.url });
    }
  }

  // Resolve signalIds to SignalLink objects
  const resolveSignals = (ids: string[]): SignalLink[] =>
    ids.map((id) => signalMap.get(id)).filter((s): s is SignalLink => s != null);

  // Actions from actionItems
  for (const action of report.portfolio.actionItems) {
    items.push({
      category: 'Action',
      source: 'Strategist',
      time: ts,
      title: stripPrefix(action.text).slice(0, 60),
      urgency: priorityFromPrefix(action.text),
      preview: stripPrefix(action.text),
      signals: resolveSignals(action.signalIds),
      detail: {
        keyPoints: [stripPrefix(action.text)],
        analysis: report.portfolio.summary,
        relatedTickers: report.positions.map((p) => p.symbol),
      },
    });
  }

  // Alerts from topRisks
  for (const risk of report.portfolio.topRisks) {
    items.push({
      category: 'Alert',
      source: 'Risk Manager',
      time: ts,
      title: risk.text.slice(0, 60),
      urgency: 'medium',
      preview: risk.text,
      signals: resolveSignals(risk.signalIds),
      detail: {
        keyPoints: [risk.text],
        analysis: report.portfolio.macroContext,
        impact: 'high',
      },
    });
  }

  // Insights from position ratings (only non-HOLD)
  for (const pos of report.positions) {
    if (pos.rating === 'HOLD' && pos.conviction < 0.5) continue;
    const signals = (pos.keySignals ?? []).map((s) => ({ signalId: s.signalId, title: s.title, url: s.url }));
    items.push({
      category: 'Insight',
      source: 'Research Analyst',
      time: ts,
      title: `${pos.symbol} — ${pos.rating.replace('_', ' ')}`,
      description: pos.thesis,
      preview: pos.thesis,
      signals,
      detail: {
        keyPoints: [
          `Rating: ${pos.rating.replace('_', ' ')} (${Math.round(pos.conviction * 100)}% conviction)`,
          ...pos.risks.slice(0, 2),
          ...pos.opportunities.slice(0, 2),
        ],
        analysis: pos.thesis,
        recommendation: pos.opportunities[0],
        relatedTickers: [pos.symbol],
        sentiment: ratingToSentiment(pos.rating),
        confidence: Math.round(pos.conviction * 100),
      },
    });
  }

  // Opportunities as Insights
  for (const opp of report.portfolio.topOpportunities) {
    items.push({
      category: 'Insight',
      source: 'Strategist',
      time: ts,
      title: opp.text.slice(0, 60),
      preview: opp.text,
      signals: resolveSignals(opp.signalIds),
      detail: {
        keyPoints: [opp.text],
        analysis: report.portfolio.summary,
        sentiment: 'bullish',
      },
    });
  }

  return items;
}

/* ── Component ───────────────────────────────────────────────────── */

export default function NewsFeed() {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [modalData, setModalData] = useState<FeedDetailData | null>(null);
  const navigate = useNavigate();

  const [reportResult] = useQuery<LatestInsightReportQueryResult>({ query: LATEST_INSIGHT_REPORT_QUERY });
  const report = reportResult.data?.latestInsightReport;

  const feedItems = useMemo(() => (report ? buildFeedItems(report) : []), [report]);

  const filteredItems = activeFilter === 'All' ? feedItems : feedItems.filter((item) => item.category === activeFilter);

  const grouped = SECTION_ORDER.map((cat) => ({
    category: cat,
    items: filteredItems.filter((item) => item.category === cat),
  })).filter((group) => group.items.length > 0);

  const showSectionHeaders = activeFilter === 'All';

  const toggleExpand = (key: string) => {
    setExpandedKey(expandedKey === key ? null : key);
  };

  const openDetail = (item: FeedItem) => {
    const config = categoryConfig[item.category];
    setModalData({
      title: item.title,
      source: item.source,
      time: item.time,
      tag: item.category,
      tagVariant: config.variant,
      urgency: item.urgency,
      confidence: item.detail.confidence,
      sentiment: item.detail.sentiment,
      impact: item.detail.impact,
      keyPoints: item.detail.keyPoints,
      analysis: item.detail.analysis,
      recommendation: item.detail.recommendation,
      relatedTickers: item.detail.relatedTickers,
      signals: item.signals,
    });
  };

  if (reportResult.fetching) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-text-muted">Loading...</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-text-muted">Run Process Insights to see recommendations.</p>
      </div>
    );
  }

  return (
    <>
      {/* ── Sticky header ──────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-bg-secondary">
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-1.5">
          <h2 className="font-headline text-base text-text-primary">Recommendations</h2>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-primary px-1.5 text-[10px] font-bold text-white">
            {feedItems.length}
          </span>
        </div>

        <div className="flex gap-5 border-b border-border px-4">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => {
                setActiveFilter(tab.value);
                setExpandedKey(null);
              }}
              className={cn(
                'relative cursor-pointer pb-2.5 pt-1.5 text-xs font-medium transition-colors',
                activeFilter === tab.value ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {tab.label}
              {activeFilter === tab.value && (
                <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-accent-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Grouped feed items ─────────────────────────────────── */}
      <div className="space-y-5 p-3">
        {grouped.map(({ category, items }) => {
          const catConfig = categoryConfig[category];
          const Icon = categoryIcon[category];
          return (
            <div key={category}>
              {showSectionHeaders && (
                <h3 className={cn('mb-2.5 px-1 text-2xs font-semibold uppercase tracking-widest', catConfig.color)}>
                  {category}s
                </h3>
              )}

              <div className="space-y-2.5">
                {items.map((item, idx) => {
                  const config = categoryConfig[item.category];
                  const itemKey = `${item.category}-${idx}-${item.title}`;
                  const expanded = expandedKey === itemKey;

                  return (
                    <div
                      key={itemKey}
                      className={cn(
                        'cursor-pointer rounded-xl border border-border-light bg-bg-tertiary transition-all',
                        expanded ? 'ring-1 ring-border-light' : 'hover:bg-bg-hover',
                      )}
                      onClick={() => toggleExpand(itemKey)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={expanded}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleExpand(itemKey);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3 px-2.5 py-2">
                        <div
                          className={cn(
                            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                            config.iconBg,
                          )}
                        >
                          <Icon className={cn('h-4.5 w-4.5', config.color)} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className={cn('text-2xs font-semibold uppercase tracking-[0.1em]', config.color)}>
                            {item.category}
                          </span>
                          <p className="truncate text-sm font-medium leading-snug text-text-primary">{item.title}</p>
                        </div>
                        {item.urgency === 'high' && (
                          <span className="flex-shrink-0 rounded bg-error/15 px-1.5 py-0.5 text-[10px] font-semibold text-error">
                            !
                          </span>
                        )}
                      </div>

                      <div
                        className={cn(
                          'grid transition-[grid-template-rows] duration-200 ease-out',
                          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                        )}
                      >
                        <div className="overflow-hidden">
                          <div className="border-t border-border/30 px-3 pb-3">
                            <p className="mt-2 text-xs leading-relaxed text-text-secondary">{item.preview}</p>
                            {item.signals.length > 0 && (
                              <SignalChips
                                signals={item.signals}
                                navigate={navigate}
                                className="mt-2 flex flex-wrap gap-1.5"
                                onClick={(e) => e.stopPropagation()}
                              />
                            )}
                            <div className="mt-3 flex items-center gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDetail(item);
                                }}
                              >
                                View details
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate('/chat', {
                                    state: {
                                      preset: `Analyze this ${item.category.toLowerCase()}: "${item.title}" — ${item.preview}`,
                                    },
                                  });
                                }}
                              >
                                <AgentIcon />
                                Ask Yojin
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <FeedDetailModal open={modalData !== null} onClose={() => setModalData(null)} data={modalData} />
    </>
  );
}
