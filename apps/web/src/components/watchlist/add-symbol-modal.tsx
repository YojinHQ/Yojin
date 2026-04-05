import { useState, useCallback, useRef, useEffect } from 'react';
import Modal from '../common/modal';
import Button from '../common/button';
import { SymbolLogo } from '../common/symbol-logo';
import Badge from '../common/badge';
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
  const inputRef = useRef<HTMLInputElement>(null);

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

      // Success — notify parent, clear search, show toast
      onAdded({ symbol: entry.symbol, name: entry.name, assetClass: entry.assetClass });
      setSearch('');
      setDebouncedSearch('');
      setToast({ message: `Added ${entry.symbol} to watchlist`, variant: 'success' });
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
    <Modal open={open} onClose={handleClose} title="Add to Watchlist" maxWidth="max-w-md">
      <div className="space-y-4">
        {/* Search input */}
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            ref={inputRef}
            className="w-full rounded-lg border border-border bg-bg-card py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus-visible:border-accent-primary focus-visible:ring-2 focus-visible:ring-accent-primary/30"
            placeholder="Search symbol or company name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Results — fixed height, scrolls internally */}
        <div>
          {!isSearching && results.length > 0 && (
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Popular</p>
          )}
          <div className="h-72 overflow-auto">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
              </div>
            ) : results.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-text-muted">
                {isSearching ? 'No results found' : 'All popular symbols already added'}
              </p>
            ) : (
              <div className="divide-y divide-border/40">
                {results.map((entry) => (
                  <div
                    key={entry.symbol}
                    className="flex items-center justify-between px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="flex items-center gap-3">
                      <SymbolLogo
                        symbol={entry.symbol}
                        assetClass={entry.assetClass === 'CRYPTO' ? 'crypto' : 'equity'}
                        size="md"
                      />
                      <div>
                        <span className="text-sm font-medium text-text-primary">{entry.symbol}</span>
                        <span className="ml-2 text-sm text-text-muted">{entry.name}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={entry.assetClass === 'CRYPTO' ? 'accent' : 'neutral'} size="xs" outline>
                        {entry.assetClass === 'CRYPTO' ? 'Crypto' : 'Stock'}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={addingSymbol === entry.symbol}
                        onClick={() => handleAdd(entry)}
                      >
                        + Add
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Toast notification */}
        {toast && (
          <div
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              toast.variant === 'success' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
            }`}
          >
            {toast.message}
          </div>
        )}
      </div>
    </Modal>
  );
}
