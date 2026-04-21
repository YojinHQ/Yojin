import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from 'urql';
import { cn } from '../../lib/utils';
import { useAssetDetailModal } from '../../lib/asset-detail-modal-context';
import { useFeatureStatus } from '../../lib/feature-status';
import { usePortfolio, useQuote, useOnPriceMove } from '../../api';
import type {
  Quote,
  PositionInsight,
  InsightRating,
  LatestInsightReportQueryResult,
  SignalSummary,
  MicroInsightQueryResult,
} from '../../api/types';
import { groupPositions } from './position-table';
import { getPlatformMeta } from '../platforms/platform-meta';
import {
  LATEST_INSIGHT_REPORT_QUERY,
  SIGNALS_QUERY,
  PRICE_HISTORY_QUERY,
  MICRO_INSIGHT_QUERY,
} from '../../api/documents';
import type {
  PriceHistoryQueryResult,
  PriceHistoryQueryVariables,
  Signal,
  SignalsQueryResult,
  SignalsVariables,
} from '../../api/types';
import { PriceChart } from '../charts/price-chart';
import Card from '../common/card';
import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';
import Modal from '../common/modal';
import Spinner from '../common/spinner';
import { SymbolLogo } from '../common/symbol-logo';
import { GateCard } from '../common/feature-gate';
import { ShareMenu } from '../insights/share-menu';
import { timeAgo } from '../../lib/utils';
import { CANDLE_CONFIG, INTRADAY_CANDLES, PERIOD_CANDLES, type Candle } from './chart-candle-config';
import { filterEquitySessionCandles } from './chart-session-filter';

const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

const EXTENDED_HOURS_STORAGE_KEY = 'asset-chart-extended-hours-v1';

function readExtendedHoursPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(EXTENDED_HOURS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeExtendedHoursPref(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EXTENDED_HOURS_STORAGE_KEY, String(value));
  } catch {
    /* ignore quota / disabled storage */
  }
}

// Scraper occasionally mislabels crypto as EQUITY; symbol suffix is the fallback.
function isCryptoSymbol(symbol: string): boolean {
  return /-USDT?$/i.test(symbol);
}

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

