import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from 'urql';

import { SNAP_QUERY, LATEST_INSIGHT_REPORT_QUERY } from '../../api/documents';
import type { SnapQueryResult, LatestInsightReportQueryResult } from '../../api/types';
import { timeAgo } from '../../lib/utils';
import { useFeatureStatus } from '../../lib/feature-status';
import { CardBlurGate } from '../common/card-blur-gate';
import { FeatureCardGate } from '../common/feature-gate';
import { DashboardCard } from '../common/dashboard-card';
import Spinner from '../common/spinner';
import { cn } from '../../lib/utils';
import { SignalChips } from './signal-chips';

const UPDATED_GLOW_MS = 3_000;

function stripPrefix(text: string): string {
  return text.replace(/^(CRITICAL|HIGH|MEDIUM|LOW):\s*/i, '');
}

export default function YojinSnapCard() {
  const { aiConfigured, jintelConfigured } = useFeatureStatus();
  // Use cache-and-network so IntelSummaryCard's poll updates this component via cache (no duplicate requests)
  const [result] = useQuery<SnapQueryResult>({ query: SNAP_QUERY, requestPolicy: 'cache-and-network' });
  const [insightResult] = useQuery<LatestInsightReportQueryResult>({ query: LATEST_INSIGHT_REPORT_QUERY });
  const navigate = useNavigate();
  const snap = result.data?.snap;
  const report = insightResult.data?.latestInsightReport;

  // Detect snap regeneration — pulse when generatedAt changes
  const [justUpdated, setJustUpdated] = useState(false);
  const prevGeneratedAtRef = useRef<string | null>(null);
  useEffect(() => {
    const generatedAt = snap?.generatedAt ?? null;
    if (generatedAt === null) return;
    const isUpdate = prevGeneratedAtRef.current !== null && prevGeneratedAtRef.current !== generatedAt;
    prevGeneratedAtRef.current = generatedAt;
    if (!isUpdate) return;
    const start = setTimeout(() => setJustUpdated(true), 0);
    const end = setTimeout(() => setJustUpdated(false), UPDATED_GLOW_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
  }, [snap?.generatedAt]);

  const signalMap = useMemo(() => {
    const map = new Map<string, { title: string; url: string | null; sourceCount?: number }>();
    if (!report) return map;
    for (const pos of report.positions) {
      for (const sig of pos.keySignals ?? []) {
        map.set(sig.signalId, { title: sig.title, url: sig.url, sourceCount: sig.sourceCount });
      }
    }
    return map;
  }, [report]);

  if (!jintelConfigured) {
    return (
      <DashboardCard title="Actions" variant="feature" className="flex-1">
        <CardBlurGate mockContent={<MockSnap />}>
          <FeatureCardGate requires="jintel" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  if (!aiConfigured) {
    return (
      <DashboardCard title="Actions" variant="feature" className="flex-1">
        <CardBlurGate mockContent={<MockSnap />}>
          <FeatureCardGate requires="ai" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  if (result.fetching) {
    return (
      <DashboardCard title="Actions" variant="feature" className="flex-1">
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <Spinner size="md" label="Loading brief..." />
        </div>
      </DashboardCard>
    );
  }

  if (!snap || snap.actionItems.length === 0) {
    return (
      <DashboardCard title="Actions" variant="feature" className="flex-1">
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <span className="text-sm text-text-muted">No actions yet</span>
        </div>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard
      title="Actions"
      variant="feature"
      className={cn('flex-1', justUpdated && 'animate-new-item')}
      headerAction={
        <span className="text-xs text-text-muted">
          {snap.actionItems.length} items &middot; {timeAgo(snap.generatedAt)}
        </span>
      }
    >
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-5 pb-5">
        {snap.actionItems.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
            <div className="min-w-0 flex-1">
              <span className="text-sm leading-relaxed text-text-secondary">{stripPrefix(item.text)}</span>
              <SignalChips signalIds={item.signalIds} signalMap={signalMap} navigate={navigate} />
            </div>
          </li>
        ))}
      </ul>
    </DashboardCard>
  );
}

const MOCK_ACTIONS = [
  { text: 'Tech sector concentration is at 42% of portfolio' },
  { text: 'AAPL earnings on Jan 30th — supply chain risk flagged in recent signals' },
  { text: 'NVDA up +8.2% after earnings beat, now 15% of portfolio' },
];

function MockSnap() {
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-5 pb-5">
      {MOCK_ACTIONS.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
          <span className="text-sm leading-relaxed text-text-secondary">{stripPrefix(item.text)}</span>
        </li>
      ))}
    </ul>
  );
}
