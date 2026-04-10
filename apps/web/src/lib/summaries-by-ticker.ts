/**
 * Shared helpers for reading the Summaries feed by ticker.
 *
 * Used by the Summaries card (yojin-snap-card) and the positions preview hover
 * popover — both need to map `summary.source` → ticker and sort severity-first.
 */

import type { Summary } from '../api/types';

/** Extract ticker from `source: "micro-observation: AAPL"`. */
export function extractTickerFromSource(source: string): string | null {
  const match = source.match(/^micro-observation:\s*(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

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
 * DESC, then createdAt DESC. Summaries with no ticker in the source land under
 * the empty-string key. Callers that only need per-ticker lookups (e.g. the
 * positions hover popover) should use `map.get(symbol)`; callers that need
 * the full list (the Summaries card) should iterate and layer their own sort.
 */
export function groupSummariesByTicker(summaries: readonly Summary[]): Map<string, Summary[]> {
  const byTicker = new Map<string, Summary[]>();
  for (const summary of summaries) {
    const key = summary.tickers?.[0] ?? extractTickerFromSource(summary.source) ?? '';
    const bucket = byTicker.get(key) ?? [];
    bucket.push(summary);
    byTicker.set(key, bucket);
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
