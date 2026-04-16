import { useMemo } from 'react';

import Modal from '../common/modal';
import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';
import type { ConvictionLevel, TriggerStrength } from '../../api/types';
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
    entryRange?: string | null;
    targetPrice?: number | null;
    stopLoss?: number | null;
    horizon?: string | null;
    conviction?: ConvictionLevel | null;
    maxEntry?: number | null;
    catalystImpact?: string | null;
    pricedIn?: boolean | null;
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

const CONVICTION_VARIANT: Record<ConvictionLevel, BadgeVariant> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'success',
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

function Field({
  label,
  value,
  className,
  valueClass,
}: {
  label: string;
  value: string;
  className?: string;
  valueClass?: string;
}) {
  return (
    <div className={className}>
      <span className="text-3xs font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      <p className={cn('mt-0.5 text-xs text-text-primary', valueClass)}>{value}</p>
    </div>
  );
}

function SectionRule({ label }: { label: string }) {
  return (
    <div className="mt-3 mb-1.5 flex items-center gap-2.5">
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
    <div>
      <SectionRule label={isAction ? 'Strategy Rationale' : 'Analysis'} />
      <div
        className="text-xs leading-relaxed text-text-secondary [&_h3]:mt-2 [&_h3]:mb-0.5 [&_h3]:text-xs [&_h4]:mt-1.5 [&_h4]:mb-0.5 [&_li]:my-0.5 [&_p]:my-0.5"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export default function FeedDetailModal({ open, onClose, data }: FeedDetailModalProps) {
  if (!data) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-3xl"
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
      <h2 id="feed-detail-title" className="font-headline text-base leading-snug text-text-primary">
        {data.title}
      </h2>

      {/* Badge row */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
        {data.actionMeta?.conviction && (
          <Badge variant={CONVICTION_VARIANT[data.actionMeta.conviction]} outline>
            {data.actionMeta.conviction.charAt(0) + data.actionMeta.conviction.slice(1).toLowerCase()} Conviction
          </Badge>
        )}
      </div>

      {/* Summary details */}
      {data.actionMeta && (
        <>
          {/* Priced-in warning */}
          {data.actionMeta.pricedIn && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5">
              <span className="text-xs text-warning" aria-hidden="true">
                &#9888;
              </span>
              <p className="text-xs text-warning">
                <span className="font-semibold">Priced In:</span>{' '}
                <span className="text-text-secondary">
                  price moved past max entry
                  {data.actionMeta.maxEntry != null &&
                    ` ($${data.actionMeta.maxEntry.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`}
                  — catalyst may be reflected.
                </span>
              </p>
            </div>
          )}

          {/* Position sizing banner */}
          {data.actionMeta.suggestedQuantity != null && data.actionMeta.suggestedQuantity > 0 && (
            <div
              className={cn(
                'mt-2 flex items-center justify-between rounded-lg px-3 py-2',
                data.verdict === 'BUY'
                  ? 'bg-success/10 text-success'
                  : data.verdict === 'SELL'
                    ? 'bg-error/10 text-error'
                    : 'bg-bg-tertiary text-text-primary',
              )}
            >
              <p className="text-sm font-bold leading-tight">
                {data.verdict === 'BUY' ? 'Buy' : data.verdict === 'SELL' ? 'Sell' : 'Review'}{' '}
                {data.actionMeta.suggestedQuantity} shares
                {data.actionMeta.currentPrice != null && (
                  <span className="ml-1 text-xs font-normal opacity-70">
                    @ ${data.actionMeta.currentPrice.toFixed(2)}
                  </span>
                )}
              </p>
              {data.actionMeta.suggestedValue != null && (
                <p className="text-sm font-semibold">
                  ~${data.actionMeta.suggestedValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </p>
              )}
            </div>
          )}

          {/* Consolidated trade + trigger parameters */}
          <SectionRule label="Trade Parameters" />
          <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
            {data.actionMeta.entryRange && <Field label="Entry" value={data.actionMeta.entryRange} />}
            {data.actionMeta.targetPrice != null && (
              <Field
                label="Target"
                value={`$${data.actionMeta.targetPrice.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`}
              />
            )}
            {data.actionMeta.stopLoss != null && (
              <Field
                label="Stop Loss"
                value={`$${data.actionMeta.stopLoss.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`}
              />
            )}
            {data.actionMeta.maxEntry != null && (
              <Field
                label="Max Entry"
                value={`$${data.actionMeta.maxEntry.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`}
                valueClass={data.actionMeta.pricedIn ? 'font-semibold text-warning' : undefined}
              />
            )}
            {data.actionMeta.horizon && <Field label="Horizon" value={data.actionMeta.horizon} />}
            <Field label="Expires" value={timeUntil(data.actionMeta.expiresAt)} />
            {data.actionMeta.catalystImpact && <Field label="Catalyst Impact" value={data.actionMeta.catalystImpact} />}
            {data.actionMeta.strategyName && <Field label="Strategy" value={data.actionMeta.strategyName} />}
            {data.actionMeta.sizeGuidance && (
              <Field label="Size" value={data.actionMeta.sizeGuidance} className="col-span-3" />
            )}
          </div>
          {data.actionMeta.riskContext && (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg border border-border-light bg-bg-primary/50 px-3 py-1.5">
              <span className="text-3xs font-semibold uppercase tracking-wider text-text-muted">Context</span>
              {data.actionMeta.riskContext
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line, i) => {
                  const colonIdx = line.indexOf(':');
                  const hasKv = colonIdx > 0 && colonIdx < 40;
                  const key = hasKv ? line.slice(0, colonIdx).trim() : null;
                  const value = hasKv ? line.slice(colonIdx + 1).trim() : line;
                  return (
                    <span key={i} className="text-xs leading-snug text-text-secondary">
                      {key && <span className="text-text-muted">{key}:</span>} {value}
                    </span>
                  );
                })}
            </div>
          )}
        </>
      )}

      {/* Key Points + Analysis — side by side, Analysis gets more width */}
      {(data.keyPoints.length > 0 || data.analysis) && (
        <div className="grid grid-cols-1 gap-x-5 md:grid-cols-5">
          {data.keyPoints.length > 0 && (
            <div className="md:col-span-2">
              <SectionRule label="Key Points" />
              <ul className="space-y-1">
                {data.keyPoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs leading-snug text-text-secondary">
                    <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-accent-primary" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.analysis && (
            <div className={data.keyPoints.length > 0 ? 'md:col-span-3' : 'md:col-span-5'}>
              <AnalysisSection analysis={data.analysis} isAction={!!data.actionMeta} />
            </div>
          )}
        </div>
      )}

      {/* Recommendation (intel-specific) */}
      {data.recommendation && (
        <div className="mt-3 rounded-lg border border-accent-primary/20 bg-accent-glow px-3 py-2">
          <span className="text-3xs font-semibold uppercase tracking-wider text-accent-primary">Recommendation</span>
          <p className="mt-0.5 text-xs leading-snug text-text-primary">{data.recommendation}</p>
        </div>
      )}

      {/* Footer: Related tickers + View Source */}
      {((data.relatedTickers && data.relatedTickers.length > 0) || data.link) && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {data.relatedTickers && data.relatedTickers.length > 0 && (
              <>
                <span className="text-3xs font-semibold uppercase tracking-wider text-text-muted">Related</span>
                {data.relatedTickers.map((ticker) => (
                  <span
                    key={ticker}
                    className="rounded bg-bg-tertiary px-1.5 py-0.5 text-2xs font-medium text-text-primary"
                  >
                    {ticker}
                  </span>
                ))}
              </>
            )}
          </div>
          {data.link && (
            <a
              href={data.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-accent-primary transition-colors hover:text-accent-primary/80"
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7 17 17 7M7 7h10v10" />
              </svg>
              Source
            </a>
          )}
        </div>
      )}
    </Modal>
  );
}
