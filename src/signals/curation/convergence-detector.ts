/**
 * Cross-source convergence detector — identifies when multiple independent
 * sources discuss the same ticker within a time window.
 *
 * Convergence is a strong quality signal: if Twitter, Reddit, and news all
 * mention AAPL within 24 hours, that's higher conviction than any single source.
 *
 * Returns a per-signal boost (0–1) based on how many distinct source types
 * converge on each ticker.
 */

import type { Signal } from '../types.js';

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Source type bucketing
// ---------------------------------------------------------------------------

/**
 * Map a signal's source ID to a broad source bucket for convergence counting.
 * Two Twitter signals from different accounts are the same bucket — we want
 * distinct *platforms*, not distinct *posts*.
 */
function sourceBucket(signal: Signal): string {
  const sourceId = signal.sources[0]?.id ?? '';
  if (sourceId.includes('twitter')) return 'twitter';
  if (sourceId.includes('reddit')) return 'reddit';
  if (sourceId.includes('youtube')) return 'youtube';
  if (sourceId.includes('linkedin')) return 'linkedin';
  if (sourceId.includes('discussions') || sourceId.includes('hn')) return 'hn';
  if (sourceId.includes('research')) return 'research';
  if (sourceId.includes('news')) return 'news';
  if (sourceId.includes('sentiment')) return 'sentiment';
  if (sourceId.includes('fundamental')) return 'fundamental';
  if (sourceId.includes('technical')) return 'technical';
  if (sourceId.includes('filing') || sourceId.includes('regulatory')) return 'filings';
  return 'other';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ConvergenceResult {
  /** Per-signal convergence boost (0–1). Key = signal ID. */
  boosts: Map<string, number>;
  /** Per-ticker source count. Key = ticker. */
  tickerSourceCounts: Map<string, number>;
}

/**
 * Detect cross-source convergence across a set of signals.
 *
 * For each ticker, count how many distinct source buckets appear within
 * `windowMs`. Signals for tickers with 3+ source types get a convergence boost.
 *
 * Boost scale:
 *   - 2 sources: 0 (baseline, no boost)
 *   - 3 sources: 0.15
 *   - 4 sources: 0.25
 *   - 5+ sources: 0.35
 */
export function detectConvergence(signals: Signal[], windowMs: number = DEFAULT_WINDOW_MS): ConvergenceResult {
  // Group signals by ticker
  const byTicker = new Map<string, Signal[]>();
  for (const signal of signals) {
    for (const asset of signal.assets) {
      const ticker = asset.ticker;
      let group = byTicker.get(ticker);
      if (!group) {
        group = [];
        byTicker.set(ticker, group);
      }
      group.push(signal);
    }
  }

  const boosts = new Map<string, number>();
  const tickerSourceCounts = new Map<string, number>();

  for (const [ticker, tickerSignals] of byTicker) {
    // Find distinct source buckets within the time window
    // Use the most recent signal as anchor, look back `windowMs`
    const sortedByTime = tickerSignals.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );
    const latestTime = new Date(sortedByTime[0].publishedAt).getTime();
    const windowStart = latestTime - windowMs;

    const sourcesInWindow = new Set<string>();
    const signalsInWindow: Signal[] = [];

    for (const signal of sortedByTime) {
      if (new Date(signal.publishedAt).getTime() >= windowStart) {
        sourcesInWindow.add(sourceBucket(signal));
        signalsInWindow.push(signal);
      }
    }

    const sourceCount = sourcesInWindow.size;
    tickerSourceCounts.set(ticker, sourceCount);

    // Compute boost based on source count
    let boost = 0;
    if (sourceCount >= 5) boost = 0.35;
    else if (sourceCount >= 4) boost = 0.25;
    else if (sourceCount >= 3) boost = 0.15;

    // Apply boost to all signals in the convergence window
    if (boost > 0) {
      for (const signal of signalsInWindow) {
        const existing = boosts.get(signal.id) ?? 0;
        boosts.set(signal.id, Math.max(existing, boost));
      }
    }
  }

  return { boosts, tickerSourceCounts };
}
