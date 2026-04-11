/**
 * Summaries card — severity-ranked TLDR of neutral intel from the SummaryStore.
 *
 * Reads `summaries` populated by both the macro insight workflow and the
 * micro-runner's severity gate (see src/insights/micro-runner.ts). Summaries
 * are read-only observations — no approval lifecycle. The opinionated BUY/SELL
 * surface lives in the separate `Action` type.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useSummaries } from '../../api';
import { groupSummariesByTicker, insightsHrefForTicker, severityBulletColor } from '../../lib/summaries-by-ticker';
import { useFeatureStatus } from '../../lib/feature-status';
import { cn, timeAgo } from '../../lib/utils';
import { CardBlurGate } from '../common/card-blur-gate';
import { DashboardCard } from '../common/dashboard-card';
import { FeatureCardGate } from '../common/feature-gate';
import Modal from '../common/modal';
import Spinner from '../common/spinner';

const POLL_INTERVAL_MS = 30_000;
const UPDATED_GLOW_MS = 3_000;
/**
 * Each `what` is already a full sentence from the analyzer, so one per ticker
 * is enough — joining two produces a paragraph and only one ticker fits on screen.
 */
const MAX_WHATS_PER_TICKER = 1;

interface TickerGroup {
  key: string;
  ticker: string | null;
  topSeverity: number | null;
  topSummaryId: string;
  latestCreatedAt: string;
  /** All `what` strings for this ticker, sorted by severity DESC. */
  whats: string[];
}

