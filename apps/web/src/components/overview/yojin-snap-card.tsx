/**
 * Actions card — severity-ranked TLDR of pending Actions from the ActionStore.
 *
 * Reads `actions(status: PENDING)` populated by the micro-runner's severity gate
 * (see src/insights/micro-runner.ts). Replaces the previous implementation that
 * pulled from `snap.actionItems` — that was a duplicate of the Snap card's data
 * and didn't reflect the real ActionStore. Filename kept as `yojin-snap-card.tsx`
 * to avoid a wide import rename; the card is titled "Actions" in the UI.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { useActions } from '../../api';
import type { Action } from '../../api/types';
import { useFeatureStatus } from '../../lib/feature-status';
import { cn, timeAgo } from '../../lib/utils';
import { CardBlurGate } from '../common/card-blur-gate';
import { DashboardCard } from '../common/dashboard-card';
import { FeatureCardGate } from '../common/feature-gate';
import Spinner from '../common/spinner';

const POLL_INTERVAL_MS = 30_000;
const UPDATED_GLOW_MS = 3_000;

/** Map a 0–1 severity score to a bullet color (matches the analyzer prompt's ladder). */
function severityBulletColor(severity: number | null): string {
  if (severity === null) return 'bg-text-muted';
  if (severity >= 0.9) return 'bg-error';
  if (severity >= 0.7) return 'bg-warning';
  if (severity >= 0.4) return 'bg-info';
  if (severity >= 0.1) return 'bg-accent-primary';
  return 'bg-text-muted';
}

/** Extract ticker from `source: "micro-observation: AAPL"`. */
function extractTicker(source: string): string | null {
  const match = source.match(/^micro-observation:\s*(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export function YojinSnapCard() {
  const { aiConfigured, jintelConfigured } = useFeatureStatus();
  // Pause the query until both prerequisites are satisfied so a gated user
  // doesn't spam `actions(status: PENDING)` every 30s behind the blur overlay.
  const unlocked = aiConfigured && jintelConfigured;
  const [result, reexecute] = useActions({ status: 'PENDING', limit: 50, pause: !unlocked });
  const actions = result.data?.actions;

  // Poll to keep the card fresh without a manual refresh. Only runs once the
  // card is actually visible to the user — otherwise there is nothing to refresh.
  useEffect(() => {
    if (!unlocked) return;
    const id = setInterval(() => reexecute({ requestPolicy: 'cache-and-network' }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [reexecute, unlocked]);

  // Sort by severity DESC, then createdAt DESC. Null severity sinks.
  const sorted: Action[] = useMemo(() => {
    const list = actions ?? [];
    return [...list].sort((a, b) => {
      const sa = a.severity ?? -1;
      const sb = b.severity ?? -1;
      if (sa !== sb) return sb - sa;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [actions]);

  // Glow-pulse when the top action changes (new critical item landed).
  const [justUpdated, setJustUpdated] = useState(false);
  const prevTopIdRef = useRef<string | null>(null);
  useEffect(() => {
    const topId = sorted[0]?.id ?? null;
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
  }, [sorted]);

  if (!jintelConfigured) {
    return (
      <DashboardCard title="Actions" variant="feature" className="flex-1">
        <CardBlurGate mockContent={<MockActions />}>
          <FeatureCardGate requires="jintel" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  if (!aiConfigured) {
    return (
      <DashboardCard title="Actions" variant="feature" className="flex-1">
        <CardBlurGate mockContent={<MockActions />}>
          <FeatureCardGate requires="ai" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  if (result.fetching && !actions) {
    return (
      <DashboardCard title="Actions" variant="feature" className="flex-1">
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <Spinner size="md" label="Loading actions..." />
        </div>
      </DashboardCard>
    );
  }

  if (sorted.length === 0) {
    return (
      <DashboardCard title="Actions" variant="feature" className="flex-1">
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <span className="text-sm text-text-muted">No actions yet</span>
        </div>
      </DashboardCard>
    );
  }

  const latestCreatedAt = sorted[0]?.createdAt;

  return (
    <DashboardCard
      title="Actions"
      variant="feature"
      className={cn('flex-1', justUpdated && 'animate-new-item')}
      headerAction={
        <span className="text-xs text-text-muted">
          {sorted.length} pending{latestCreatedAt && <> &middot; {timeAgo(latestCreatedAt)}</>}
        </span>
      }
    >
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-5 pb-5">
        {sorted.map((action) => {
          const ticker = extractTicker(action.source);
          return (
            <li key={action.id} className="flex items-start gap-2">
              <span
                className={cn('mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', severityBulletColor(action.severity))}
              />
              <div className="min-w-0 flex-1">
                {ticker && <span className="mr-1.5 text-sm font-semibold text-text-primary">{ticker}</span>}
                <span className="text-sm leading-relaxed text-text-secondary">{action.what}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </DashboardCard>
  );
}

const MOCK_ACTIONS = [
  { ticker: 'NVDA', text: 'Earnings beat — revenue +22% YoY, guidance raised on datacenter demand' },
  { ticker: 'AAPL', text: 'Supply chain warning flagged ahead of Jan 30 earnings' },
  { ticker: 'TSLA', text: 'Truist cuts price target to $180 amid macro headwinds' },
];

function MockActions() {
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-5 pb-5">
      {MOCK_ACTIONS.map((item, i) => (
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
