import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, Plus, Check, TrendingUp, Sparkles } from 'lucide-react';
import Modal from '../common/modal';
import { SymbolLogo } from '../common/symbol-logo';
import { cn } from '../../lib/utils';
import { useAddToWatchlist, useSearchSymbols } from '../../api';
import type { AssetClass, SymbolSearchResult } from '../../api';

// ---------------------------------------------------------------------------
// Static recommendations — shown when search is empty
// ---------------------------------------------------------------------------

interface SymbolEntry {
  symbol: string;
  name: string;
  assetClass: AssetClass;
}

const RECOMMENDED: SymbolEntry[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', assetClass: 'EQUITY' },
  { symbol: 'TSLA', name: 'Tesla Inc.', assetClass: 'EQUITY' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', assetClass: 'EQUITY' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', assetClass: 'EQUITY' },
  { symbol: 'BTC', name: 'Bitcoin', assetClass: 'CRYPTO' },
  { symbol: 'ETH', name: 'Ethereum', assetClass: 'CRYPTO' },
  { symbol: 'SOL', name: 'Solana', assetClass: 'CRYPTO' },
];

// ---------------------------------------------------------------------------
// Inline result row
// ---------------------------------------------------------------------------

interface ResultRowProps {
  entry: SymbolEntry;
  index: number;
  isAdding: boolean;
  justAdded: boolean;
  onAdd: (entry: SymbolEntry) => void;
}

function ResultRow({ entry, index, isAdding, justAdded, onAdd }: ResultRowProps) {
  const isCrypto = entry.assetClass === 'CRYPTO';

  return (
    <button
      type="button"
      disabled={isAdding || justAdded}
      onClick={() => onAdd(entry)}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200',
        'hover:bg-white/[0.04] active:scale-[0.995]',
        'disabled:pointer-events-none disabled:cursor-default',
        justAdded && 'bg-success/[0.06]',
      )}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Logo */}
      <SymbolLogo symbol={entry.symbol} assetClass={isCrypto ? 'crypto' : 'equity'} size="md" />

      {/* Symbol + Name */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight text-text-primary">{entry.symbol}</span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1 py-px text-3xs font-medium uppercase tracking-wider',
              isCrypto ? 'bg-market/10 text-market' : 'bg-info/10 text-info',
            )}
          >
            {isCrypto ? 'Crypto' : 'Stock'}
          </span>
        </div>
        <span className="truncate text-xs text-text-muted">{entry.name}</span>
      </div>

      {/* Add button area */}
      <div className="flex-shrink-0">
        {justAdded ? (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-success/15 text-success">
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        ) : isAdding ? (
          <span className="inline-flex h-7 w-7 items-center justify-center">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-accent-primary border-t-transparent" />
          </span>
        ) : (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-lg px-2 py-1 cursor-pointer',
              'bg-white/[0.04] text-xs text-text-muted',
              'transition-all duration-200',
              'group-hover:bg-accent-primary/15 group-hover:text-accent-primary',
              'group-hover:shadow-[0_0_12px_rgba(255,90,94,0.1)]',
            )}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Add
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AddSymbolModalProps {
  open: boolean;
  onClose: () => void;
  /** Symbols already in the watchlist — prevents duplicate adds in the UI. */
  existingSymbols: Set<string>;
  /** Called after a successful add so the parent can optimistically update. */
  onAdded: (entry: { symbol: string; name: string; assetClass: AssetClass }) => void;
}

