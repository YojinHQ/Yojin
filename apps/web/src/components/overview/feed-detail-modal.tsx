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
  link?: string | null;
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
            className="cursor-pointer text-text-muted transition-colors hover:text-text-primary"
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

      {/* View Source */}
      {data.link && (
        <div className="mt-5">
          <a
            href={data.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-primary transition-colors hover:text-accent-primary/80"
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
            View Source
          </a>
        </div>
      )}
    </Modal>
  );
}
