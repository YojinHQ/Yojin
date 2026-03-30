import { useQuery } from 'urql';

import { SNAP_QUERY } from '../../api/documents';
import type { SnapQueryResult, SnapSeverity } from '../../api/types';
import { cn, timeAgo } from '../../lib/utils';
import { useFeatureStatus } from '../../lib/feature-status';
import { CardEmptyState } from '../common/card-empty-state';
import { CardBlurGate } from '../common/card-blur-gate';
import { FeatureCardGate } from '../common/feature-gate';
import { DashboardCard } from '../common/dashboard-card';
import Spinner from '../common/spinner';
import Button from '../common/button';
import { useAddPositionModal } from '../../lib/add-position-modal-context';

const SEVERITY_STYLES: Record<SnapSeverity, { dot: string; text: string }> = {
  HIGH: { dot: 'bg-error', text: 'text-error/80' },
  MEDIUM: { dot: 'bg-warning', text: 'text-warning/80' },
  LOW: { dot: 'bg-info', text: 'text-info/80' },
};

export default function YojinSnapCard() {
  const { aiConfigured, jintelConfigured } = useFeatureStatus();
  const [result] = useQuery<SnapQueryResult>({ query: SNAP_QUERY });
  const { openModal } = useAddPositionModal();
  const snap = result.data?.snap;

  if (!jintelConfigured) {
    return (
      <DashboardCard title="Yojin Snap" variant="feature" className="flex-1">
        <CardBlurGate mockContent={<MockSnap />}>
          <FeatureCardGate requires="jintel" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  if (!aiConfigured) {
    return (
      <DashboardCard title="Yojin Snap" variant="feature" className="flex-1">
        <CardBlurGate mockContent={<MockSnap />}>
          <FeatureCardGate requires="ai" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  if (result.fetching) {
    return (
      <DashboardCard title="Yojin Snap" variant="feature" className="flex-1">
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <Spinner size="md" label="Loading brief..." />
        </div>
      </DashboardCard>
    );
  }

  if (!snap) {
    return (
      <DashboardCard title="Yojin Snap" variant="feature" className="flex-1">
        <CardBlurGate mockContent={<MockSnap />}>
          <CardEmptyState
            icon={
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z"
                />
              </svg>
            }
            title="No snap brief yet"
            description="Generated once your portfolio is loaded."
            action={
              <Button variant="primary" size="sm" onClick={openModal}>
                Add positions
              </Button>
            }
          />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard
      title="Yojin Snap"
      variant="feature"
      className="flex-1"
      headerAction={<span className="text-xs text-text-muted">{timeAgo(snap.generatedAt)}</span>}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-5 pb-5">
        {/* Summary prose */}
        <p className="text-sm leading-relaxed text-text-secondary">{snap.summary}</p>

        {/* Attention items */}
        {snap.attentionItems.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wider text-text-muted">Attention</span>
            <ul className="space-y-1.5">
              {snap.attentionItems.map((item, i) => {
                const styles = SEVERITY_STYLES[item.severity] ?? SEVERITY_STYLES.LOW;
                return (
                  <li key={i} className="flex items-start gap-2">
                    <span className={cn('mt-1.5 h-2 w-2 flex-shrink-0 rounded-full', styles.dot)} />
                    <span className={cn('text-sm leading-relaxed', styles.text)}>{item.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Tickers summarized */}
        {snap.portfolioTickers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {snap.portfolioTickers.map((ticker) => (
              <span key={ticker} className="rounded bg-bg-tertiary px-2 py-0.5 text-xs font-medium text-text-secondary">
                {ticker}
              </span>
            ))}
          </div>
        )}
      </div>
    </DashboardCard>
  );
}

const MOCK_ATTENTION = [
  { severity: 'HIGH' as SnapSeverity, label: 'NVDA earnings beat: +8.2% after hours' },
  { severity: 'MEDIUM' as SnapSeverity, label: 'AAPL supply chain delays reported' },
  { severity: 'LOW' as SnapSeverity, label: 'Fed minutes release tomorrow at 2pm ET' },
];

function MockSnap() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-5 pb-5">
      <p className="text-sm leading-relaxed text-text-secondary">
        Your portfolio is showing mixed signals today. NVDA leads with strong momentum after earnings beat, while AAPL
        faces headwinds from supply chain concerns. Consider reviewing your tech allocation.
      </p>

      <div className="space-y-2">
        <span className="text-xs font-medium uppercase tracking-wider text-text-muted">Attention</span>
        <ul className="space-y-1.5">
          {MOCK_ATTENTION.map((item, i) => {
            const styles = SEVERITY_STYLES[item.severity];
            return (
              <li key={i} className="flex items-start gap-2">
                <span className={cn('mt-1.5 h-2 w-2 flex-shrink-0 rounded-full', styles.dot)} />
                <span className={cn('text-sm leading-relaxed', styles.text)}>{item.label}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {['AAPL', 'NVDA', 'TSLA', 'BTC', 'MSFT'].map((ticker) => (
          <span key={ticker} className="rounded bg-bg-tertiary px-2 py-0.5 text-xs font-medium text-text-secondary">
            {ticker}
          </span>
        ))}
      </div>
    </div>
  );
}
