import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { cn } from '../../lib/utils';
import { useFeatureStatus } from '../../lib/feature-status';
import { SymbolLogo } from '../common/symbol-logo';
import { useSummaries, usePortfolio } from '../../api';
import { CardEmptyState } from '../common/card-empty-state';
import { CardBlurGate } from '../common/card-blur-gate';
import { FeatureCardGate } from '../common/feature-gate';
import Spinner from '../common/spinner';
import Button from '../common/button';
import { DashboardCard } from '../common/dashboard-card';
import { useAddPositionModal } from '../../lib/add-position-modal-context';
import { useAssetDetailModal } from '../../lib/asset-detail-modal-context';
import { useMarketStatus, getMarketElapsedMinutes } from '../../hooks/use-market-status';
import type { Position } from '../../api/types';
import { formatSharePrice } from '../../lib/format';
import { isStablecoin } from '../../lib/stablecoins';
import { groupSummariesByTicker, severityBulletColor } from '../../lib/summaries-by-ticker';

function formatChange(n: number): string {
  const abs = Math.abs(n);
  return `$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(n: number): string {
  return `${Math.abs(n).toFixed(2)}%`;
}

/** Inline sparkline — sharp linear segments like real trading platforms. */
function Sparkline({
  symbol,
  data,
  dayChangePercent,
  isMarketOpen,
}: {
  symbol: string;
  data: number[];
  dayChangePercent: number;
  isMarketOpen: boolean;
}) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Progressive reveal: during market hours, width proportional to elapsed trading day
  const MARKET_DURATION = 390; // 6.5hr = 390 minutes
  const elapsed = getMarketElapsedMinutes();
  const progressWidth = isMarketOpen ? Math.min(elapsed / MARKET_DURATION, 1) * 120 : 120;

  const coords = data.map((v, i) => {
    const x = (i / (data.length - 1)) * progressWidth;
    const y = 32 - ((v - min) / range) * 24 - 4; // 4px padding for labels
    return { x, y };
  });

  const points = coords.map((c) => `${c.x},${c.y}`).join(' ');

  const isNegative = dayChangePercent < 0;

  const color =
    dayChangePercent > 0 ? 'var(--color-success)' : isNegative ? 'var(--color-error)' : 'var(--color-text-muted)';

  const gradId = `sparkline-grad-${symbol}`;

  const showBaseline = dayChangePercent !== 0;
  let baselineY: number | undefined;
  if (showBaseline) {
    const currentPrice = data[data.length - 1];
    const prevClose = currentPrice / (1 + dayChangePercent / 100);
    const rawY = 32 - ((prevClose - min) / range) * 24 - 4;
    baselineY = Math.max(0.5, Math.min(31.5, rawY));
  }

  const fillCloseY = isNegative && baselineY != null ? baselineY : 32;
  const fillPoints = `0,${fillCloseY} ${points} ${progressWidth},${fillCloseY}`;

  // Gradient: always most opaque near the line, fading toward the reference edge
  const gradTopOpacity = isNegative ? 0 : 0.2;
  const gradBottomOpacity = isNegative ? 0.2 : 0;

  return (
    <div className="pointer-events-none flex items-center gap-1">
      <div className="h-7 w-[80px]">
        <svg viewBox="0 0 120 32" className="h-full w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={gradTopOpacity} />
              <stop offset="100%" stopColor={color} stopOpacity={gradBottomOpacity} />
            </linearGradient>
          </defs>
          <polygon points={fillPoints} fill={`url(#${gradId})`} />
          {baselineY != null && (
            <line
              x1="0"
              x2="120"
              y1={baselineY}
              y2={baselineY}
              stroke="var(--color-text-muted)"
              strokeWidth="1"
              strokeDasharray="3 2"
              opacity="0.5"
            />
          )}
          <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

/** Returns the extended-hours label ("Pre" / "After") and change $ / % if applicable. */
function getExtendedHoursLabel(
  status: 'open' | 'pre-market' | 'after-hours' | 'closed',
  pos: Position,
): { prefix: string; value: number; dollarChange: number | null } | null {
  if (status === 'pre-market' && pos.preMarketChangePercent != null) {
    return { prefix: 'Pre', value: pos.preMarketChangePercent, dollarChange: pos.preMarketChange };
  }
  // After-hours and closed (weekends/overnight) both show the post-market move
  if ((status === 'after-hours' || status === 'closed') && pos.postMarketChangePercent != null) {
    return { prefix: 'After', value: pos.postMarketChangePercent, dollarChange: pos.postMarketChange };
  }
  return null;
}

function formatExtendedPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

const TH = 'whitespace-nowrap px-3 py-2 text-2xs font-medium uppercase tracking-wider text-text-muted';

export default function PositionsPreview() {
  const { aiConfigured, jintelConfigured } = useFeatureStatus();
  const [{ data: portfolioData, fetching, error }] = usePortfolio(undefined, { pollInterval: 30_000 });
  const data = portfolioData?.portfolio;
  const { openModal } = useAddPositionModal();
  const { openAssetDetail } = useAssetDetailModal();
  const { status: marketStatus } = useMarketStatus();

  // Summaries per ticker — powers the hover popover on each row.
  // urql dedupes this query against the one in `yojin-snap-card`, which owns
  // the 30s polling cycle. We just read from cache as it refreshes.
  const [summariesResult] = useSummaries({
    limit: 50,
    pause: !(aiConfigured && jintelConfigured),
  });
  const summariesByTicker = useMemo(
    () => groupSummariesByTicker(summariesResult.data?.summaries ?? []),
    [summariesResult.data?.summaries],
  );

  // Hover popover anchor. `hoveredTicker` drives visibility; `hoverAnchor`
  // holds the fixed-position coordinates so the popover can escape the
  // table's `overflow-auto` clipping box via a portal.
  const [hoveredTicker, setHoveredTicker] = useState<string | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<{ left: number; top: number } | null>(null);

  const handleTickerMouseEnter = useCallback(
    (symbol: string, el: HTMLElement) => {
      if (!summariesByTicker.has(symbol)) return;
      const rect = el.getBoundingClientRect();
      const POPOVER_WIDTH = 288; // matches w-72 below
      const MARGIN = 16;
      let left = rect.right + 8;
      // Flip to the left side if the popover would overflow the viewport.
      if (left + POPOVER_WIDTH > window.innerWidth - MARGIN) {
        left = Math.max(MARGIN, rect.left - POPOVER_WIDTH - 8);
      }
      setHoveredTicker(symbol);
      setHoverAnchor({ left, top: rect.top });
    },
    [summariesByTicker],
  );

  const handleTickerMouseLeave = useCallback(() => {
    setHoveredTicker(null);
    setHoverAnchor(null);
  }, []);

  // Any scroll (table body, page, modal container) invalidates the anchor
  // rect captured on mouseenter. Close the popover rather than track it.
  useEffect(() => {
    if (!hoveredTicker) return;
    const close = () => {
      setHoveredTicker(null);
      setHoverAnchor(null);
    };
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [hoveredTicker]);

  const hoveredSummaries = hoveredTicker ? summariesByTicker.get(hoveredTicker) : undefined;

  // Detect new positions and trigger glow animation
  const [newPositionKeys, setNewPositionKeys] = useState<Set<string>>(new Set());
  const knownKeysRef = useRef<Set<string>>(new Set());
  const glowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectNewPositions = useCallback((currentKeys: string[]) => {
    if (knownKeysRef.current.size === 0) {
      knownKeysRef.current = new Set(currentKeys);
      return;
    }
    const fresh = currentKeys.filter((k) => !knownKeysRef.current.has(k));
    if (fresh.length === 0) return;
    knownKeysRef.current = new Set(currentKeys);
    setNewPositionKeys(new Set(fresh));
    if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
    glowTimerRef.current = setTimeout(() => setNewPositionKeys(new Set()), 3_000);
  }, []);

  useEffect(() => {
    const positions = data?.positions ?? [];
    if (positions.length > 0) {
      detectNewPositions([...new Set(positions.map((p) => p.symbol))]);
    }
  }, [data?.positions, detectNewPositions]);

  // Detect price changes and trigger directional glow on cells
  const [priceGlowMap, setPriceGlowMap] = useState<Map<string, 'up' | 'down'>>(new Map());
  const prevPricesRef = useRef<Map<string, number>>(new Map());
  const priceGlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const positions = data?.positions ?? [];
    if (positions.length === 0) return;

    // Dedupe by symbol, keeping the highest market value entry — mirrors the render path
    const dedupSeen = new Set<string>();
    const deduped = [...positions]
      .sort((a, b) => b.marketValue - a.marketValue)
      .filter((p) => (dedupSeen.has(p.symbol) ? false : (dedupSeen.add(p.symbol), true)));

    const glows = new Map<string, 'up' | 'down'>();
    const nextPrices = new Map<string, number>();

    for (const p of deduped) {
      const key = p.symbol;
      nextPrices.set(key, p.currentPrice);
      const prev = prevPricesRef.current.get(key);
      if (prev != null && prev !== p.currentPrice) {
        glows.set(key, p.currentPrice > prev ? 'up' : 'down');
      }
    }

    prevPricesRef.current = nextPrices;
    if (glows.size === 0) return;

    setTimeout(() => {
      setPriceGlowMap(glows);
      if (priceGlowTimerRef.current) clearTimeout(priceGlowTimerRef.current);
      priceGlowTimerRef.current = setTimeout(() => setPriceGlowMap(new Map()), 5_000);
    }, 0);
  }, [data?.positions]);

  if (!jintelConfigured) {
    return (
      <DashboardCard title="Portfolio">
        <CardBlurGate mockContent={<MockPositions />}>
          <FeatureCardGate requires="jintel" />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  const viewAllLink = (
    <Link
      to="/portfolio"
      className="text-2xs font-semibold text-accent-primary transition-colors hover:text-accent-primary/80"
    >
      View All
    </Link>
  );

  if (fetching) {
    return (
      <DashboardCard title="Portfolio" headerAction={viewAllLink}>
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="md" label="Fetching positions…" />
        </div>
      </DashboardCard>
    );
  }

  if (error || !data || data.positions.length === 0) {
    return (
      <DashboardCard title="Portfolio">
        <CardBlurGate mockContent={<MockPositions />}>
          <CardEmptyState
            icon={
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
                />
              </svg>
            }
            title="No position data"
            description="Connect a platform to see your holdings."
            action={
              <Button variant="primary" size="sm" onClick={openModal}>
                Add position
              </Button>
            }
          />
        </CardBlurGate>
      </DashboardCard>
    );
  }

  // Dedupe by symbol (same asset across accounts), exclude stablecoins, sort by market value descending
  const seen = new Set<string>();
  const top = [...data.positions]
    .sort((a, b) => b.marketValue - a.marketValue)
    .filter((p) => !isStablecoin(p.symbol) && (seen.has(p.symbol) ? false : (seen.add(p.symbol), true)));

  return (
    <DashboardCard title="Portfolio" headerAction={viewAllLink}>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 z-10 bg-bg-card">
            <tr className="border-b border-border">
              <th className={TH}>Asset</th>
              <th className={cn(TH, 'w-[80px]')} />
              <th className={cn(TH, 'text-right')}>Price</th>
              <th className={cn(TH, 'text-right pr-5')}>Change</th>
            </tr>
          </thead>
          <tbody>
            {top.map((pos) => {
              const dc = pos.dayChange;
              const dcp = pos.dayChangePercent;
              const isUp = dc != null && dc > 0;
              const isDown = dc != null && dc < 0;
              const colorClass = isUp ? 'text-success' : isDown ? 'text-error' : 'text-text-muted';
              const arrow = isUp ? '\u25B2' : isDown ? '\u25BC' : '';
              const ext = getExtendedHoursLabel(marketStatus, pos);

              const posKey = pos.symbol;
              const summariesForSymbol = summariesByTicker.get(pos.symbol);
              const hasSummaries = summariesForSymbol !== undefined && summariesForSymbol.length > 0;
              const topSummarySeverity = hasSummaries ? summariesForSymbol[0].severity : null;
              return (
                <tr
                  key={posKey}
                  className={cn(
                    'border-b border-border last:border-b-0 cursor-pointer transition-colors hover:bg-bg-hover',
                    newPositionKeys.has(posKey) && 'animate-new-item',
                  )}
                  onClick={() => openAssetDetail(pos.symbol)}
                >
                  {/* Asset: logo + symbol (name on hover, actions popover on hover if present) */}
                  <td className="px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <SymbolLogo
                        symbol={pos.symbol}
                        assetClass={pos.assetClass.toLowerCase() as 'equity' | 'crypto'}
                        size="sm"
                      />
                      <span
                        className="group/asset relative text-xs font-semibold text-text-primary"
                        onMouseEnter={(e) => handleTickerMouseEnter(pos.symbol, e.currentTarget)}
                        onMouseLeave={handleTickerMouseLeave}
                      >
                        {pos.symbol}
                        {hasSummaries && (
                          <span
                            aria-label={`${summariesForSymbol.length} pending ${summariesForSymbol.length === 1 ? 'summary' : 'summaries'}`}
                            className={cn(
                              'ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle',
                              severityBulletColor(topSummarySeverity),
                            )}
                          />
                        )}
                        {/* Name tooltip only when there is no actions popover to surface instead. */}
                        {!hasSummaries && pos.name && pos.name !== pos.symbol && (
                          <div className="pointer-events-none absolute left-0 bottom-full z-20 mb-0.5 hidden rounded-md bg-bg-tertiary px-2 py-1 shadow-md ring-1 ring-border group-hover/asset:block">
                            <span className="whitespace-nowrap text-2xs text-text-secondary">{pos.name}</span>
                          </div>
                        )}
                      </span>
                    </div>
                  </td>

                  {/* Sparkline */}
                  <td className="px-3 py-2">
                    {pos.sparkline ? (
                      <Sparkline
                        symbol={pos.symbol}
                        data={pos.sparkline}
                        dayChangePercent={dcp ?? 0}
                        isMarketOpen={marketStatus === 'open' && pos.assetClass !== 'CRYPTO'}
                      />
                    ) : (
                      <div className="flex h-8 w-[100px] items-center justify-center">
                        <span className="text-2xs text-text-muted/40">—</span>
                      </div>
                    )}
                  </td>

                  {/* Price */}
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium tabular-nums text-text-primary">
                    {formatSharePrice(pos.currentPrice)}
                  </td>

                  {/* Change + extended-hours percent + hover tooltip for $ values */}
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <div
                      className={cn(
                        'group relative inline-block text-right rounded-md px-1.5 py-0.5',
                        priceGlowMap.get(posKey) === 'up' && 'animate-price-up',
                        priceGlowMap.get(posKey) === 'down' && 'animate-price-down',
                      )}
                    >
                      <div className={cn('text-xs tabular-nums', colorClass)}>
                        {dcp != null ? (
                          <>
                            {arrow && <span className="mr-0.5 text-2xs">{arrow}</span>}
                            {formatPercent(dcp)}
                          </>
                        ) : (
                          <span className="text-text-muted/40">—</span>
                        )}
                      </div>
                      {ext &&
                        (() => {
                          const extColor =
                            ext.value > 0 ? 'text-success' : ext.value < 0 ? 'text-error' : 'text-text-muted';
                          return (
                            <div className={cn('mt-0.5 text-2xs tabular-nums', extColor)}>
                              {ext.prefix}: {formatExtendedPercent(ext.value)}
                            </div>
                          );
                        })()}

                      {/* Hover tooltip showing dollar changes */}
                      {dc != null && (
                        <div className="pointer-events-none absolute right-0 bottom-full mb-1.5 z-20 hidden rounded-md bg-bg-tertiary px-2.5 py-1.5 shadow-lg ring-1 ring-border group-hover:block">
                          <div className={cn('text-xs tabular-nums whitespace-nowrap', colorClass)}>
                            {arrow && <span className="mr-0.5 text-2xs">{arrow}</span>}
                            {formatChange(dc)}
                          </div>
                          {ext &&
                            ext.dollarChange != null &&
                            (() => {
                              const extColor =
                                ext.dollarChange > 0
                                  ? 'text-success'
                                  : ext.dollarChange < 0
                                    ? 'text-error'
                                    : 'text-text-muted';
                              return (
                                <div className={cn('mt-0.5 text-2xs tabular-nums whitespace-nowrap', extColor)}>
                                  {ext.prefix}: {ext.dollarChange >= 0 ? '+' : '-'}
                                  {formatChange(ext.dollarChange)}
                                </div>
                              );
                            })()}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hoveredTicker &&
        hoveredSummaries &&
        hoverAnchor &&
        createPortal(
          <div
            role="dialog"
            aria-label={`Summaries for ${hoveredTicker}`}
            style={{ position: 'fixed', left: hoverAnchor.left, top: hoverAnchor.top }}
            className="pointer-events-none z-50 w-72 rounded-md bg-bg-tertiary p-3 shadow-lg ring-1 ring-border"
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-text-primary">{hoveredTicker}</span>
              <span className="text-2xs text-text-muted">
                {hoveredSummaries.length} {hoveredSummaries.length === 1 ? 'summary' : 'summaries'}
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {hoveredSummaries.slice(0, 5).map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <span
                    className={cn('mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', severityBulletColor(a.severity))}
                  />
                  <span className="text-xs leading-relaxed text-text-secondary">{a.what}</span>
                </li>
              ))}
            </ul>
            {hoveredSummaries.length > 5 && (
              <div className="mt-2 text-2xs text-text-muted">+{hoveredSummaries.length - 5} more</div>
            )}
          </div>,
          document.body,
        )}
    </DashboardCard>
  );
}

const MOCK_POSITIONS = [
  { symbol: 'AAPL', name: 'Apple Inc', price: '182.52', change: '$2.15', pct: '1.19%', up: true },
  { symbol: 'NVDA', name: 'NVIDIA Corp', price: '875.28', change: '$12.45', pct: '1.40%', up: false },
  { symbol: 'BTC', name: 'Bitcoin', price: '67,234', change: '$892.30', pct: '1.35%', up: true },
  { symbol: 'TSLA', name: 'Tesla Inc', price: '248.42', change: '$5.67', pct: '2.33%', up: true },
  { symbol: 'MSFT', name: 'Microsoft', price: '415.60', change: '$3.22', pct: '0.77%', up: false },
];

function MockPositions() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <table className="w-full text-left">
        <thead className="bg-bg-card">
          <tr className="border-b border-border">
            <th className={TH}>Asset</th>
            <th className={cn(TH, 'w-[80px]')} />
            <th className={cn(TH, 'text-right')}>Price</th>
            <th className={cn(TH, 'text-right pr-5')}>Change</th>
          </tr>
        </thead>
        <tbody>
          {MOCK_POSITIONS.map((pos) => {
            const colorClass = pos.up ? 'text-success' : 'text-error';
            const arrow = pos.up ? '▲' : '▼';
            return (
              <tr key={pos.symbol} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="h-6 w-6 flex-shrink-0 rounded-full bg-bg-tertiary" />
                    <span className="text-xs font-semibold text-text-primary">{pos.symbol}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="h-7 w-[80px]" />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium tabular-nums text-text-primary">
                  {pos.price}
                </td>
                <td className={cn('whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums', colorClass)}>
                  <span className="mr-0.5 text-2xs">{arrow}</span>
                  {pos.pct}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
