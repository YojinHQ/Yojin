/**
 * Shared helpers for reading the Actions feed by ticker.
 *
 * Used by the Actions card (yojin-snap-card) and the positions preview hover
 * popover — both need to map `action.source` → ticker and sort severity-first.
 */

import type { Action } from '../api/types';

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
 * Group actions into ticker-keyed buckets. Each bucket is sorted by severity
 * DESC, then createdAt DESC. Actions with no ticker in the source land under
 * the empty-string key. Callers that only need per-ticker lookups (e.g. the
 * positions hover popover) should use `map.get(symbol)`; callers that need
 * the full list (the Actions card) should iterate and layer their own sort.
 */
export function groupActionsByTicker(actions: readonly Action[]): Map<string, Action[]> {
  const byTicker = new Map<string, Action[]>();
  for (const action of actions) {
    const key = extractTickerFromSource(action.source) ?? '';
    const bucket = byTicker.get(key) ?? [];
    bucket.push(action);
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
