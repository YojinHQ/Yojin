import { useState, useCallback, useRef, useEffect } from 'react';
import Modal from '../common/modal';
import Button from '../common/button';
import { SymbolLogo } from '../common/symbol-logo';
import Badge from '../common/badge';
import { useAddToWatchlist } from '../../api';
import type { AssetClass } from '../../api';

// ---------------------------------------------------------------------------
// Static symbol catalog — same pattern as add-position-modal
// ---------------------------------------------------------------------------

interface SymbolEntry {
  symbol: string;
  name: string;
  assetClass: AssetClass;
}

const SYMBOL_CATALOG: SymbolEntry[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'EQUITY' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', assetClass: 'EQUITY' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', assetClass: 'EQUITY' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', assetClass: 'EQUITY' },
  { symbol: 'META', name: 'Meta Platforms Inc.', assetClass: 'EQUITY' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', assetClass: 'EQUITY' },
  { symbol: 'TSLA', name: 'Tesla Inc.', assetClass: 'EQUITY' },
  { symbol: 'JPM', name: 'JPMorgan Chase', assetClass: 'EQUITY' },
  { symbol: 'V', name: 'Visa Inc.', assetClass: 'EQUITY' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', assetClass: 'EQUITY' },
  { symbol: 'WMT', name: 'Walmart Inc.', assetClass: 'EQUITY' },
  { symbol: 'PG', name: 'Procter & Gamble', assetClass: 'EQUITY' },
  { symbol: 'MA', name: 'Mastercard Inc.', assetClass: 'EQUITY' },
  { symbol: 'UNH', name: 'UnitedHealth Group', assetClass: 'EQUITY' },
  { symbol: 'HD', name: 'Home Depot Inc.', assetClass: 'EQUITY' },
  { symbol: 'DIS', name: 'Walt Disney Co.', assetClass: 'EQUITY' },
  { symbol: 'NFLX', name: 'Netflix Inc.', assetClass: 'EQUITY' },
  { symbol: 'ADBE', name: 'Adobe Inc.', assetClass: 'EQUITY' },
  { symbol: 'CRM', name: 'Salesforce Inc.', assetClass: 'EQUITY' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', assetClass: 'EQUITY' },
  { symbol: 'INTC', name: 'Intel Corp.', assetClass: 'EQUITY' },
  { symbol: 'PYPL', name: 'PayPal Holdings', assetClass: 'EQUITY' },
  { symbol: 'BA', name: 'Boeing Co.', assetClass: 'EQUITY' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', assetClass: 'EQUITY' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', assetClass: 'EQUITY' },
  { symbol: 'VOO', name: 'Vanguard S&P 500', assetClass: 'EQUITY' },
  { symbol: 'BTC', name: 'Bitcoin', assetClass: 'CRYPTO' },
  { symbol: 'ETH', name: 'Ethereum', assetClass: 'CRYPTO' },
  { symbol: 'SOL', name: 'Solana', assetClass: 'CRYPTO' },
  { symbol: 'ADA', name: 'Cardano', assetClass: 'CRYPTO' },
  { symbol: 'XRP', name: 'Ripple', assetClass: 'CRYPTO' },
  { symbol: 'DOGE', name: 'Dogecoin', assetClass: 'CRYPTO' },
  { symbol: 'DOT', name: 'Polkadot', assetClass: 'CRYPTO' },
  { symbol: 'AVAX', name: 'Avalanche', assetClass: 'CRYPTO' },
  { symbol: 'LINK', name: 'Chainlink', assetClass: 'CRYPTO' },
  { symbol: 'UNI', name: 'Uniswap', assetClass: 'CRYPTO' },
  { symbol: 'AAVE', name: 'Aave Protocol', assetClass: 'CRYPTO' },
  { symbol: 'ATOM', name: 'Cosmos', assetClass: 'CRYPTO' },
  { symbol: 'NEAR', name: 'NEAR Protocol', assetClass: 'CRYPTO' },
  { symbol: 'ARB', name: 'Arbitrum', assetClass: 'CRYPTO' },
  { symbol: 'OP', name: 'Optimism', assetClass: 'CRYPTO' },
];

/** Default recommendations — mix of popular equities and crypto. */
const RECOMMENDED_SYMBOLS = ['AAPL', 'NVDA', 'TSLA', 'AMZN', 'MSFT', 'BTC', 'ETH', 'SOL'];

function getRecommended(existingSymbols: Set<string>): SymbolEntry[] {
  return SYMBOL_CATALOG.filter(
    (entry) => RECOMMENDED_SYMBOLS.includes(entry.symbol) && !existingSymbols.has(entry.symbol),
  );
}

function searchSymbols(query: string, existingSymbols: Set<string>): SymbolEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return SYMBOL_CATALOG.filter(
    (entry) =>
      !existingSymbols.has(entry.symbol) &&
      (entry.symbol.toLowerCase().includes(q) || entry.name.toLowerCase().includes(q)),
  ).slice(0, 8);
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

  const isSearching = debouncedSearch.trim().length > 0;
  const results = isSearching ? searchSymbols(debouncedSearch, existingSymbols) : getRecommended(existingSymbols);

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
            {results.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-text-muted">No results found</p>
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