export function AddSymbolModal({ open, onClose, existingSymbols, onAdded }: AddSymbolModalProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);
  const [addingSymbol, setAddingSymbol] = useState<string | null>(null);
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const recentlyAddedTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [, addToWatchlist] = useAddToWatchlist();

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Auto-focus search input when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // Clean up recently-added timers on close
      for (const timer of recentlyAddedTimers.current.values()) clearTimeout(timer);
      recentlyAddedTimers.current.clear();
      setTimeout(() => setRecentlyAdded(new Set()), 0);
    }
  }, [open]);

  // Clear toast after 3s
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Live search via Jintel
  const isSearching = debouncedSearch.trim().length > 0;
  const [searchResult] = useSearchSymbols(debouncedSearch.trim(), 10);
  const apiResults: SymbolEntry[] = (searchResult.data?.searchSymbols ?? [])
    .filter((r: SymbolSearchResult) => !existingSymbols.has(r.symbol))
    .map((r: SymbolSearchResult) => ({ symbol: r.symbol, name: r.name, assetClass: r.assetClass }));

  // When not searching, show static recommendations (filtered by existing)
  const recommendations = RECOMMENDED.filter((e) => !existingSymbols.has(e.symbol));
  const results = isSearching ? apiResults : recommendations;
  const isLoading = isSearching && searchResult.fetching;

  const handleAdd = useCallback(
    async (entry: SymbolEntry) => {
      setAddingSymbol(entry.symbol);

      const result = await addToWatchlist({
        symbol: entry.symbol,
        name: entry.name,
        assetClass: entry.assetClass,
      });

      setAddingSymbol(null);

      if (result.error) {
        setToast({ message: result.error.message, variant: 'error' });
        return;
      }

      if (result.data && !result.data.addToWatchlist.success) {
        const errMsg = result.data.addToWatchlist.error ?? 'Failed to add';
        setToast({ message: errMsg, variant: 'error' });
        return;
      }

      // Success — show checkmark briefly, then notify parent
      setRecentlyAdded((prev) => new Set(prev).add(entry.symbol));
      const timer = setTimeout(() => {
        setRecentlyAdded((prev) => {
          const next = new Set(prev);
          next.delete(entry.symbol);
          return next;
        });
        recentlyAddedTimers.current.delete(entry.symbol);
      }, 1200);
      // Clear any existing timer for this symbol
      const existing = recentlyAddedTimers.current.get(entry.symbol);
      if (existing) clearTimeout(existing);
      recentlyAddedTimers.current.set(entry.symbol, timer);

      onAdded({ symbol: entry.symbol, name: entry.name, assetClass: entry.assetClass });
      setSearch('');
      setDebouncedSearch('');
      setToast({ message: `${entry.symbol} added to watchlist`, variant: 'success' });
    },
    [addToWatchlist, onAdded],
  );

  const handleClose = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
    setToast(null);
    setAddingSymbol(null);
    onClose();
  }, [onClose]);

  return (
    <Modal open={open} onClose={handleClose} maxWidth="max-w-md">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-headline text-lg text-text-primary">Add to Watchlist</h2>
            <p className="mt-0.5 text-xs text-text-muted">Track assets you're interested in</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary cursor-pointer"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            ref={inputRef}
            className={cn(
              'w-full rounded-xl border border-border bg-bg-primary/60 py-2.5 pl-10 pr-3',
              'text-sm text-text-primary placeholder:text-text-muted',
              'outline-none transition-all duration-200',
              'focus-visible:border-accent-primary/50 focus-visible:bg-bg-primary',
              'focus-visible:shadow-[0_0_0_3px_rgba(255,90,94,0.08)]',
            )}
            placeholder="Search symbol or company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearch('');
                setDebouncedSearch('');
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Results */}
        <div>
          {!isSearching && results.length > 0 && (
            <div className="mb-2 flex items-center gap-2 px-1">
              <TrendingUp className="h-3 w-3 text-text-muted" />
              <span className="text-2xs font-medium uppercase tracking-wider text-text-muted">Popular</span>
              <div className="h-px flex-1 bg-border/50" />
            </div>
          )}
          {isSearching && !isLoading && apiResults.length > 0 && (
            <div className="mb-2 flex items-center gap-2 px-1">
              <Sparkles className="h-3 w-3 text-text-muted" />
              <span className="text-2xs font-medium uppercase tracking-wider text-text-muted">
                {apiResults.length} result{apiResults.length !== 1 ? 's' : ''}
              </span>
              <div className="h-px flex-1 bg-border/50" />
            </div>
          )}
          <div className="h-[304px] overflow-y-auto overflow-x-hidden rounded-lg">
            {isLoading ? (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
                <span className="text-xs text-text-muted">Searching...</span>
              </div>
            ) : results.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <Search className="h-8 w-8 text-text-muted/40" />
                <p className="text-sm font-medium text-text-muted">
                  {isSearching ? 'No results found' : 'All popular symbols added'}
                </p>
                <p className="text-xs text-text-muted/60">
                  {isSearching ? 'Try a different symbol or company name' : 'Search for more assets above'}
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {results.map((entry, i) => (
                  <ResultRow
                    key={entry.symbol}
                    entry={entry}
                    index={i}
                    isAdding={addingSymbol === entry.symbol}
                    justAdded={recentlyAdded.has(entry.symbol)}
                    onAdd={handleAdd}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Toast notification */}
        {toast && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium',
              'animate-[fadeSlideIn_0.2s_ease-out]',
              toast.variant === 'success' ? 'bg-success/8 text-success' : 'bg-error/8 text-error',
            )}
          >
            {toast.variant === 'success' ? (
              <Check className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2.5} />
            ) : (
              <svg
                className="h-3.5 w-3.5 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                />
              </svg>
            )}
            {toast.message}
          </div>
        )}
      </div>
    </Modal>
  );
}
