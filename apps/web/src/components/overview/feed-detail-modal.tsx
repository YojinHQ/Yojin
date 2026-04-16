import { useMemo } from 'react';

import Modal from '../common/modal';
import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';
import type { TriggerStrength } from '../../api/types';
import { cn, timeUntil } from '../../lib/utils';

/** Lightweight markdown → HTML for LLM-generated analysis text. */
function markdownToHtml(md: string): string {
  // Escape HTML entities first to prevent XSS from LLM output
  const escaped = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .replace(/^### (.+)$/gm, '<h4 class="mt-3 mb-1 text-xs font-semibold text-text-primary">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="mt-4 mb-1 text-sm font-semibold text-text-primary">$1</h3>')
    .replace(/^# (.+)$/gm, '<h3 class="mt-4 mb-1 text-sm font-bold text-text-primary">$1</h3>')
    .replace(/^---$/gm, '<hr class="my-3 border-border" />')
    .replace(
      /^- \*\*(.+?):\*\*\s?(.*)$/gm,
      '<li class="ml-3 list-disc"><strong class="text-text-primary font-medium">$1:</strong> $2</li>',
    )
    .replace(/^- (.+)$/gm, '<li class="ml-3 list-disc">$1</li>')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-text-primary font-medium">$1</strong>')
    .replace(/\n\n/g, '</p><p class="mt-2">')
    .replace(/\n/g, '<br />');
}

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
  triggerStrength?: TriggerStrength;
  keyPoints: string[];
  analysis: string;
  recommendation?: string;
  relatedTickers?: string[];
  signals?: FeedSignalLink[];
  verdict?: 'BUY' | 'SELL' | 'REVIEW';
  /** Action-specific fields */
  actionMeta?: {
    strategyName: string | null;
    severity: string;
    riskContext: string | null;
    expiresAt: string;
    sizeGuidance: string | null;
    suggestedQuantity?: number | null;
    suggestedValue?: number | null;
    currentPrice?: number | null;
  };
}

interface FeedDetailModalProps {
  open: boolean;
  onClose: () => void;
  data: FeedDetailData | null;
}

const TRIGGER_STRENGTH_VARIANT: Record<TriggerStrength, BadgeVariant> = {
  WEAK: 'neutral',
  MODERATE: 'info',
  STRONG: 'warning',
  EXTREME: 'error',
};

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

function AnalysisSection({ analysis, isAction }: { analysis: string; isAction: boolean }) {
  const html = useMemo(() => markdownToHtml(analysis), [analysis]);
  return (
    <>
      <SectionRule label={isAction ? 'Strategy Rationale' : 'Analysis'} />
      <div
        className="text-xs leading-relaxed text-text-secondary [&_li]:my-0.5"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}

export default function FeedDetailModal({ open, onClose, data }: FeedDetailModalProps) {
  if (!data) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-2xl"
      aria-labelledby="feed-detail-title"
      className={cn(
        data.verdict === 'BUY' && 'border-success/30 ring-1 ring-success/10',
        data.verdict === 'SELL' && 'border-error/30 ring-1 ring-error/10',
      )}
    >
      {/* Source + time header */}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-wider text-text-muted">{data.source}</span>
        <div className="flex items-center gap-3">
          <span className="text-2xs text-text-muted">LAST UPDATE: {data.time}</span>
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
        {data.triggerStrength && (
          <Badge variant={TRIGGER_STRENGTH_VARIANT[data.triggerStrength]} outline>
            {data.triggerStrength.charAt(0) + data.triggerStrength.slice(1).toLowerCase()} Strength
          </Badge>
        )}
      </div>

      {/* Summary details */}
      {data.actionMeta && (
        <>
          {/* Position sizing banner */}
          {data.actionMeta.suggestedQuantity != null && data.actionMeta.suggestedQuantity > 0 && (
            <div
              className={cn(
                'mt-2 flex items-center justify-between rounded-lg px-4 py-3',
                data.verdict === 'BUY'
                  ? 'bg-success/10 text-success'
                  : data.verdict === 'SELL'
                    ? 'bg-error/10 text-error'
                    : 'bg-bg-tertiary text-text-primary',
              )}
            >
              <div>
                <span className="text-2xs font-semibold uppercase tracking-wider opacity-70">Suggested</span>
                <p className="text-lg font-bold leading-tight">
                  {data.verdict === 'BUY' ? 'Buy' : data.verdict === 'SELL' ? 'Sell' : 'Review'}{' '}
                  {data.actionMeta.suggestedQuantity} shares
                </p>
              </div>
              <div className="text-right">
                {data.actionMeta.currentPrice != null && (
                  <p className="text-xs opacity-70">@ ${data.actionMeta.currentPrice.toFixed(2)}</p>
                )}
                {data.actionMeta.suggestedValue != null && (
                  <p className="text-sm font-semibold">
                    ~${data.actionMeta.suggestedValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </p>
                )}
              </div>
            </div>
          )}

          <SectionRule label="Trigger Details" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {data.actionMeta.strategyName && (
              <div>
                <span className="text-3xs font-semibold uppercase tracking-wider text-text-muted">Strategy</span>
                <p className="mt-0.5 text-xs text-text-primary">{data.actionMeta.strategyName}</p>
              </div>
            )}
            <div>
              <span className="text-3xs font-semibold uppercase tracking-wider text-text-muted">Severity</span>
              <p className="mt-0.5 text-xs text-text-primary">{data.actionMeta.severity}</p>
            </div>
            <div>
              <span className="text-3xs font-semibold uppercase tracking-wider text-text-muted">Expires</span>
              <p className="mt-0.5 text-xs text-text-primary">{timeUntil(data.actionMeta.expiresAt)}</p>
            </div>
            {data.actionMeta.sizeGuidance && (
              <div className="col-span-2">
                <span className="text-3xs font-semibold uppercase tracking-wider text-text-muted">Size</span>
                <p className="mt-0.5 text-xs text-text-primary">{data.actionMeta.sizeGuidance}</p>
              </div>
            )}
          </div>
          {data.actionMeta.riskContext && (
            <div className="mt-3 rounded-lg border border-border-light bg-bg-primary/50 px-3 py-2">
              <span className="text-3xs font-semibold uppercase tracking-wider text-text-muted">Context</span>
              <ul className="mt-1 space-y-0.5">
                {data.actionMeta.riskContext
                  .split('\n')
                  .filter(Boolean)
                  .map((line, i) => (
                    <li key={i} className="text-xs leading-relaxed text-text-secondary">
                      {line}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Key Points */}
      {data.keyPoints.length > 0 && (
        <>
          <SectionRule label="Key Points" />
          <ul className="space-y-1.5">
            {data.keyPoints.map((point, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-text-secondary">
                <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-accent-primary" />
                {point}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Analysis / Strategy Rationale */}
      {data.analysis && <AnalysisSection analysis={data.analysis} isAction={!!data.actionMeta} />}

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
