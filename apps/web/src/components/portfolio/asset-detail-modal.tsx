import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from 'urql';
import { cn } from '../../lib/utils';
import { useAssetDetailModal } from '../../lib/asset-detail-modal-context';
import { useFeatureStatus } from '../../lib/feature-status';
import { usePortfolio, useQuote, useOnPriceMove } from '../../api';
import type { Position, Quote, PositionInsight, InsightRating } from '../../api/types';
import { LATEST_INSIGHT_REPORT_QUERY, SIGNALS_QUERY, PRICE_HISTORY_QUERY } from '../../api/documents';
import type {
  LatestInsightReportQueryResult,
  SignalsQueryResult,
  SignalsVariables,
  Signal,
  PriceHistoryQueryResult,
  PriceHistoryQueryVariables,
} from '../../api/types';
import { PriceChart } from '../charts/price-chart';
import Card from '../common/card';
import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';
import Modal from '../common/modal';
import Spinner from '../common/spinner';
import { SymbolLogo } from '../common/symbol-logo';
import { GateCard } from '../common/feature-gate';
import { timeAgo } from '../../lib/utils';

/** Stable 7-day lookback for signal queries (computed once at module load). */
const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

const PRICE_RANGES = ['5d', '1m', '3m', '6m', '1y'] as const;
type PriceRange = (typeof PRICE_RANGES)[number];
const RANGE_LABELS: Record<PriceRange, string> = { '5d': '5D', '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y' };

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPnl(value: number): string {
  return `${value >= 0 ? '+' : ''}${fmtCurrency(value)}`;
}

function fmtPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function fmtVolume(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtQuantity(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  return parseFloat(value.toPrecision(6)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function pnlColor(value: number): string {
  if (Math.abs(value) < 0.01) return 'text-text-primary';
  return value > 0 ? 'text-success' : 'text-error';
}

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

const ratingVariant: Record<InsightRating, BadgeVariant> = {
  VERY_BULLISH: 'success',
  BULLISH: 'success',
  NEUTRAL: 'warning',
  BEARISH: 'error',
  VERY_BEARISH: 'error',
};

const ratingLabel: Record<InsightRating, string> = {
  VERY_BULLISH: 'Very Bullish',
  BULLISH: 'Bullish',
  NEUTRAL: 'Neutral',
  BEARISH: 'Bearish',
  VERY_BEARISH: 'Very Bearish',
};

const signalTypeVariant: Record<string, BadgeVariant> = {
  NEWS: 'info',
  FUNDAMENTAL: 'success',
  SENTIMENT: 'warning',
  TECHNICAL: 'neutral',
  MACRO: 'error',
  FILINGS: 'neutral',
  SOCIALS: 'info',
  TRADING_LOGIC_TRIGGER: 'warning',
};

const sentimentVariant: Record<string, BadgeVariant> = {
  BULLISH: 'success',
  BEARISH: 'error',
  NEUTRAL: 'neutral',
  MIXED: 'warning',
};

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
      <p className={cn('mt-1.5 text-lg font-semibold', color ?? 'text-text-primary')}>{value}</p>
      {sub && <p className={cn('mt-0.5 text-xs', color ?? 'text-text-muted')}>{sub}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Day range bar
// ---------------------------------------------------------------------------

function DayRange({ low, high, current }: { low: number; high: number; current: number }) {
  const range = high - low;
  const pct = range > 0 ? ((current - low) / range) * 100 : 50;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-text-muted">
        <span>{fmtCurrency(low)}</span>
        <span>Day Range</span>
        <span>{fmtCurrency(high)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-bg-tertiary">
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-accent-primary border-2 border-bg-card"
          style={{ left: `${Math.min(Math.max(pct, 0), 100)}%`, transform: 'translate(-50%, -50%)' }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export default function AssetDetailModal() {
  const { open, symbol, closeAssetDetail } = useAssetDetailModal();

  if (!open || !symbol) return null;

  return (
    <Modal
      open
      onClose={closeAssetDetail}
      maxWidth="max-w-4xl"
      className="max-h-[90vh]"
      aria-labelledby="asset-detail-title"
    >
      <AssetDetailContent symbol={symbol} onClose={closeAssetDetail} />
    </Modal>
  );
}

function AssetDetailContent({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const { jintelConfigured, loading: featureLoading } = useFeatureStatus();

  const [portfolioResult] = usePortfolio();
  const position = useMemo<Position | undefined>(
    () => portfolioResult.data?.portfolio?.positions.find((p) => p.symbol === symbol),
    [portfolioResult.data, symbol],
  );

  const [quoteResult] = useQuote(symbol);
  const quote = quoteResult.data?.quote ?? undefined;

  const [priceRange, setPriceRange] = useState<PriceRange>('1y');
  const historyVars = useMemo<PriceHistoryQueryVariables>(
    () => ({ tickers: [symbol], range: priceRange }),
    [symbol, priceRange],
  );
  const [historyResult] = useQuery<PriceHistoryQueryResult, PriceHistoryQueryVariables>({
    query: PRICE_HISTORY_QUERY,
    variables: historyVars,
  });
  const priceHistory = historyResult.data?.priceHistory?.[0]?.history ?? [];

  // Real-time price stream
  const [priceMoveSub] = useOnPriceMove(symbol, 0);
  const latestTick = priceMoveSub.data?.[0];
  const isLive = priceMoveSub.fetching && !!latestTick;

  const [insightResult] = useQuery<LatestInsightReportQueryResult>({ query: LATEST_INSIGHT_REPORT_QUERY });
  const positionInsight = useMemo<PositionInsight | undefined>(
    () => insightResult.data?.latestInsightReport?.positions.find((p) => p.symbol === symbol),
    [insightResult.data, symbol],
  );

  const signalsVars = useMemo<SignalsVariables>(
    () => ({
      ticker: symbol,
      limit: 20,
      since: SEVEN_DAYS_AGO,
    }),
    [symbol],
  );
  const [signalsResult] = useQuery<SignalsQueryResult, SignalsVariables>({
    query: SIGNALS_QUERY,
    variables: signalsVars,
  });
  const allSignals = useMemo(() => signalsResult.data?.signals ?? [], [signalsResult.data?.signals]);
  const signals = useMemo(() => allSignals.filter((s) => s.type !== 'NEWS').slice(0, 10), [allSignals]);
  const newsSignals = useMemo(() => allSignals.filter((s) => s.type === 'NEWS').slice(0, 10), [allSignals]);

  const loading = portfolioResult.fetching && !portfolioResult.data;

  if (featureLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner label="Checking features..." />
      </div>
    );
  }

  if (!jintelConfigured) {
    return (
      <div className="flex items-center justify-center py-8">
        <GateCard requires="jintel" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner label={`Loading ${symbol}...`} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <SymbolLogo symbol={symbol} assetClass={position?.assetClass === 'CRYPTO' ? 'crypto' : 'equity'} size="md" />
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 id="asset-detail-title" className="text-xl font-semibold text-text-primary">
              {symbol}
            </h2>
            {positionInsight && (
              <Badge variant={ratingVariant[positionInsight.rating]} size="md">
                {ratingLabel[positionInsight.rating]}
              </Badge>
            )}
            {position && (
              <span className="text-xs text-text-muted bg-bg-tertiary px-2 py-0.5 rounded-full">
                {position.platform}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-text-muted">{position?.name ?? 'Position details and analysis'}</p>
        </div>

        {/* Price — live tick > quote > position snapshot */}
        {(latestTick ?? quote ?? position) && (
          <div className="text-right">
            <div className="flex items-center justify-end gap-2">
              <p className="text-xl font-semibold text-text-primary">
                {fmtCurrency(latestTick?.price ?? quote?.price ?? position?.currentPrice ?? 0)}
              </p>
              {isLive && (
                <span className="relative flex h-2 w-2" title="Live">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
              )}
            </div>
            {(latestTick ?? quote) && (
              <p className={cn('text-sm font-medium', pnlColor(latestTick?.change ?? quote?.change ?? 0))}>
                {fmtPnl(latestTick?.change ?? quote?.change ?? 0)} (
                {fmtPercent(latestTick?.changePercent ?? quote?.changePercent ?? 0)})
              </p>
            )}
          </div>
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="cursor-pointer rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Key Metrics */}
      {position && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard label="Market Value" value={fmtCurrency(position.marketValue)} />
          <MetricCard label="Quantity" value={fmtQuantity(position.quantity)} />
          <MetricCard
            label="Cost Basis"
            value={position.costBasis > 0 ? fmtCurrency(position.costBasis) : '--'}
            sub={position.costBasis > 0 ? 'per share' : 'not set'}
          />
          {position.costBasis > 0 ? (
            <MetricCard
              label="Unrealized P&L"
              value={fmtPnl(position.unrealizedPnl)}
              sub={fmtPercent(position.unrealizedPnlPercent)}
              color={pnlColor(position.unrealizedPnl)}
            />
          ) : (
            <MetricCard label="Unrealized P&L" value="--" sub="set cost basis to track" />
          )}
        </div>
      )}

      {!position && !loading && (
        <Card>
          <p className="text-sm text-text-muted">
            {symbol} is not in your portfolio.{' '}
            <button onClick={onClose} className="cursor-pointer text-accent-primary hover:underline">
              Close
            </button>
          </p>
        </Card>
      )}

      {/* Price Chart */}
      <Card
        title="Price"
        headerAction={
          <div className="flex gap-0.5">
            {PRICE_RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setPriceRange(r)}
                className={cn(
                  'cursor-pointer rounded px-1.5 py-px text-2xs font-medium transition-colors',
                  priceRange === r ? 'bg-accent-primary text-white' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        }
      >
        {historyResult.fetching && priceHistory.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="sm" label="Loading price history..." />
          </div>
        ) : priceHistory.length > 0 ? (
          <PriceChart data={priceHistory} />
        ) : (
          <p className="text-sm text-text-muted py-8 text-center">No price history available</p>
        )}
      </Card>

      {/* Market Data */}
      <Card title="Market Data">
        {quote ? (
          <div className="space-y-4">
            <DayRange low={quote.low} high={quote.high} current={quote.price} />
            <QuoteDetails quote={quote} />
          </div>
        ) : quoteResult.fetching ? (
          <div className="flex items-center justify-center py-6">
            <Spinner size="sm" />
          </div>
        ) : (
          <p className="text-sm text-text-muted py-4 text-center">No quote data available</p>
        )}
      </Card>

      {/* Insight Thesis */}
      {positionInsight && (
        <Card title="AI Analysis">
          <div className="space-y-3">
            <p className="text-sm text-text-secondary leading-relaxed">{positionInsight.thesis}</p>
            {positionInsight.risks.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Risks</h4>
                <ul className="space-y-1">
                  {positionInsight.risks.map((r, i) => (
                    <li key={i} className="text-sm text-text-secondary flex items-start gap-1.5">
                      <span className="text-error mt-0.5 text-xs">&#9679;</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {positionInsight.opportunities.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Opportunities</h4>
                <ul className="space-y-1">
                  {positionInsight.opportunities.map((o, i) => (
                    <li key={i} className="text-sm text-text-secondary flex items-start gap-1.5">
                      <span className="text-success mt-0.5 text-xs">&#9679;</span>
                      {o}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {positionInsight.conviction > 0 && (
              <p className="text-xs text-text-muted">
                Conviction: {(positionInsight.conviction * 100).toFixed(0)}%
                {positionInsight.priceTarget != null && ` \u00B7 Target: ${fmtCurrency(positionInsight.priceTarget)}`}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Signals & News */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Recent Signals">
          {signals.length > 0 ? (
            <ul className="space-y-2">
              {signals.map((sig) => (
                <SignalRow key={sig.id} signal={sig} />
              ))}
            </ul>
          ) : signalsResult.fetching ? (
            <div className="flex items-center justify-center py-6">
              <Spinner size="sm" />
            </div>
          ) : (
            <p className="text-sm text-text-muted py-4 text-center">No recent signals</p>
          )}
        </Card>

        <Card title="News">
          {newsSignals.length > 0 ? (
            <ul className="space-y-2">
              {newsSignals.map((sig) => (
                <NewsSignalRow key={sig.id} signal={sig} />
              ))}
            </ul>
          ) : signalsResult.fetching ? (
            <div className="flex items-center justify-center py-6">
              <Spinner size="sm" />
            </div>
          ) : (
            <p className="text-sm text-text-muted py-4 text-center">No recent news</p>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function QuoteDetails({ quote }: { quote: Quote }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Open', value: fmtCurrency(quote.open) },
    { label: 'High', value: fmtCurrency(quote.high) },
    { label: 'Low', value: fmtCurrency(quote.low) },
    { label: 'Prev Close', value: fmtCurrency(quote.previousClose) },
    { label: 'Volume', value: fmtVolume(quote.volume) },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between text-sm">
          <span className="text-text-muted">{r.label}</span>
          <span className="text-text-primary font-medium">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  const destination = signal.link ?? `/insights?tab=all&highlight=${signal.id}`;
  const isExternal = !!signal.link;

  return (
    <li className="flex items-start gap-2 py-1.5 border-b border-border-light last:border-0">
      <div className="flex-1 min-w-0">
        {isExternal ? (
          <a
            href={destination}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-text-primary hover:text-accent-primary truncate block cursor-pointer"
          >
            {signal.title}
          </a>
        ) : (
          <Link to={destination} className="text-sm text-text-primary hover:text-accent-primary truncate block">
            {signal.title}
          </Link>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <Badge variant={signalTypeVariant[signal.type] ?? 'neutral'} size="xs">
            {signal.type}
          </Badge>
          {signal.sentiment && (
            <Badge variant={sentimentVariant[signal.sentiment] ?? 'neutral'} size="xs">
              {signal.sentiment}
            </Badge>
          )}
          <span className="text-2xs text-text-muted">{timeAgo(signal.publishedAt)}</span>
        </div>
      </div>
    </li>
  );
}

function NewsSignalRow({ signal }: { signal: Signal }) {
  const destination = signal.link ?? `/insights?tab=all&highlight=${signal.id}`;
  const isExternal = !!signal.link;

  return (
    <li className="py-1.5 border-b border-border-light last:border-0">
      {isExternal ? (
        <a
          href={destination}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-text-primary hover:text-accent-primary truncate block cursor-pointer"
        >
          {signal.title}
        </a>
      ) : (
        <Link to={destination} className="text-sm text-text-primary hover:text-accent-primary truncate block">
          {signal.title}
        </Link>
      )}
      <div className="flex items-center gap-2 mt-0.5">
        {signal.sources[0] && <span className="text-2xs text-text-muted">{signal.sources[0].name}</span>}
        {signal.sentiment && (
          <Badge variant={sentimentVariant[signal.sentiment] ?? 'neutral'} size="xs">
            {signal.sentiment}
          </Badge>
        )}
        <span className="text-2xs text-text-muted">{timeAgo(signal.publishedAt)}</span>
      </div>
    </li>
  );
}
