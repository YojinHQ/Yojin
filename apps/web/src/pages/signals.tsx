import { useState, useMemo, useCallback } from 'react';
import { useQuery } from 'urql';
import { Link, useSearchParams } from 'react-router';
import { cn } from '../lib/utils';
import { SIGNALS_QUERY, LATEST_INSIGHT_REPORT_QUERY } from '../api/documents';
import type { Signal, SignalsQueryResult, SignalsVariables, LatestInsightReportQueryResult } from '../api/types';
import Badge from '../components/common/badge';
import type { BadgeVariant } from '../components/common/badge';
import Card from '../components/common/card';

const SIGNAL_TYPES = ['ALL', 'NEWS', 'FUNDAMENTAL', 'SENTIMENT', 'TECHNICAL', 'MACRO'] as const;

const DATE_RANGES = [
  { label: '24h', value: '1' },
  { label: '7d', value: '7' },
  { label: '30d', value: '30' },
  { label: 'All', value: '' },
] as const;

const CONFIDENCE_PRESETS = [
  { label: 'All', value: 0 },
  { label: '>50%', value: 0.5 },
  { label: '>75%', value: 0.75 },
  { label: '>90%', value: 0.9 },
] as const;

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
  const initialTicker = searchParams.get('ticker') ?? '';
  const initialType = searchParams.get('type') ?? 'ALL';
  const initialSearch = searchParams.get('search') ?? '';

  const [search, setSearch] = useState(initialSearch);
  const [typeFilter, setTypeFilter] = useState<string>(initialType);
  const [tickerFilter, setTickerFilter] = useState(initialTicker);
  const [minConfidence, setMinConfidence] = useState(0);

  // Date range: store days label, compute `since` via state initializer + callback
  const [dateRangeLabel, setDateRangeLabel] = useState('');
  const [since, setSince] = useState<string | undefined>(undefined);
  const setDateRange = useCallback((days: string) => {
    setDateRangeLabel(days);
    setSince(days ? new Date(Date.now() - Number(days) * 86_400_000).toISOString() : undefined);
  }, []);

  const variables: SignalsVariables = {
    limit: 200,
    ...(typeFilter !== 'ALL' ? { type: typeFilter } : {}),
    ...(tickerFilter ? { ticker: tickerFilter.toUpperCase() } : {}),
    ...(search ? { search } : {}),
    ...(since ? { since } : {}),
    ...(minConfidence > 0 ? { minConfidence } : {}),
  };

  const [result] = useQuery<SignalsQueryResult, SignalsVariables>({
    query: SIGNALS_QUERY,
    variables,
  });

  // Cross-reference with latest insight report to show which signals were used
  const [insightResult] = useQuery<LatestInsightReportQueryResult>({
    query: LATEST_INSIGHT_REPORT_QUERY,
  });

  const insightSignalIds = useMemo(() => {
    const report = insightResult.data?.latestInsightReport;
    if (!report) return new Set<string>();
    const ids = new Set<string>();
    for (const pos of report.positions) {
      for (const sig of pos.keySignals) {
        ids.add(sig.signalId);
      }
    }
    return ids;
  }, [insightResult.data]);

  // Build a map of signalId → impact from the insight report
  const insightSignalImpact = useMemo(() => {
    const report = insightResult.data?.latestInsightReport;
    if (!report) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const pos of report.positions) {
      for (const sig of pos.keySignals) {
        map.set(sig.signalId, sig.impact);
      }
    }
    return map;
  }, [insightResult.data]);

  const signals = useMemo(() => result.data?.signals ?? [], [result.data]);
  const loading = result.fetching;

  // Collect unique sources for source filter
  const sources = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of signals) {
      if (!map.has(s.sourceId)) map.set(s.sourceId, s.sourceName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [signals]);
  const [sourceFilter, setSourceFilter] = useState('');

  const filteredSignals = sourceFilter ? signals.filter((s) => s.sourceId === sourceFilter) : signals;

  // Stats for header
  const usedInInsights = filteredSignals.filter((s) => insightSignalIds.has(s.id)).length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Signals</h1>
            <p className="mt-1 text-sm text-text-muted">
              {loading
                ? 'Loading...'
                : `${filteredSignals.length} signal${filteredSignals.length !== 1 ? 's' : ''}${usedInInsights > 0 ? ` · ${usedInInsights} used in insights` : ''}`}
            </p>
          </div>
          {insightSignalIds.size > 0 && (
            <Link
              to="/insights"
              className="text-xs font-medium text-accent-primary hover:underline flex items-center gap-1"
            >
              View Insights
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          )}
        </div>
      </header>

      {/* Filters */}
      <div className="px-6 pb-4 space-y-3">
        {/* Row 1: Search + Ticker + Source */}
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Search signals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 rounded-lg border border-border bg-bg-secondary px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none w-56"
          />
          <input
            type="text"
            placeholder="Ticker (e.g. AAPL)"
            value={tickerFilter}
            onChange={(e) => setTickerFilter(e.target.value)}
            className="h-8 rounded-lg border border-border bg-bg-secondary px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none w-36"
          />
          {sources.length > 1 && (
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="h-8 rounded-lg border border-border bg-bg-secondary px-2 text-sm text-text-primary focus:border-accent-primary focus:outline-none"
            >
              <option value="">All sources</option>
              {sources.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Row 2: Type tabs + Date range + Confidence */}
        <div className="flex items-center gap-4 flex-wrap">
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

          <span className="h-4 w-px bg-border" />

          {/* Date range */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-muted mr-1">Period:</span>
            {DATE_RANGES.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => setDateRange(d.value)}
                className={cn(
                  'px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer',
                  dateRangeLabel === d.value
                    ? 'bg-accent-primary/10 text-accent-primary'
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>

          <span className="h-4 w-px bg-border" />

          {/* Confidence */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-muted mr-1">Confidence:</span>
            {CONFIDENCE_PRESETS.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => setMinConfidence(c.value)}
                className={cn(
                  'px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer',
                  minConfidence === c.value
                    ? 'bg-accent-primary/10 text-accent-primary'
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Signal list */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {!loading && filteredSignals.length === 0 && (
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
          {filteredSignals.map((signal) => (
            <SignalRow
              key={signal.id}
              signal={signal}
              highlighted={signal.id === highlightId}
              usedInInsight={insightSignalIds.has(signal.id)}
              insightImpact={insightSignalImpact.get(signal.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SignalRow({
  signal,
  highlighted,
  usedInInsight,
  insightImpact,
}: {
  signal: Signal;
  highlighted: boolean;
  usedInInsight: boolean;
  insightImpact?: string;
}) {
  const [expanded, setExpanded] = useState(highlighted);
  const variant = typeVariant[signal.type] ?? 'neutral';
  const date = new Date(signal.publishedAt);
  const timeAgo = formatTimeAgo(date);
  const confidencePct = Math.round(signal.confidence * 100);

  return (
    <Card className={cn('p-4 transition-all', highlighted && 'ring-2 ring-accent-primary/50')}>
      <button
        type="button"
        className="flex w-full items-start justify-between cursor-pointer text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant={variant} size="sm">
              {signal.type}
            </Badge>
            {signal.tickers.map((t) => (
              <Link
                key={t}
                to={`/signals?ticker=${t}`}
                onClick={(e) => e.stopPropagation()}
                className="text-xs font-semibold text-accent-primary hover:underline"
              >
                {t}
              </Link>
            ))}
            <span className="text-xs text-text-muted">{timeAgo}</span>
            <span className="text-xs text-text-muted">· {signal.sourceName}</span>
            {/* "Used in Insights" indicator */}
            {usedInInsight && (
              <Link
                to="/insights"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
              >
                <Badge variant="accent" size="xs">
                  {insightImpact === 'POSITIVE' && '↑ '}
                  {insightImpact === 'NEGATIVE' && '↓ '}
                  IN INSIGHTS
                </Badge>
              </Link>
            )}
          </div>
          <p className="text-sm font-medium text-text-primary truncate">{signal.title}</p>
        </div>

        <div className="flex items-center gap-3 ml-3 flex-shrink-0">
          {/* Confidence bar */}
          <div className="flex items-center gap-2 w-24">
            <div className="flex-1 h-1.5 rounded-full bg-bg-tertiary">
              <div
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  confidencePct >= 80 ? 'bg-success' : confidencePct >= 50 ? 'bg-warning' : 'bg-error',
                )}
                style={{ width: `${confidencePct}%` }}
              />
            </div>
            <span
              className={cn(
                'text-xs font-medium w-8 text-right',
                confidencePct >= 80 ? 'text-success' : confidencePct >= 50 ? 'text-warning' : 'text-text-muted',
              )}
            >
              {confidencePct}%
            </span>
          </div>
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

          <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
            <span>Published: {date.toLocaleString()}</span>
            <span>· Ingested: {new Date(signal.ingestedAt).toLocaleString()}</span>
            <span>· Source: {signal.sourceName}</span>
          </div>

          <div className="flex items-center gap-3">
            {signal.link && (
              <a
                href={signal.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-accent-primary hover:underline"
              >
                View original source
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                  />
                </svg>
              </a>
            )}
            {usedInInsight && (
              <Link
                to="/insights"
                className="inline-flex items-center gap-1.5 text-sm text-accent-primary hover:underline"
              >
                View insight analysis
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605"
                  />
                </svg>
              </Link>
            )}
          </div>
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
