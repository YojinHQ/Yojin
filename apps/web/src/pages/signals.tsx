import { useMemo, useState } from 'react';

import type { Signal } from '../api/types';
import type { BadgeVariant } from '../components/common/badge';
import Badge from '../components/common/badge';
import Card from '../components/common/card';
import Spinner from '../components/common/spinner';
import { usePositions, useSignals } from '../api/hooks';

const signalTypeBadge: Record<string, { variant: BadgeVariant; label: string }> = {
  MACRO: { variant: 'info', label: 'Macro' },
  FUNDAMENTAL: { variant: 'success', label: 'Fundamental' },
  SENTIMENT: { variant: 'warning', label: 'Sentiment' },
  TECHNICAL: { variant: 'neutral', label: 'Technical' },
  NEWS: { variant: 'neutral', label: 'News' },
};

const TYPE_OPTIONS = ['ALL', 'PORTFOLIO', 'MACRO', 'FUNDAMENTAL', 'SENTIMENT', 'TECHNICAL', 'NEWS'] as const;

const CONFIDENCE_LEVELS = [
  { value: 0, label: 'All' },
  { value: 0.5, label: '50%+' },
  { value: 0.7, label: '70%+' },
  { value: 0.85, label: '85%+' },
] as const;

const DATE_RANGES = [
  { value: '', label: 'All time' },
  { value: '1d', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
] as const;

function dateRangeToSince(range: string): string | undefined {
  if (!range) return undefined;
  const now = new Date();
  const days = range === '1d' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 0;
  if (!days) return undefined;
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

export default function Signals() {
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [minConfidence, setMinConfidence] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [tickerFilter, setTickerFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [dateRange, setDateRange] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const isPortfolioFilter = typeFilter === 'PORTFOLIO';
  const [{ data, fetching }] = useSignals({
    type: typeFilter === 'ALL' || isPortfolioFilter ? undefined : typeFilter,
    search: search || undefined,
    minConfidence: minConfidence > 0 ? minConfidence : undefined,
    ticker: tickerFilter || undefined,
    sourceId: sourceFilter || undefined,
    since: dateRangeToSince(dateRange),
    limit: isPortfolioFilter ? 500 : 200,
  });
  const [{ data: posData }] = usePositions();

  const positions = posData?.positions ?? [];
  const heldSymbols = new Set(positions.map((p) => p.symbol.toUpperCase()));
  const heldSectors = new Set(
    positions.map((p) => p.sector?.toLowerCase()).filter((s): s is string => s != null && s !== ''),
  );

  const allSignals = data?.signals ?? [];
  const signals = isPortfolioFilter
    ? allSignals.filter((s) => isPortfolioRelevant(s, heldSymbols, heldSectors))
    : allSignals;

  // Extract unique tickers and sources for filter dropdowns
  const { uniqueTickers, uniqueSources } = useMemo(() => {
    const tickers = new Set<string>();
    const sources = new Map<string, string>();
    for (const s of allSignals) {
      for (const t of s.tickers) tickers.add(t.toUpperCase());
      if (s.sourceId && s.sourceName) sources.set(s.sourceId, s.sourceName);
    }
    return {
      uniqueTickers: [...tickers].sort(),
      uniqueSources: [...sources.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    };
  }, [allSignals]);

  const hasActiveFilters = tickerFilter || sourceFilter || dateRange || minConfidence > 0;

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSearch(searchInput.trim());
  }

  function clearAllFilters() {
    setTypeFilter('ALL');
    setMinConfidence(0);
    setSearch('');
    setSearchInput('');
    setTickerFilter('');
    setSourceFilter('');
    setDateRange('');
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      {/* Top bar: type pills + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {TYPE_OPTIONS.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                typeFilter === t
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
              }`}
            >
              {t === 'ALL' ? 'All' : t === 'PORTFOLIO' ? 'My Portfolio' : (signalTypeBadge[t]?.label ?? t)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              showFilters || hasActiveFilters
                ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                : 'border-border text-text-muted hover:text-text-primary hover:border-text-muted'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z"
              />
            </svg>
            Filters
            {hasActiveFilters && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent-primary text-[10px] text-white">
                {[tickerFilter, sourceFilter, dateRange, minConfidence > 0].filter(Boolean).length}
              </span>
            )}
          </button>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search signals..."
                className="rounded-lg border border-border bg-bg-primary pl-8 pr-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none w-56"
              />
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
              </svg>
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setSearchInput('');
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Expanded filters panel */}
      {showFilters && (
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <div className="flex flex-wrap items-end gap-4">
            {/* Ticker filter */}
            <div className="min-w-[140px]">
              <label className="block text-2xs font-medium text-text-muted mb-1">Ticker</label>
              <select
                value={tickerFilter}
                onChange={(e) => setTickerFilter(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg-primary px-2.5 py-1.5 text-sm text-text-primary focus:border-accent-primary focus:outline-none"
              >
                <option value="">All tickers</option>
                {uniqueTickers.map((t) => (
                  <option key={t} value={t}>
                    {t} {heldSymbols.has(t) ? '\u2713' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Source filter */}
            <div className="min-w-[160px]">
              <label className="block text-2xs font-medium text-text-muted mb-1">Source</label>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg-primary px-2.5 py-1.5 text-sm text-text-primary focus:border-accent-primary focus:outline-none"
              >
                <option value="">All sources</option>
                {uniqueSources.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {/* Date range */}
            <div>
              <label className="block text-2xs font-medium text-text-muted mb-1">Date range</label>
              <div className="flex gap-1">
                {DATE_RANGES.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setDateRange(r.value)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      dateRange === r.value
                        ? 'bg-accent-primary/20 text-accent-primary'
                        : 'bg-bg-primary border border-border text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Confidence */}
            <div>
              <label className="block text-2xs font-medium text-text-muted mb-1">Quality</label>
              <div className="flex gap-1">
                {CONFIDENCE_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    onClick={() => setMinConfidence(level.value)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      minConfidence === level.value
                        ? 'bg-accent-primary/20 text-accent-primary'
                        : 'bg-bg-primary border border-border text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Clear all */}
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="text-xs text-text-muted hover:text-error transition-colors pb-1.5"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {/* Active filter tags */}
      {hasActiveFilters && !showFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {tickerFilter && <FilterTag label={`Ticker: ${tickerFilter}`} onRemove={() => setTickerFilter('')} />}
          {sourceFilter && (
            <FilterTag
              label={`Source: ${uniqueSources.find(([id]) => id === sourceFilter)?.[1] ?? sourceFilter}`}
              onRemove={() => setSourceFilter('')}
            />
          )}
          {dateRange && (
            <FilterTag
              label={`Date: ${DATE_RANGES.find((r) => r.value === dateRange)?.label ?? dateRange}`}
              onRemove={() => setDateRange('')}
            />
          )}
          {minConfidence > 0 && (
            <FilterTag label={`Quality: ${Math.round(minConfidence * 100)}%+`} onRemove={() => setMinConfidence(0)} />
          )}
          <button onClick={clearAllFilters} className="text-2xs text-text-muted hover:text-error transition-colors">
            Clear all
          </button>
        </div>
      )}

      {/* Results */}
      <Card section>
        {fetching ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : signals.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-muted">
            {search || typeFilter !== 'ALL' || hasActiveFilters
              ? 'No signals match your filters. Try broadening your criteria.'
              : 'No signals ingested yet. Add a data source and fetch some data.'}
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-text-muted mb-3">
              {signals.length} signal{signals.length !== 1 ? 's' : ''}
              {isPortfolioFilter && ' relevant to your portfolio'}
              {!isPortfolioFilter &&
                typeFilter !== 'ALL' &&
                ` of type ${signalTypeBadge[typeFilter]?.label ?? typeFilter}`}
              {search && ` matching "${search}"`}
            </p>
            {signals.map((signal: Signal) => {
              const badge = signalTypeBadge[signal.type] ?? {
                variant: 'neutral' as BadgeVariant,
                label: signal.type,
              };
              return (
                <div key={signal.id} className="rounded-lg border border-border bg-bg-card px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={badge.variant} size="xs">
                          {badge.label}
                        </Badge>
                        <span className="text-2xs text-text-muted">{signal.sourceName}</span>
                        <span className="text-2xs text-text-muted">
                          {new Date(signal.publishedAt).toLocaleDateString()}
                        </span>
                      </div>
                      {signal.link ? (
                        <a
                          href={signal.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-text-primary hover:text-accent-primary transition-colors line-clamp-2"
                        >
                          {signal.title}
                        </a>
                      ) : (
                        <p className="text-sm font-medium text-text-primary line-clamp-2">{signal.title}</p>
                      )}
                      {signal.tickers.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {signal.tickers.map((t: string) => {
                            const held = heldSymbols.has(t.toUpperCase());
                            return (
                              <button
                                key={t}
                                onClick={() => setTickerFilter(t.toUpperCase())}
                                className={`text-2xs font-mono px-1.5 py-0.5 rounded cursor-pointer hover:ring-1 hover:ring-accent-primary transition-all ${
                                  held
                                    ? 'text-success bg-success/10 ring-1 ring-success/30'
                                    : 'text-accent-primary bg-accent-primary/10'
                                }`}
                                title={`Filter by ${t}${held ? ' (in your portfolio)' : ''}`}
                              >
                                {t}
                                {held && ' \u2713'}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {signal.confidence > 0 && (
                      <span className="text-2xs text-text-muted shrink-0">{Math.round(signal.confidence * 100)}%</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter tag component
// ---------------------------------------------------------------------------

function FilterTag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-primary/10 px-2.5 py-1 text-2xs font-medium text-accent-primary">
      {label}
      <button onClick={onRemove} className="hover:text-error transition-colors">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Portfolio relevance — matches signals beyond direct ticker mentions
// ---------------------------------------------------------------------------

/** Sector keywords found in signal titles/content that map to GICS sectors. */
const SECTOR_KEYWORDS: Record<string, string[]> = {
  'information technology': [
    'tech',
    'software',
    'semiconductor',
    'chip',
    'artificial intelligence',
    'cloud computing',
    'saas',
    'cybersecurity',
    '\\bai\\b', // word-boundary match to avoid false positives like "said", "wait"
  ],
  'health care': ['healthcare', 'pharma', 'biotech', 'fda', 'drug', 'medical', 'hospital'],
  financials: ['bank', 'banking', 'financial', 'insurance', 'lending', 'mortgage', 'credit'],
  energy: ['oil', 'natural gas', 'crude', 'opec', 'drilling', 'petroleum', 'renewable energy', 'solar', 'wind energy'],
  'consumer discretionary': ['retail', 'e-commerce', 'luxury', 'auto', 'automotive', 'housing', 'consumer spending'],
  'consumer staples': ['grocery', 'food', 'beverage', 'tobacco', 'household'],
  industrials: ['manufacturing', 'aerospace', 'defense', 'logistics', 'construction', 'infrastructure'],
  materials: ['mining', 'steel', 'copper', 'gold', 'lithium', 'chemical', 'commodity'],
  utilities: ['utility', 'electric', 'power grid', 'water utility', 'natural gas utility'],
  'real estate': ['real estate', 'reit', 'housing market', 'commercial property', 'mortgage rate'],
  'communication services': ['media', 'streaming', 'telecom', 'advertising', 'social media'],
};

function isPortfolioRelevant(signal: Signal, heldSymbols: Set<string>, heldSectors: Set<string>): boolean {
  // Direct ticker match
  if (signal.tickers.some((t) => heldSymbols.has(t.toUpperCase()))) return true;

  // MACRO signals affect the entire portfolio (fed rates, inflation, GDP)
  if (signal.type === 'MACRO') return true;

  // Sector match — signal content mentions a sector the user is exposed to
  if (heldSectors.size > 0) {
    const text = `${signal.title} ${signal.content ?? ''}`.toLowerCase();
    for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
      if (
        heldSectors.has(sector) &&
        keywords.some((kw) => (kw.startsWith('\\b') ? new RegExp(kw, 'i').test(text) : text.includes(kw)))
      ) {
        return true;
      }
    }
  }

  return false;
}
