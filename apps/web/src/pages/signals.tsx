import { useState } from 'react';
import { useQuery } from 'urql';
import { useSearchParams } from 'react-router';
import { cn } from '../lib/utils';
import { SIGNALS_QUERY } from '../api/documents';
import type { Signal, SignalsQueryResult, SignalsVariables } from '../api/types';
import Badge from '../components/common/badge';
import type { BadgeVariant } from '../components/common/badge';
import Card from '../components/common/card';

const SIGNAL_TYPES = ['ALL', 'NEWS', 'FUNDAMENTAL', 'SENTIMENT', 'TECHNICAL', 'MACRO'] as const;

const typeVariant: Record<string, BadgeVariant> = {
  NEWS: 'info',
  FUNDAMENTAL: 'success',
  SENTIMENT: 'warning',
  TECHNICAL: 'neutral',
  MACRO: 'error',
};

export default function Signals() {
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [tickerFilter, setTickerFilter] = useState('');

  const variables: SignalsVariables = {
    limit: 100,
    ...(typeFilter !== 'ALL' ? { type: typeFilter } : {}),
    ...(tickerFilter ? { ticker: tickerFilter.toUpperCase() } : {}),
    ...(search ? { search } : {}),
  };

  const [result] = useQuery<SignalsQueryResult, SignalsVariables>({
    query: SIGNALS_QUERY,
    variables,
  });

  const signals = result.data?.signals ?? [];
  const loading = result.fetching;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="px-6 pt-6 pb-4">
        <h1 className="text-lg font-semibold text-text-primary">Signals</h1>
        <p className="mt-1 text-sm text-text-muted">
          {loading ? 'Loading...' : `${signals.length} signal${signals.length !== 1 ? 's' : ''}`}
        </p>
      </header>

      {/* Filters */}
      <div className="px-6 pb-4 flex items-center gap-3 flex-wrap">
        {/* Search */}
        <input
          type="text"
          placeholder="Search signals..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 rounded-lg border border-border bg-bg-secondary px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none w-56"
        />

        {/* Ticker filter */}
        <input
          type="text"
          placeholder="Ticker (e.g. AAPL)"
          value={tickerFilter}
          onChange={(e) => setTickerFilter(e.target.value)}
          className="h-8 rounded-lg border border-border bg-bg-secondary px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none w-36"
        />

        {/* Type tabs */}
        <div className="flex gap-1">
          {SIGNAL_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer',
                typeFilter === t
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:text-text-primary',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Signal list */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {!loading && signals.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 py-24">
            <svg
              className="h-14 w-14 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
              />
            </svg>
            <p className="text-base text-text-muted">No signals found. Fetch data sources to ingest signals.</p>
          </div>
        )}

        <div className="space-y-2">
          {signals.map((signal) => (
            <SignalRow key={signal.id} signal={signal} highlighted={signal.id === highlightId} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SignalRow({ signal, highlighted }: { signal: Signal; highlighted: boolean }) {
  const [expanded, setExpanded] = useState(highlighted);
  const variant = typeVariant[signal.type] ?? 'neutral';
  const date = new Date(signal.publishedAt);
  const timeAgo = formatTimeAgo(date);

  return (
    <Card className={cn('p-4 transition-all', highlighted && 'ring-2 ring-accent-primary/50')}>
      <button
        type="button"
        className="flex w-full items-start justify-between cursor-pointer text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={variant} size="sm">
              {signal.type}
            </Badge>
            {signal.tickers.map((t) => (
              <span key={t} className="text-xs font-semibold text-accent-primary">
                {t}
              </span>
            ))}
            <span className="text-xs text-text-muted">{timeAgo}</span>
            <span className="text-xs text-text-muted">· {signal.sourceName}</span>
          </div>
          <p className="text-sm font-medium text-text-primary truncate">{signal.title}</p>
        </div>

        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
          <span className="text-xs text-text-muted">{Math.round(signal.confidence * 100)}%</span>
          <svg
            className={cn('h-4 w-4 text-text-muted transition-transform', expanded && 'rotate-180')}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 border-t border-border pt-3 space-y-3">
          {signal.content && (
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{signal.content}</p>
          )}

          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span>Published: {date.toLocaleString()}</span>
            <span>· ID: {signal.id}</span>
          </div>

          {signal.link && (
            <a
              href={signal.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-accent-primary hover:underline"
            >
              View source
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
            </a>
          )}
        </div>
      )}
    </Card>
  );
}

function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return date.toLocaleDateString();
}
