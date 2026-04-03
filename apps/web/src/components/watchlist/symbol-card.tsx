import { useState, useCallback } from 'react';
import { SymbolLogo } from '../common/symbol-logo';
import Button from '../common/button';
import { cn } from '../../lib/utils';
import { formatPrice } from '../../lib/format';
import type { WatchlistEntry } from '../../api';

// ---------------------------------------------------------------------------
// Symbol Card
// ---------------------------------------------------------------------------

interface SymbolCardProps {
  entry: WatchlistEntry;
  onRemove: (symbol: string) => void;
  removing?: boolean;
}

export function SymbolCard({ entry, onRemove, removing }: SymbolCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const hasQuote = entry.price != null;
  const isUp = (entry.changePercent ?? 0) > 0;
  const isDown = (entry.changePercent ?? 0) < 0;

  const handleRemoveClick = useCallback(() => setConfirmOpen(true), []);
  const handleCancel = useCallback(() => setConfirmOpen(false), []);
  const handleConfirm = useCallback(() => {
    setConfirmOpen(false);
    onRemove(entry.symbol);
  }, [onRemove, entry.symbol]);

  return (
    <div className="group/card relative rounded-xl border border-border bg-bg-card p-4 transition-colors hover:border-border-light">
      {/* Remove confirm popover */}
      {confirmOpen && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-bg-secondary/95 backdrop-blur-sm">
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

      {/* Header: logo + symbol + name + remove button */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <SymbolLogo
            symbol={entry.symbol}
            assetClass={entry.assetClass === 'CRYPTO' ? 'crypto' : 'equity'}
            size="md"
          />
          <div className="min-w-0">
            <span className="text-sm font-semibold text-text-primary">{entry.symbol}</span>
            <p className="truncate text-xs text-text-muted">{entry.name}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRemoveClick}
          className="cursor-pointer flex-shrink-0 rounded-md p-1 text-text-muted opacity-0 transition-all hover:bg-error/10 hover:text-error group-hover/card:opacity-100"
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

      {/* Price + Change */}
      <div className="mt-3 flex items-end justify-between">
        {hasQuote ? (
          <>
            <span className="text-lg font-semibold text-text-primary">{formatPrice(entry.price ?? 0)}</span>
            <span
              className={cn('text-sm font-medium', isUp ? 'text-success' : isDown ? 'text-error' : 'text-text-muted')}
            >
              {isUp ? '\u25B2' : isDown ? '\u25BC' : ''} {Math.abs(entry.changePercent ?? 0).toFixed(2)}%
            </span>
          </>
        ) : (
          <>
            <span className="text-sm text-text-muted">—</span>
            <span className="text-xs text-text-muted">No data</span>
          </>
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
        <div className="h-5 w-20 rounded bg-bg-tertiary" />
        <div className="h-4 w-14 rounded bg-bg-tertiary" />
      </div>
    </div>
  );
}
