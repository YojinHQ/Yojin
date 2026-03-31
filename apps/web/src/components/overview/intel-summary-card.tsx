import { useEffect, useRef, useState } from 'react';
import { useQuery } from 'urql';

import { SNAP_QUERY } from '../../api/documents';
import type { SnapQueryResult } from '../../api/types';
import { cn, timeAgo } from '../../lib/utils';
import { useFeatureStatus } from '../../lib/feature-status';
import { usePortfolio } from '../../api/hooks';
import { CardEmptyState } from '../common/card-empty-state';
import { CardBlurGate } from '../common/card-blur-gate';
import { FeatureCardGate } from '../common/feature-gate';
import { DashboardCard } from '../common/dashboard-card';
import Spinner from '../common/spinner';
import Button from '../common/button';
import { useAddPositionModal } from '../../lib/add-position-modal-context';

const POLL_INTERVAL_MS = 30_000;
const UPDATED_GLOW_MS = 3_000;

export default function IntelSummaryCard() {
  const { aiConfigured, jintelConfigured } = useFeatureStatus();
  // cache-and-network: urql deduplicates with YojinSnapCard which reads the same query from cache
  const [result, reexecute] = useQuery<SnapQueryResult>({ query: SNAP_QUERY, requestPolicy: 'cache-and-network' });
  const [portfolioResult] = usePortfolio();
  const { openModal } = useAddPositionModal();
  const snap = result.data?.snap;
  const hasPositions = (portfolioResult.data?.portfolio?.positions?.length ?? 0) > 0;

  // Poll for snap updates
  useEffect(() => {
    const id = setInterval(() => reexecute({ requestPolicy: 'network-only' }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [reexecute]);

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

  if (!jintelConfigured) {
    return (
      <DashboardCard title="Snap" variant="feature" className="flex-1">
        <CardBlurGate mockContent={<MockIntelSummary />}>
          <FeatureCardGate requires="jintel" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  if (!aiConfigured) {
    return (
      <DashboardCard title="Snap" variant="feature" className="flex-1">
        <CardBlurGate mockContent={<MockIntelSummary />}>
          <FeatureCardGate requires="ai" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  if (result.fetching) {
    return (
      <DashboardCard title="Snap" variant="feature" className="flex-1">
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <Spinner size="md" label="Loading summary..." />
        </div>
      </DashboardCard>
    );
  }

  if (!snap || !snap.intelSummary) {
    return (
      <DashboardCard title="Snap" variant="feature" className="flex-1">
        <CardBlurGate mockContent={<MockIntelSummary />}>
          <CardEmptyState
            icon={
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
                />
              </svg>
            }
            title={hasPositions ? 'Researching your portfolio...' : 'No intel summary yet'}
            description={
              hasPositions
                ? 'Micro research is running. Your first snap will appear shortly.'
                : 'Generated once insights are produced.'
            }
            action={
              hasPositions ? undefined : (
                <Button variant="primary" size="sm" onClick={openModal}>
                  Add positions
                </Button>
              )
            }
          />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard
      title="Snap"
      variant="feature"
      className={cn('flex-1', justUpdated && 'animate-new-item')}
      headerAction={<span className="text-xs text-text-muted">{timeAgo(snap.generatedAt)}</span>}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-5 pb-5">
        <p className="text-sm leading-relaxed text-text-secondary">{snap.intelSummary}</p>
      </div>
    </DashboardCard>
  );
}

function MockIntelSummary() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5">
      <p className="text-sm leading-relaxed text-text-secondary">
        Signals are pointing to a broad tech rotation with NVDA leading on AI infrastructure momentum while AAPL and
        GOOGL face converging headwinds from supply chain and regulatory pressure. Macro sentiment has shifted defensive
        — the simultaneous sell-off across 9 of 11 positions suggests risk-off positioning rather than stock-specific
        weakness.
      </p>
    </div>
  );
}