export function YojinSnapCard() {
  const { aiConfigured, jintelConfigured } = useFeatureStatus();
  // Pause the query until both prerequisites are satisfied so a gated user
  // doesn't spam `summaries` every 30s behind the blur overlay.
  const unlocked = aiConfigured && jintelConfigured;
  const [result, reexecute] = useSummaries({ limit: 50, pause: !unlocked });
  const summaries = result.data?.summaries;

  // Poll to keep the card fresh without a manual refresh. Only runs once the
  // card is actually visible to the user — otherwise there is nothing to refresh.
  useEffect(() => {
    if (!unlocked) return;
    const id = setInterval(() => reexecute({ requestPolicy: 'cache-and-network' }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [reexecute, unlocked]);

  // Group summaries by ticker — one row per ticker with its top 1-2 whats joined.
  // Row severity is the max severity seen for that ticker. Groups sort by that
  // severity DESC, then latest createdAt DESC. Null-ticker summaries fall into a
  // single trailing group rendered without a symbol label. Grouping + per-bucket
  // sort live in the shared helper; we only layer the cross-group sort here.
  const grouped: TickerGroup[] = useMemo(() => {
    const byTicker = groupSummariesByTicker(summaries ?? []);
    const groups: TickerGroup[] = [];
    for (const [key, items] of byTicker) {
      const top = items[0];
      if (!top) continue;
      groups.push({
        key: key || '__untagged__',
        ticker: key || null,
        topSeverity: top.severity,
        topSummaryId: top.id,
        latestCreatedAt: top.createdAt,
        whats: items.map((a) => a.what),
      });
    }
    return groups.sort((a, b) => {
      const sa = a.topSeverity ?? -1;
      const sb = b.topSeverity ?? -1;
      if (sa !== sb) return sb - sa;
      return b.latestCreatedAt.localeCompare(a.latestCreatedAt);
    });
  }, [summaries]);

  // Count only the summaries that survived the grouping filter (the mapping
  // layer drops portfolio-level sentinel rows). Using `summaries.length`
  // directly would report a higher total than the user can actually see.
  const totalSummaries = useMemo(() => grouped.reduce((sum, g) => sum + g.whats.length, 0), [grouped]);

  // Click "+N more" to open the full per-ticker list in a modal.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedGroup = useMemo(
    () => (selectedKey ? (grouped.find((g) => g.key === selectedKey) ?? null) : null),
    [selectedKey, grouped],
  );

  // Glow-pulse when the top ticker's top summary changes (new critical item landed).
  const [justUpdated, setJustUpdated] = useState(false);
  const prevTopIdRef = useRef<string | null>(null);
  useEffect(() => {
    const topId = grouped[0]?.topSummaryId ?? null;
    if (topId === null) return;
    const isUpdate = prevTopIdRef.current !== null && prevTopIdRef.current !== topId;
    prevTopIdRef.current = topId;
    if (!isUpdate) return;
    const start = setTimeout(() => setJustUpdated(true), 0);
    const end = setTimeout(() => setJustUpdated(false), UPDATED_GLOW_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
  }, [grouped]);

  if (!jintelConfigured) {
    return (
      <DashboardCard title="Summaries" variant="feature" className="flex-1">
        <CardBlurGate mockContent={<MockSummaries />}>
          <FeatureCardGate requires="jintel" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  if (!aiConfigured) {
    return (
      <DashboardCard title="Summaries" variant="feature" className="flex-1">
        <CardBlurGate mockContent={<MockSummaries />}>
          <FeatureCardGate requires="ai" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  if (result.fetching && !summaries) {
    return (
      <DashboardCard title="Summaries" variant="feature" className="flex-1">
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <Spinner size="md" label="Loading summaries..." />
        </div>
      </DashboardCard>
    );
  }

  if (grouped.length === 0) {
    return (
      <DashboardCard title="Summaries" variant="feature" className="flex-1">
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <span className="text-sm text-text-muted">No summaries yet</span>
        </div>
      </DashboardCard>
    );
  }

  const latestCreatedAt = grouped[0]?.latestCreatedAt;

  return (
    <DashboardCard
      title="Summaries"
      variant="feature"
      className={cn('flex-1', justUpdated && 'animate-new-item')}
      headerAction={
        <span className="text-xs text-text-muted">
          {grouped.length} {grouped.length === 1 ? 'ticker' : 'tickers'} &middot; {totalSummaries} total
          {latestCreatedAt && <> &middot; {timeAgo(latestCreatedAt)}</>}
        </span>
      }
    >
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-5 pb-5">
        {grouped.map((group) => {
          const visibleWhats = group.whats.slice(0, MAX_WHATS_PER_TICKER);
          const hiddenCount = group.whats.length - visibleWhats.length;
          return (
            <li key={group.key} className="flex items-start gap-2">
              <span
                className={cn('mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', severityBulletColor(group.topSeverity))}
              />
              <p className="min-w-0 flex-1 text-sm leading-relaxed text-text-secondary">
                {group.ticker && (
                  <Link
                    to={insightsHrefForTicker(group.ticker)}
                    className="mr-1.5 font-semibold text-text-primary underline-offset-2 hover:underline focus:underline focus:outline-none"
                  >
                    {group.ticker}
                  </Link>
                )}
                {visibleWhats.join(' · ')}
                {hiddenCount > 0 && (
                  <>
                    {' '}
                    <button
                      type="button"
                      onClick={() => setSelectedKey(group.key)}
                      className="text-text-muted underline-offset-2 hover:text-text-primary hover:underline focus:text-text-primary focus:underline focus:outline-none"
                    >
                      (+{hiddenCount} more)
                    </button>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
      <Modal
        open={selectedGroup !== null}
        onClose={() => setSelectedKey(null)}
        title={selectedGroup?.ticker ? `${selectedGroup.ticker} summaries` : 'Summaries'}
        maxWidth="max-w-xl"
      >
        {selectedGroup && (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-3">
              {selectedGroup.whats.map((what, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className={cn(
                      'mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full',
                      severityBulletColor(selectedGroup.topSeverity),
                    )}
                  />
                  <span className="text-sm leading-relaxed text-text-secondary">{what}</span>
                </li>
              ))}
            </ul>
            {selectedGroup.ticker && (
              <Link
                to={insightsHrefForTicker(selectedGroup.ticker)}
                onClick={() => setSelectedKey(null)}
                className="self-start text-sm font-medium text-accent-primary underline-offset-2 hover:underline focus:underline focus:outline-none"
              >
                View {selectedGroup.ticker} in Insights →
              </Link>
            )}
          </div>
        )}
      </Modal>
    </DashboardCard>
  );
}

const MOCK_SUMMARIES = [
  { ticker: 'NVDA', text: 'Earnings beat — revenue +22% YoY, guidance raised on datacenter demand' },
  { ticker: 'AAPL', text: 'Supply chain warning flagged ahead of Jan 30 earnings' },
  { ticker: 'TSLA', text: 'Truist cuts price target to $180 amid macro headwinds' },
];

function MockSummaries() {
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-5 pb-5">
      {MOCK_SUMMARIES.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
          <div className="min-w-0 flex-1">
            <span className="mr-1.5 text-sm font-semibold text-text-primary">{item.ticker}</span>
            <span className="text-sm leading-relaxed text-text-secondary">{item.text}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
