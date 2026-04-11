/**
 * Shared helpers for reading the Summaries feed by ticker.
 *
 * Used by the Summaries card (yojin-snap-card) and the positions preview hover
 * popover — both need to group by ticker and sort severity-first.
 */

import type { Summary } from '../api/types';

/**
 * Portfolio-wide sentinel ticker — mirrors `PORTFOLIO_TICKER` exported from
 * the backend at `src/summaries/types.ts`. Producer is
 * `buildMacroSummaryInputs` in `src/insights/macro-summary-builder.ts`.
 * The display layer drops this bucket so the sentinel does not leak through
 * as a fake tradeable symbol (CLAUDE.md: "Sentinel fallbacks must not leak
 * into display data"). Duplicated as a literal because the backend constant
 * is in a different workspace package.
 */
const PORTFOLIO_SENTINEL_TICKER = 'PORTFOLIO';

/** Map a 0–1 severity score to a bullet color class (matches the analyzer prompt's ladder). */
export function severityBulletColor(severity: number | null): string {
  if (severity === null) return 'bg-text-muted';
  if (severity >= 0.9) return 'bg-error';
  if (severity >= 0.7) return 'bg-warning';
  if (severity >= 0.4) return 'bg-info';
  if (severity >= 0.1) return 'bg-accent-primary';
  return 'bg-text-muted';
}

/** Build the insights deep-link for a ticker (matches the App.tsx redirect shape). */
export function insightsHrefForTicker(ticker: string): string {
  const params = new URLSearchParams({ tab: 'all', ticker });
  return `/insights?${params.toString()}`;
}

/**
 * Group summaries into ticker-keyed buckets. Each bucket is sorted by severity
 * DESC, then createdAt DESC. Callers that only need per-ticker lookups (e.g.
 * the positions hover popover) should use `map.get(symbol)`; callers that need
 * the full list (the Summaries card) should iterate and layer their own sort.
 *
 * Portfolio-level summaries (ticker === PORTFOLIO_SENTINEL_TICKER) are
 * dropped here so the sentinel never leaks into display components as a
 * fake tradeable symbol. See CLAUDE.md: "Sentinel fallbacks must not leak
 * into display data."
 */
export function groupSummariesByTicker(summaries: readonly Summary[]): Map<string, Summary[]> {
  const byTicker = new Map<string, Summary[]>();
  for (const summary of summaries) {
    if (summary.ticker === PORTFOLIO_SENTINEL_TICKER) continue;
    const bucket = byTicker.get(summary.ticker) ?? [];
    bucket.push(summary);
    byTicker.set(summary.ticker, bucket);
  }
  for (const items of byTicker.values()) {
    items.sort((a, b) => {
      const sa = a.severity ?? -1;
      const sb = b.severity ?? -1;
      if (sa !== sb) return sb - sa;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }
  return byTicker;
}
