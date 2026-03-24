import { useNavigate } from 'react-router';

import Modal from '../common/modal';
import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';

export interface FeedSignalLink {
  signalId: string;
  title: string;
  url: string | null;
}

export interface FeedDetailData {
  title: string;
  source: string;
  time: string;
  tag: string;
  tagVariant: BadgeVariant;
  sentiment?: 'bullish' | 'bearish' | 'neutral';
  impact?: 'high' | 'medium' | 'low';
  urgency?: 'high' | 'medium' | 'low';
  confidence?: number;
  keyPoints: string[];
  analysis: string;
  recommendation?: string;
  relatedTickers?: string[];
  signals?: FeedSignalLink[];
}

interface FeedDetailModalProps {
  open: boolean;
  onClose: () => void;
  data: FeedDetailData | null;
}

const sentimentBadge: Record<string, { label: string; variant: BadgeVariant }> = {
  bullish: { label: 'Bullish', variant: 'success' },
  bearish: { label: 'Bearish', variant: 'error' },
  neutral: { label: 'Neutral', variant: 'info' },
};

const impactBadge: Record<string, { label: string; variant: BadgeVariant }> = {
  high: { label: 'High Impact', variant: 'error' },
  medium: { label: 'Med Impact', variant: 'warning' },
  low: { label: 'Low Impact', variant: 'info' },
};

function SectionRule({ label }: { label: string }) {
  return (
    <div className="mt-5 mb-2.5 flex items-center gap-2.5">
      <span className="whitespace-nowrap text-3xs font-semibold uppercase tracking-[0.15em] text-text-muted">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export default function FeedDetailModal({ open, onClose, data }: FeedDetailModalProps) {
  const navigate = useNavigate();
  if (!data) return null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl" aria-labelledby="feed-detail-title">
      {/* Source + time header */}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-wider text-text-muted">{data.source}</span>
        <div className="flex items-center gap-3">
          <span className="text-2xs text-text-muted">{data.time}</span>
          <button
            onClick={onClose}
            className="text-text-muted transition-colors hover:text-text-primary"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Title */}
      <h2 id="feed-detail-title" className="font-headline text-lg leading-snug text-text-primary">
        {data.title}
      </h2>

      {/* Badge row */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant={data.tagVariant}>{data.tag}</Badge>
        {data.sentiment && (
          <Badge variant={sentimentBadge[data.sentiment].variant} outline>
            {sentimentBadge[data.sentiment].label}
          </Badge>
        )}
        {data.impact && (
          <Badge variant={impactBadge[data.impact].variant} outline>
            {impactBadge[data.impact].label}
          </Badge>
        )}
        {data.urgency && (
          <Badge variant={data.urgency === 'high' ? 'error' : data.urgency === 'medium' ? 'warning' : 'info'} outline>
            {data.urgency.charAt(0).toUpperCase() + data.urgency.slice(1)} Urgency
          </Badge>
        )}
        {data.confidence !== undefined && (
          <Badge variant="neutral" outline>
            {data.confidence}% Confidence
          </Badge>
        )}
      </div>

      {/* Key Points */}
      <SectionRule label="Key Points" />
      <ul className="space-y-1.5">
        {data.keyPoints.map((point, i) => (
          <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-text-secondary">
            <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-accent-primary" />
            {point}
          </li>
        ))}
      </ul>

      {/* Analysis */}
      <SectionRule label="Analysis" />
      <p className="text-xs leading-relaxed text-text-secondary">{data.analysis}</p>

      {/* Recommendation (intel-specific) */}
      {data.recommendation && (
        <>
          <SectionRule label="Recommendation" />
          <div className="rounded-lg border border-accent-primary/20 bg-accent-glow p-3">
            <p className="text-xs leading-relaxed text-text-primary">{data.recommendation}</p>
          </div>
        </>
      )}

      {/* Signals */}
      {data.signals && data.signals.length > 0 && (
        <>
          <SectionRule label="Signals" />
          <div className="space-y-1.5">
            {data.signals.map((sig) => (
              <a
                key={sig.signalId}
                href={sig.url ?? `/signals?highlight=${sig.signalId}`}
                target={sig.url ? '_blank' : undefined}
                rel={sig.url ? 'noopener noreferrer' : undefined}
                onClick={(e) => {
                  if (!sig.url) {
                    e.preventDefault();
                    onClose();
                    navigate(`/signals?highlight=${sig.signalId}`);
                  }
                }}
                className="flex items-center gap-2 rounded-lg border border-border-light bg-bg-tertiary px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-accent-primary"
              >
                <svg
                  className="h-3.5 w-3.5 flex-shrink-0 text-accent-primary"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                  />
                </svg>
                <span className="min-w-0 flex-1">{sig.title}</span>
                {sig.url && (
                  <svg
                    className="h-3 w-3 flex-shrink-0 text-text-muted"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                )}
              </a>
            ))}
          </div>
        </>
      )}

      {/* Related Tickers */}
      {data.relatedTickers && data.relatedTickers.length > 0 && (
        <>
          <SectionRule label="Related" />
          <div className="flex flex-wrap gap-1.5">
            {data.relatedTickers.map((ticker) => (
              <span key={ticker} className="rounded bg-bg-tertiary px-2 py-0.5 text-2xs font-medium text-text-primary">
                {ticker}
              </span>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
