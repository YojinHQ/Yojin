import { useState, useCallback } from 'react';
import { SymbolLogo } from '../common/symbol-logo';
import Button from '../common/button';
import { cn } from '../../lib/utils';
import { formatSharePrice } from '../../lib/format';
import { getMarketElapsedMinutes } from '../../hooks/use-market-status';
import type { WatchlistEntry } from '../../api';
import type { MarketStatus } from '../../hooks/use-market-status';

// ---------------------------------------------------------------------------
// Sparkline — SVG polyline matching positions-preview pattern
// ---------------------------------------------------------------------------

function WatchlistSparkline({
  data,
  symbol,
  dayChangePercent,
  isMarketOpen,
}: {
  data: number[];
  symbol: string;
  dayChangePercent: number;
  isMarketOpen: boolean;
}) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Progressive reveal: during market hours, width proportional to elapsed trading day
  const MARKET_DURATION = 390;
  const elapsed = getMarketElapsedMinutes();
  const progressWidth = isMarketOpen ? Math.min(elapsed / MARKET_DURATION, 1) * 120 : 120;

  const coords = data.map((v, i) => {
    const x = (i / (data.length - 1)) * progressWidth;
    const y = 32 - ((v - min) / range) * 24 - 4;
    return { x, y };
  });

  const points = coords.map((c) => `${c.x},${c.y}`).join(' ');

  const isNegative = dayChangePercent < 0;
  const color =
    dayChangePercent > 0 ? 'var(--color-success)' : isNegative ? 'var(--color-error)' : 'var(--color-text-muted)';
  const gradId = `wl-sparkline-${symbol}`;

  // Derive previous close baseline from last data point and day change %
  const showBaseline = dayChangePercent !== 0;
  let baselineY: number | undefined;
  if (showBaseline) {
    const currentPrice = data[data.length - 1];
    const prevClose = currentPrice / (1 + dayChangePercent / 100);
    const rawY = 32 - ((prevClose - min) / range) * 24 - 4;
    baselineY = Math.max(0.5, Math.min(31.5, rawY));
  }

  // Positive: fill below line to bottom; Negative: fill above line to baseline
  const fillCloseY = isNegative && baselineY != null ? baselineY : 32;
  const fillPoints = `0,${fillCloseY} ${points} ${progressWidth},${fillCloseY}`;

  const gradTopOpacity = isNegative ? 0 : 0.2;
  const gradBottomOpacity = isNegative ? 0.2 : 0;

  return (
    <div className="pointer-events-none h-7 w-[80px]">
      <svg viewBox="0 0 120 32" className="h-full w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={gradTopOpacity} />
            <stop offset="100%" stopColor={color} stopOpacity={gradBottomOpacity} />
          </linearGradient>
        </defs>
        <polygon points={fillPoints} fill={`url(#${gradId})`} />
        {baselineY != null && (
          <line
            x1="0"
            x2="120"
            y1={baselineY}
            y2={baselineY}
            stroke="var(--color-text-muted)"
            strokeWidth="1"
            strokeDasharray="3 2"
            opacity="0.5"
          />
        )}
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extended Hours Badge
// ---------------------------------------------------------------------------

function getExtendedHoursInfo(
  status: MarketStatus,
  entry: WatchlistEntry,
): { label: string; price: number; changePercent: number } | null {
  if (status === 'pre-market' && entry.preMarketPrice != null && entry.preMarketChangePercent != null) {
    return { label: 'PRE', price: entry.preMarketPrice, changePercent: entry.preMarketChangePercent };
  }
  if (
    (status === 'after-hours' || status === 'closed') &&
    entry.postMarketPrice != null &&
    entry.postMarketChangePercent != null
  ) {
    return { label: 'AH', price: entry.postMarketPrice, changePercent: entry.postMarketChangePercent };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Symbol Card
// ---------------------------------------------------------------------------

interface SymbolCardProps {
  entry: WatchlistEntry;
  onRemove: (symbol: string) => void;
  onSelect: (symbol: string) => void;
  removing?: boolean;
  marketStatus: MarketStatus;
}

export function SymbolCard({ entry, onRemove, onSelect, removing, marketStatus }: SymbolCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const hasQuote = entry.price != null;
  const isUp = (entry.changePercent ?? 0) > 0;
  const isDown = (entry.changePercent ?? 0) < 0;

  const extended = entry.assetClass !== 'CRYPTO' ? getExtendedHoursInfo(marketStatus, entry) : null;

  const handleRemoveClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmOpen(true);
  }, []);
  const handleCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmOpen(false);
  }, []);
  const handleConfirm = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setConfirmOpen(false);
      onRemove(entry.symbol);
    },
    [onRemove, entry.symbol],
  );

  const handleCardClick = useCallback(() => {
    if (!confirmOpen) onSelect(entry.symbol);
  }, [confirmOpen, onSelect, entry.symbol]);

  return (
    <div className="group/card relative rounded-xl border border-border bg-bg-card transition-colors hover:border-border-light">
      {/* Accessible clickable overlay for the entire card */}
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:outline-none"
        onClick={handleCardClick}
        aria-label={`View ${entry.symbol} ${entry.name} details`}
      />

      {/* Remove confirm popover */}
      {confirmOpen && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl bg-bg-secondary/95 backdrop-blur-sm">
          <p className="text-sm text-text-secondary">
            Remove <span className="font-semibold text-text-primary">{entry.symbol}</span>?
          </p>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" loading={removing} onClick={handleConfirm}>
              Remove
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="relative z-[1] pointer-events-none p-4">
        {/* Header: logo + symbol + name + remove button */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <SymbolLogo
              symbol={entry.symbol}
              assetClass={entry.assetClass === 'CRYPTO' ? 'crypto' : 'equity'}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <span className="text-sm font-semibold text-text-primary">{entry.symbol}</span>
              <p className="truncate text-xs text-text-muted">{entry.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRemoveClick}
            className="pointer-events-auto relative z-10 cursor-pointer flex-shrink-0 rounded-md p-1 text-text-muted opacity-0 transition-all hover:bg-error/10 hover:text-error group-hover/card:opacity-100"
            aria-label={`Remove ${entry.symbol}`}
            title="Remove from watchlist"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            </svg>
          </button>
        </div>

        {/* Sparkline + Price row */}
        <div className="mt-3 flex items-end justify-between gap-2">
          {/* Sparkline */}
          <div className="flex-shrink-0">
            {entry.sparkline && entry.sparkline.length >= 2 ? (
              <WatchlistSparkline
                data={entry.sparkline}
                symbol={entry.symbol}
                dayChangePercent={entry.changePercent ?? 0}
                isMarketOpen={entry.assetClass !== 'CRYPTO' && marketStatus === 'open'}
              />
            ) : (
              <div className="h-7 w-[80px]" />
            )}
          </div>

          {/* Price + Change */}
          {hasQuote ? (
            <div className="text-right">
              <span className="text-lg font-semibold tabular-nums text-text-primary">
                {formatSharePrice(entry.price ?? 0)}
              </span>
              <div className="flex items-center justify-end gap-1">
                <span
                  className={cn(
                    'text-xs font-medium tabular-nums',
                    isUp ? 'text-success' : isDown ? 'text-error' : 'text-text-muted',
                  )}
                >
                  {isUp ? '\u25B2' : isDown ? '\u25BC' : ''} {Math.abs(entry.changePercent ?? 0).toFixed(2)}%
                </span>
              </div>
            </div>
          ) : (
            <div className="text-right">
              <span className="text-sm text-text-muted">&mdash;</span>
              <p className="text-xs text-text-muted">No data</p>
            </div>
          )}
        </div>

        {/* Extended hours row */}
        {extended && (
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider text-text-muted">
              {extended.label}
            </span>
            <span className="text-2xs font-medium tabular-nums text-text-secondary">
              {formatSharePrice(extended.price)}
            </span>
            <span
              className={cn(
                'text-2xs font-medium tabular-nums',
                extended.changePercent > 0
                  ? 'text-success'
                  : extended.changePercent < 0
                    ? 'text-error'
                    : 'text-text-muted',
              )}
            >
              {extended.changePercent >= 0 ? '+' : ''}
              {extended.changePercent.toFixed(2)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton Card
// ---------------------------------------------------------------------------

export function SymbolCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 animate-pulse">
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-full bg-bg-tertiary" />
        <div className="space-y-1.5">
          <div className="h-3.5 w-12 rounded bg-bg-tertiary" />
          <div className="h-3 w-24 rounded bg-bg-tertiary" />
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div className="h-7 w-[80px] rounded bg-bg-tertiary" />
        <div className="space-y-1">
          <div className="h-5 w-20 rounded bg-bg-tertiary" />
          <div className="h-3 w-14 rounded bg-bg-tertiary ml-auto" />
        </div>
      </div>
    </div>
  );
}
