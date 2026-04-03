import { useEffect, useRef, useState } from 'react';
import { useQuery } from 'urql';

import { SNAP_QUERY } from '../../api/documents';
import type { SnapQueryResult } from '../../api/types';
import { cn, timeAgo } from '../../lib/utils';
import { useFeatureStatus } from '../../lib/feature-status';
import { CardBlurGate } from '../common/card-blur-gate';
import { FeatureCardGate } from '../common/feature-gate';
import { DashboardCard } from '../common/dashboard-card';
import Spinner from '../common/spinner';

const POLL_INTERVAL_MS = 30_000;
const UPDATED_GLOW_MS = 3_000;

export default function IntelSummaryCard() {
  const { aiConfigured, jintelConfigured } = useFeatureStatus();
  // cache-and-network: urql deduplicates with YojinSnapCard which reads the same query from cache
  const [result, reexecute] = useQuery<SnapQueryResult>({ query: SNAP_QUERY, requestPolicy: 'cache-and-network' });
  const snap = result.data?.snap;

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
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <span className="text-sm text-text-muted">No summary yet</span>
        </div>
      </DashboardCard>
    );
  }

  const sentences = splitSentences(snap.intelSummary);

  return (
    <DashboardCard
      title="Snap"
      variant="feature"
      className={cn('flex-1', justUpdated && 'animate-new-item')}
      headerAction={<span className="text-xs text-text-muted">{timeAgo(snap.generatedAt)}</span>}
    >
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-5 pb-5">
        {sentences.map((sentence, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
            <span className="text-sm leading-relaxed text-text-secondary">{sentence}</span>
          </li>
        ))}
      </ul>
    </DashboardCard>
  );
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function MockIntelSummary() {
  const sentences = splitSentences(
    'Signals are pointing to a broad tech rotation with NVDA leading on AI infrastructure momentum while AAPL and GOOGL face converging headwinds from supply chain and regulatory pressure. Macro sentiment has shifted defensive — the simultaneous sell-off across 9 of 11 positions suggests risk-off positioning rather than stock-specific weakness.',
  );
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-5 pb-5">
      {sentences.map((sentence, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
          <span className="text-sm leading-relaxed text-text-secondary">{sentence}</span>
        </li>
      ))}
    </ul>
  );
}
