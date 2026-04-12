import { useQuery } from 'urql';

import { SIGNALS_BY_IDS_QUERY } from '../../api/documents';
import type { SignalsByIdsQueryResult } from '../../api/types';
import { useSignalModal } from '../../lib/signal-modal-context';
import { cn, safeHref, timeAgo } from '../../lib/utils';
import Badge from './badge';
import type { BadgeVariant } from './badge';
import Modal from './modal';
import Spinner from './spinner';

const typeVariant: Record<string, BadgeVariant> = {
  NEWS: 'info',
  FUNDAMENTAL: 'success',
  SENTIMENT: 'warning',
  TECHNICAL: 'neutral',
  MACRO: 'error',
  FILINGS: 'neutral',
  SOCIALS: 'info',
  REGULATORY: 'error',
  TRADING_LOGIC_TRIGGER: 'warning',
};

const sentimentVariant: Record<string, BadgeVariant> = {
  BULLISH: 'success',
  BEARISH: 'error',
  NEUTRAL: 'neutral',
  MIXED: 'warning',
};

export function SignalsModal() {
  const { open, signalIds, closeSignals } = useSignalModal();

  const [result] = useQuery<SignalsByIdsQueryResult>({
    query: SIGNALS_BY_IDS_QUERY,
    variables: { ids: signalIds },
    pause: !open,
  });

  const signals = result.data?.signalsByIds ?? [];

  return (
    <Modal open={open} onClose={closeSignals} title="Related Signals" maxWidth="max-w-2xl">
      {result.fetching ? (
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" label="Loading signals..." />
        </div>
      ) : result.error ? (
        <p className="py-6 text-center text-sm text-error">Failed to load signals. Please try again.</p>
      ) : signals.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">No signals found.</p>
      ) : (
        <div className="space-y-3">
          {signals.map((signal) => (
            <div key={signal.id} className="rounded-lg bg-bg-primary p-4">
              {/* Header badges */}
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={typeVariant[signal.type] ?? 'neutral'} size="xs">
                  {signal.type}
                </Badge>
                {signal.sentiment && (
                  <Badge variant={sentimentVariant[signal.sentiment] ?? 'neutral'} size="xs">
                    {signal.sentiment}
                  </Badge>
                )}
                <span className="text-xs text-text-muted">{timeAgo(signal.publishedAt)}</span>
                {signal.sources.length > 0 && (
                  <span className="text-xs text-text-muted">· {signal.sources.map((s) => s.name).join(', ')}</span>
                )}
              </div>

              {/* Title */}
              <h3 className="text-sm font-medium text-text-primary">{signal.tier1 ?? signal.title}</h3>

              {/* Summary */}
              {signal.tier2 && <p className="mt-1 text-xs leading-relaxed text-text-secondary">{signal.tier2}</p>}

              {/* Confidence + source link */}
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 w-20">
                    <div className="h-1 flex-1 rounded-full bg-bg-tertiary">
                      <div
                        className={cn(
                          'h-1 rounded-full',
                          signal.confidence >= 0.8
                            ? 'bg-success'
                            : signal.confidence >= 0.5
                              ? 'bg-warning'
                              : 'bg-error',
                        )}
                        style={{ width: `${Math.round(signal.confidence * 100)}%` }}
                      />
                    </div>
                    <span className="text-2xs text-text-muted">{Math.round(signal.confidence * 100)}%</span>
                  </div>
                  {signal.tickers.length > 0 && (
                    <div className="flex gap-1">
                      {signal.tickers.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-bg-secondary px-1.5 py-0.5 text-2xs font-semibold text-accent-primary"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {signal.link && (
                  <a
                    href={safeHref(signal.link, '#')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-accent-primary transition-colors hover:text-accent-primary/80"
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
          ))}
        </div>
      )}
    </Modal>
  );
}
