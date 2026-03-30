import { useState, useCallback, useMemo, useEffect } from 'react';
import { useWatchlist, useRemoveFromWatchlist } from '../api';
import type { AssetClass, WatchlistEntry } from '../api';
import EmptyState from '../components/common/empty-state';
import Button from '../components/common/button';
import { PageBlurGate } from '../components/common/page-blur-gate';
import { AddSymbolModal } from '../components/watchlist/add-symbol-modal';
import { SymbolCard, SymbolCardSkeleton } from '../components/watchlist/symbol-card';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Watchlist() {
  return (
    <PageBlurGate requires="jintel" mockContent={<MockWatchlistPage />}>
      <WatchlistContent />
    </PageBlurGate>
  );
}

function WatchlistContent() {
  const [{ data, fetching, error }, refetchWatchlist] = useWatchlist();
  const [, removeFromWatchlist] = useRemoveFromWatchlist();
  const [modalOpen, setModalOpen] = useState(false);
  const [optimisticEntries, setOptimisticEntries] = useState<WatchlistEntry[]>([]);
  const [removedSymbols, setRemovedSymbols] = useState<Set<string>>(new Set());
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);
  const [, setTick] = useState(0); // Forces re-render for "last updated" timestamp

  // Tick every 30s to update "last updated" display
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Clear toast after 3s
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Merge server data with optimistic adds, filter out removed
  const entries = useMemo(() => {
    const server = data?.watchlist ?? [];
    const serverSymbols = new Set(server.map((e) => e.symbol));
    const pending = optimisticEntries.filter((e) => !serverSymbols.has(e.symbol));
    return [...server, ...pending].filter((e) => !removedSymbols.has(e.symbol));
  }, [data?.watchlist, optimisticEntries, removedSymbols]);

  const existingSymbols = useMemo(() => new Set(entries.map((e) => e.symbol)), [entries]);

  // Derive "last updated" from the most recent enrichedAt across all entries
  const lastUpdated = useMemo(() => {
    const dates = (data?.watchlist ?? []).map((e) => e.enrichedAt).filter((d): d is string => d != null);
    if (dates.length === 0) return null;
    return dates.sort().reverse()[0];
  }, [data?.watchlist]);

  const handleAdded = useCallback(
    (added: { symbol: string; name: string; assetClass: AssetClass }) => {
      setOptimisticEntries((prev) => [
        ...prev,
        {
          symbol: added.symbol,
          name: added.name,
          assetClass: added.assetClass,
          addedAt: new Date().toISOString(),
          price: null,
          change: null,
          changePercent: null,
          enrichedAt: null,
        },
      ]);
      refetchWatchlist({ requestPolicy: 'network-only' });
    },
    [refetchWatchlist],
  );

  const handleRemove = useCallback(
    async (symbol: string) => {
      // Optimistically remove
      setRemovingSymbol(symbol);
      setRemovedSymbols((prev) => new Set(prev).add(symbol));

      const result = await removeFromWatchlist({ symbol });
      setRemovingSymbol(null);

      if (result.error || (result.data && !result.data.removeFromWatchlist.success)) {
        // Revert optimistic removal
        setRemovedSymbols((prev) => {
          const next = new Set(prev);
          next.delete(symbol);
          return next;
        });
        setToast({
          message: result.error?.message ?? result.data?.removeFromWatchlist.error ?? 'Failed to remove',
          variant: 'error',
        });
        return;
      }

      // Clean up optimistic entries too
      setOptimisticEntries((prev) => prev.filter((e) => e.symbol !== symbol));
      setToast({ message: `Removed ${symbol}`, variant: 'success' });
      refetchWatchlist({ requestPolicy: 'network-only' });
    },
    [removeFromWatchlist, refetchWatchlist],
  );

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  // First load — show skeleton cards
  if (fetching && !data) {
    return (
      <div className="flex-1 overflow-auto p-6 space-y-6 max-w-5xl mx-auto">
        <PageHeader onAdd={openModal} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SymbolCardSkeleton />
          <SymbolCardSkeleton />
          <SymbolCardSkeleton />
        </div>
        <AddSymbolModal open={modalOpen} onClose={closeModal} existingSymbols={existingSymbols} onAdded={handleAdded} />
      </div>
    );
  }

  // Error state (only when no data at all)
  if (error && entries.length === 0) {
    return (
      <div className="flex-1 p-6">
        <PageHeader onAdd={openModal} />
        <div className="mt-6">
          <EmptyState title="Failed to load watchlist" description={error.message} />
        </div>
        <AddSymbolModal open={modalOpen} onClose={closeModal} existingSymbols={existingSymbols} onAdded={handleAdded} />
      </div>
    );
  }

  // Empty state
  if (entries.length === 0) {
    return (
      <div className="flex-1 p-6">
        <PageHeader onAdd={openModal} />
        <div className="mt-6">
          <EmptyState
            icon={
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            }
            title="No symbols yet"
            description="Track stocks and crypto beyond your portfolio"
            action={
              <Button variant="primary" size="sm" onClick={openModal}>
                + Add your first symbol
              </Button>
            }
          />
        </div>
        <AddSymbolModal open={modalOpen} onClose={closeModal} existingSymbols={existingSymbols} onAdded={handleAdded} />
      </div>
    );
  }

  // Populated state
  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 max-w-5xl mx-auto">
      <PageHeader onAdd={openModal} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <SymbolCard
            key={entry.symbol}
            entry={entry}
            onRemove={handleRemove}
            removing={removingSymbol === entry.symbol}
          />
        ))}
      </div>

      {/* Footer: last updated + toast */}
      <div className="flex items-center justify-between">
        {lastUpdated && <p className="text-xs text-text-muted">Last updated {timeAgo(lastUpdated)}</p>}
        {toast && (
          <p className={`text-xs font-medium ${toast.variant === 'success' ? 'text-success' : 'text-error'}`}>
            {toast.message}
          </p>
        )}
      </div>

      <AddSymbolModal open={modalOpen} onClose={closeModal} existingSymbols={existingSymbols} onAdded={handleAdded} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PageHeader({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="font-headline text-xl text-text-primary">Watchlist</h1>
      <Button variant="primary" size="sm" onClick={onAdd}>
        + Add Symbol
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mock watchlist page shown behind blur gate
// ---------------------------------------------------------------------------

const MOCK_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc', price: '$182.52', change: '+$2.15', pct: '+1.19%', up: true },
  { symbol: 'NVDA', name: 'NVIDIA Corp', price: '$875.28', change: '-$12.45', pct: '-1.40%', up: false },
  { symbol: 'BTC', name: 'Bitcoin', price: '$67,234', change: '+$892', pct: '+1.35%', up: true },
  { symbol: 'TSLA', name: 'Tesla Inc', price: '$248.42', change: '+$5.67', pct: '+2.33%', up: true },
  { symbol: 'MSFT', name: 'Microsoft', price: '$415.60', change: '-$3.22', pct: '-0.77%', up: false },
  { symbol: 'ETH', name: 'Ethereum', price: '$3,420', change: '+$45.30', pct: '+1.34%', up: true },
];

function MockWatchlistPage() {
  return (
    <div className="flex-1 overflow-hidden p-6 space-y-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="font-headline text-xl text-text-primary">Watchlist</h1>
        <div className="rounded-lg bg-accent-primary/30 px-3 py-1.5 text-xs font-medium text-accent-primary">
          + Add Symbol
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MOCK_SYMBOLS.map((s) => (
          <div key={s.symbol} className="rounded-xl border border-border bg-bg-card p-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 flex-shrink-0 rounded-full bg-bg-tertiary" />
              <div>
                <span className="text-sm font-semibold text-text-primary">{s.symbol}</span>
                <p className="text-xs text-text-muted">{s.name}</p>
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-lg font-semibold tabular-nums text-text-primary">{s.price}</span>
              <span className={cn('text-xs tabular-nums', s.up ? 'text-success' : 'text-error')}>
                {s.change} ({s.pct})
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