const sentimentVariant: Record<string, BadgeVariant> = {
  BULLISH: 'success',
  BEARISH: 'error',
  NEUTRAL: 'neutral',
  MIXED: 'warning',
};

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
      <p className={cn('mt-1.5 text-lg font-semibold', color ?? 'text-text-primary')}>{value}</p>
      {sub && <p className={cn('mt-0.5 text-xs', color ?? 'text-text-muted')}>{sub}</p>}
    </Card>
  );
}

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
  const position = useMemo(() => {
    const positions = portfolioResult.data?.portfolio?.positions;
    if (!positions) return undefined;
    const matching = positions.filter((p) => p.symbol === symbol);
    if (matching.length === 0) return undefined;
    return groupPositions(matching)[0];
  }, [portfolioResult.data, symbol]);

  const [quoteResult] = useQuote(symbol);
  const quote = quoteResult.data?.quote ?? undefined;

  const isEquity = position != null && position.assetClass !== 'CRYPTO' && !isCryptoSymbol(symbol);

  const [candle, setCandle] = useState<Candle>('15m');
  const [resetKey, setResetKey] = useState(0);
  const [extendedHours, setExtendedHoursState] = useState<boolean>(() => readExtendedHoursPref());

  const candleConfig = CANDLE_CONFIG[candle];
  const { interval, intraday, initialWindowMs } = candleConfig;
  const range = isEquity ? candleConfig.range : candleConfig.cryptoRange;

  const pickCandle = useCallback(
    (next: Candle) => {
      if (next === candle) return;
      setCandle(next);
      setResetKey((k) => k + 1);
    },
    [candle],
  );

  const setExtendedHours = useCallback((next: boolean) => {
    setExtendedHoursState(next);
    writeExtendedHoursPref(next);
  }, []);

  const historyVars = useMemo<PriceHistoryQueryVariables>(
    () => ({ tickers: [symbol], range, interval }),
    [symbol, range, interval],
  );
  const [historyResult] = useQuery<PriceHistoryQueryResult, PriceHistoryQueryVariables>({
    query: PRICE_HISTORY_QUERY,
    variables: historyVars,
  });
  const priceHistory = useMemo(() => {
    const raw = historyResult.data?.priceHistory?.[0]?.history ?? [];
    if (!isEquity || !intraday) return raw;
    return filterEquitySessionCandles(raw, { extendedHours });
  }, [historyResult.data, isEquity, intraday, extendedHours]);

  const resetKeyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    resetKeyTimerRef.current = setTimeout(() => {
      setResetKey((k) => k + 1);
    }, 0);
    return () => {
      if (resetKeyTimerRef.current !== null) clearTimeout(resetKeyTimerRef.current);
    };
  }, [symbol]);

  const showExtendedHoursToggle = isEquity && intraday;

  const [priceMoveSub] = useOnPriceMove(symbol, 0);
  const latestTick = priceMoveSub.data?.[0];
  const isLive = priceMoveSub.fetching && !!latestTick;

  const [insightResult] = useQuery<LatestInsightReportQueryResult>({ query: LATEST_INSIGHT_REPORT_QUERY });
  const latestInsightRun = useMemo(() => {
    const report = insightResult.data?.latestInsightReport;
    const insight = report?.positions.find((p) => p.symbol === symbol);
    return report && insight ? { createdAt: report.createdAt, insight } : null;
  }, [insightResult.data, symbol]);
  const latestInsight = latestInsightRun?.insight;

  const microVars = useMemo(() => ({ symbol }), [symbol]);
  const [microResult] = useQuery<MicroInsightQueryResult>({
    query: MICRO_INSIGHT_QUERY,
    variables: microVars,
    pause: !jintelConfigured,
  });
  const microActions = microResult.data?.microInsight?.assetActions ?? [];

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
  const allSignals = useMemo(
    () => (signalsResult.data?.curatedSignals ?? []).map((c) => c.signal),
    [signalsResult.data?.curatedSignals],
  );
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
            {latestInsight && (
              <Badge variant={ratingVariant[latestInsight.rating]} size="md">
                {ratingLabel[latestInsight.rating]}
              </Badge>
            )}
            {position?.underlying.map((p) => (
              <span key={p.platform} className="text-xs text-text-muted bg-bg-tertiary px-2 py-0.5 rounded-full">
                {getPlatformMeta(p.platform).label}
              </span>
            ))}
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
          <CandleSelector
            candle={candle}
            onPick={pickCandle}
            extendedHours={extendedHours}
            onToggleExtendedHours={setExtendedHours}
            showExtendedHoursToggle={showExtendedHoursToggle}
          />
        }
      >
        {historyResult.fetching && priceHistory.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="sm" label="Loading price history..." />
          </div>
        ) : priceHistory.length > 0 ? (
          <PriceChart data={priceHistory} intraday={intraday} initialWindowMs={initialWindowMs} resetKey={resetKey} />
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
      {latestInsightRun && (
        <Card title="AI Analysis" headerAction={<ShareMenu insight={latestInsightRun.insight} />}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <span>Updated {timeAgo(latestInsightRun.createdAt)}</span>
              <span>&middot;</span>
              <span>{new Date(latestInsightRun.createdAt).toLocaleString()}</span>
              {latestInsightRun.insight.carriedForward && (
                <Badge variant="neutral" size="xs">
                  Carried Forward
                </Badge>
              )}
            </div>
            <InsightAnalysisBody insight={latestInsightRun.insight} />
          </div>
        </Card>
      )}

      {/* Summaries & News */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Summaries"
          headerAction={
            microActions.length > 0 ? (
              <span className="text-2xs text-text-muted">
                {microActions.length} {microActions.length === 1 ? 'summary' : 'summaries'}
              </span>
            ) : undefined
          }
        >
          {microActions.length > 0 ? (
            <ul className="space-y-2">
              {microActions.map((text, i) => (
                <li key={i} className="flex items-start gap-2 border-b border-border-light py-2 last:border-0">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
                  <p className="text-sm leading-relaxed text-text-secondary">{text}</p>
                </li>
              ))}
            </ul>
          ) : microResult.fetching ? (
            <div className="flex items-center justify-center py-6">
              <Spinner size="sm" />
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-text-muted">No summaries yet</p>
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

function CandleSelector({
  candle,
  onPick,
  extendedHours,
  onToggleExtendedHours,
  showExtendedHoursToggle,
}: {
  candle: Candle;
  onPick: (c: Candle) => void;
  extendedHours: boolean;
  onToggleExtendedHours: (v: boolean) => void;
  showExtendedHoursToggle: boolean;
}) {
  const intradayActive = INTRADAY_CANDLES.includes(candle);
  // Empty value in period mode so onChange fires even when re-picking the previously active candle.
  const dropdownValue: string = intradayActive ? candle : '';

  return (
    <div className="flex items-center gap-2">
      <select
        value={dropdownValue}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value as Candle);
        }}
        aria-label="Intraday candle size"
        className={cn(
          'cursor-pointer rounded px-1.5 py-0.5 text-2xs font-medium transition-colors',
          intradayActive ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-secondary',
        )}
      >
        {!intradayActive && (
          <option value="" disabled hidden>
            Intraday
          </option>
        )}
        {INTRADAY_CANDLES.map((c) => (
          <option key={c} value={c}>
            {CANDLE_CONFIG[c].label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        {PERIOD_CANDLES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            className={cn(
              'cursor-pointer rounded px-1.5 py-0.5 text-2xs font-medium transition-colors',
              candle === c ? 'bg-accent-primary text-white' : 'text-text-muted hover:text-text-secondary',
            )}
          >
            {CANDLE_CONFIG[c].label}
          </button>
        ))}
      </div>

      {showExtendedHoursToggle && (
        <label className="flex cursor-pointer items-center gap-1 text-2xs text-text-muted hover:text-text-secondary">
          <input
            type="checkbox"
            checked={extendedHours}
            onChange={(e) => onToggleExtendedHours(e.target.checked)}
            className="h-3 w-3 cursor-pointer accent-accent-primary"
          />
          Extended hours
        </label>
      )}
    </div>
  );
}

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

function InsightAnalysisBody({ insight, compact = false }: { insight: PositionInsight; compact?: boolean }) {
  return (
    <div className={cn('space-y-3', compact && 'space-y-2.5')}>
      <p className="text-sm leading-relaxed text-text-secondary">{insight.thesis}</p>

      {insight.keySignals.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-text-muted">Key Signals</h4>
          <div className="space-y-2">
            {insight.keySignals.map((signal) => (
              <InsightSignalSummaryRow key={signal.signalId} signal={signal} compact={compact} />
            ))}
          </div>
        </div>
      )}

      {(insight.risks.length > 0 || insight.opportunities.length > 0) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {insight.risks.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-text-muted">Risks</h4>
              <ul className="space-y-1">
                {insight.risks.map((risk, index) => (
                  <li key={`${risk}-${index}`} className="flex items-start gap-1.5 text-sm text-text-secondary">
                    <span className="mt-0.5 text-xs text-error">&#9679;</span>
                    {risk}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {insight.opportunities.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-text-muted">Opportunities</h4>
              <ul className="space-y-1">
                {insight.opportunities.map((opportunity, index) => (
                  <li key={`${opportunity}-${index}`} className="flex items-start gap-1.5 text-sm text-text-secondary">
                    <span className="mt-0.5 text-xs text-success">&#9679;</span>
                    {opportunity}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {insight.conviction > 0 && (
        <p className="text-xs text-text-muted">
          Conviction: {(insight.conviction * 100).toFixed(0)}%
          {insight.priceTarget != null && ` \u00B7 Target: ${fmtCurrency(insight.priceTarget)}`}
        </p>
      )}
    </div>
  );
}

function InsightSignalSummaryRow({ signal, compact = false }: { signal: SignalSummary; compact?: boolean }) {
  return (
    <div className={cn('rounded-lg border border-border-light p-3', compact && 'px-2.5 py-2')}>
      <div className="flex items-start gap-2">
        <Badge
          variant={signal.impact === 'POSITIVE' ? 'success' : signal.impact === 'NEGATIVE' ? 'error' : 'neutral'}
          size="xs"
        >
          {signal.impact}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-text-primary">{signal.title}</p>
          {signal.detail && <p className="mt-1 text-xs leading-relaxed text-text-secondary">{signal.detail}</p>}
          {signal.url && (
            <a
              href={signal.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-2xs text-accent-primary hover:underline"
            >
              View source
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
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
