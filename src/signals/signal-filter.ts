/**
 * Signal filter — deterministic quality + junk filtering.
 *
 * No LLM calls. Uses quality flags persisted at ingest time by the QualityAgent.
 * Kept intentionally simple — the macro flow agents do the real assessment.
 */

import { FALSE_MATCH_LABEL_RE, JUNK_CONTENT_RE } from './quality-patterns.js';
import type { Signal, SignalOutputType } from './types.js';

/** Sources that produce recurring data snapshots (not actionable signals). */
const DATA_SNAPSHOT_SOURCES = new Set(['jintel-snapshot', 'jintel-technicals', 'jintel-sentiment']);

export const DEFAULT_SPAM_PATTERNS = [
  'sponsored',
  'press release',
  'advertisement',
  'partner content',
  'stock price, news, quote',
  'check out .+ stock price',
  'stock (?:price|chart) .+ tradingview',
  'stock chart .+ tradingview',
  'in real time$',
  'no actionable.+(?:signal|market|data)',
  'no (?:substantive|meaningful) .+(?:news|content|data)',
  '^\\d+ (?:best|top) stocks? to (?:buy|sell|watch)',
  'stocks? everyone is (?:buying|talking)',
  '^is .+ (?:a buy|a sell|still a buy)\\??$',
  'price today.+live price',
  'live price.+(?:chart|marketcap)',
  'price.+chart\\s*&\\s*price history',
  '\\bto\\s+USD\\s+live\\s+price\\b',
  '^\\s*[\\d,.]+\\s*\\|\\s*[A-Z]{2,6}\\s+[A-Z]{2,6}\\s*\\|',
];

export interface FilterSignalsOptions {
  /** Minimum LLM quality score (0-100). Default: 40 */
  minQualityScore?: number;
  /** Minimum signal confidence (0-1). Default: 0.3 */
  minConfidence?: number;
  /** Regex patterns for spam title filtering. */
  spamPatterns?: string[];
  /** Tickers to include. Signals not matching any are dropped. */
  relevantTickers?: Set<string>;
  /** Signal IDs to skip (dismissed or already processed). */
  excludeIds?: Set<string>;
}

/**
 * Deterministic signal filter — removes junk, false matches, duplicates, low quality.
 */
export function filterSignals(signals: Signal[], options: FilterSignalsOptions = {}): Signal[] {
  const minQuality = options.minQualityScore ?? 40;
  const minConfidence = options.minConfidence ?? 0.3;
  const spamRegexes = (options.spamPatterns ?? []).map((p) => new RegExp(p, 'i'));

  return signals.filter((signal) => {
    if (options.excludeIds?.has(signal.id)) return false;

    // Skip recurring data snapshots
    if (signal.sources.some((s) => DATA_SNAPSHOT_SOURCES.has(s.id))) return false;

    // PRIMARY GATE: LLM quality assessment (persisted at ingestion)
    if (signal.isFalseMatch === true) return false;
    if (signal.isIrrelevant === true) return false;
    if (signal.isDuplicate === true) return false;
    if (signal.qualityScore !== undefined && signal.qualityScore < minQuality) return false;

    // SAFETY NETS: deterministic fallbacks for signals that bypassed LLM enrichment
    if (signal.confidence < minConfidence) return false;
    if (spamRegexes.some((rx) => rx.test(signal.title))) return false;

    const bodyText = [signal.content, signal.tier1, signal.tier2].filter(Boolean).join(' ');
    if (JUNK_CONTENT_RE.test(bodyText)) return false;
    if (FALSE_MATCH_LABEL_RE.test(bodyText)) return false;

    // Ticker relevance check
    if (options.relevantTickers && !signal.assets.some((a) => options.relevantTickers?.has(a.ticker))) return false;

    return true;
  });
}

/**
 * Classify a signal's output type based on its properties.
 * Used to determine if a signal should appear as an ALERT or INSIGHT.
 */
export function classifyOutputType(signal: Signal): SignalOutputType {
  if (signal.outputType === 'ALERT' || signal.outputType === 'SUMMARY') return signal.outputType;
  if (signal.sentiment === 'BEARISH' && signal.confidence > 0.7) return 'ALERT';
  if (signal.type === 'FILINGS') return 'ALERT';
  if (signal.type === 'TRADING_LOGIC_TRIGGER') return 'ALERT';
  if (signal.type === 'TECHNICAL' && signal.confidence > 0.8) return 'ALERT';
  return 'INSIGHT';
}

/**
 * Title-based dedup — keeps the signal with highest confidence per title.
 */
export function deduplicateByTitle(signals: Signal[]): Signal[] {
  const byTitle = new Map<string, Signal>();
  for (const s of signals) {
    const key = s.title.trim().toLowerCase();
    const existing = byTitle.get(key);
    if (!existing || s.confidence > existing.confidence) {
      byTitle.set(key, s);
    }
  }
  return [...byTitle.values()];
}

// ---------------------------------------------------------------------------
// Event-based deduplication
// ---------------------------------------------------------------------------

/** Recognized event categories and their title-keyword patterns.
 * Order matters — first match wins. More specific categories (FDA, M&A)
 * are checked before broader ones (EARNINGS) to avoid false matches on
 * shared keywords like "results" or "approval". */
const EVENT_PATTERNS: ReadonlyArray<{ category: string; pattern: RegExp }> = [
  {
    category: 'FDA',
    pattern: /\b(fda|clinical\s+trial|phase\s+[1-3]|pdufa)\b/i,
  },
  {
    category: 'MA',
    pattern: /\b(merger|acquisition|acquir(?:es?|ed|ing)|takeover|buyout)\b/i,
  },
  {
    category: 'OFFERING',
    pattern: /\b(ipo|(?:public|secondary)\s+offering|shelf\s+registration)\b/i,
  },
  {
    category: 'ANALYST',
    pattern:
      /\b(upgrade[ds]?|downgrade[ds]?|price\s+target|initiat(?:es?|ing)|overweight|underweight|outperform|underperform)\b/i,
  },
  {
    category: 'EARNINGS',
    pattern:
      /\b(earnings|revenue|eps|guidance|quarterly\s+results|beats?|miss(?:es)?|quarterly|q[1-4]\b|fy\d{2,4}|fiscal|profit|bookings?|backlog|transcript)\b/i,
  },
];

/**
 * Extract an event fingerprint from a signal title.
 * Returns a category string (e.g. 'EARNINGS', 'ANALYST') that identifies the
 * type of corporate event. Returns null for general news — only recognized
 * event categories are fingerprinted to avoid false-positive clustering.
 */
export function extractEventFingerprint(title: string): string | null {
  for (const { category, pattern } of EVENT_PATTERNS) {
    if (pattern.test(title)) return category;
  }
  return null;
}

/**
 * Event-based deduplication — groups signals covering the same underlying event
 * (same ticker, same day, same event category) and keeps only the best signal
 * per event cluster. Sources from dropped cluster members are merged into the
 * kept signal so provenance information is preserved.
 *
 * Unlike deduplicateByTitle (exact title match), this catches paraphrases:
 * "AAPL beats Q3 estimates" and "Apple reports strong Q3 earnings" → same event.
 *
 * Only clusters signals with a recognized event category (earnings, analyst action,
 * FDA, M&A, etc.). Signals with no detected event category pass through unchanged
 * to avoid false-positive grouping of unrelated news.
 */
export function deduplicateByEvent(signals: Signal[]): Signal[] {
  // Build event clusters keyed by "TICKER|DATE|CATEGORY"
  const clusters = new Map<string, Signal[]>();
  const unclustered: Signal[] = [];

  for (const signal of signals) {
    const fingerprint = extractEventFingerprint(signal.title);
    if (!fingerprint || signal.assets.length === 0) {
      unclustered.push(signal);
      continue;
    }

    const day = signal.publishedAt.slice(0, 10);
    for (const asset of signal.assets) {
      const key = `${asset.ticker}|${day}|${fingerprint}`;
      const group = clusters.get(key);
      if (group) {
        group.push(signal);
      } else {
        clusters.set(key, [signal]);
      }
    }
  }

  // Pick the best signal from each cluster
  const kept = new Set<string>();
  const result: Signal[] = [];

  for (const group of clusters.values()) {
    // Sort: highest qualityScore → highest confidence → fewest tickers → longest content
    const sorted = [...group].sort((a, b) => {
      const qa = a.qualityScore ?? 0;
      const qb = b.qualityScore ?? 0;
      if (qa !== qb) return qb - qa;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      if (a.assets.length !== b.assets.length) return a.assets.length - b.assets.length;
      return (b.content?.length ?? 0) - (a.content?.length ?? 0);
    });

    const best = sorted[0];
    if (kept.has(best.id)) continue;

    // Merge sources from cluster members into the representative
    const existingSourceIds = new Set(best.sources.map((s) => s.id));
    const newSources = sorted.slice(1).flatMap((s) => s.sources.filter((src) => !existingSourceIds.has(src.id)));

    result.push(newSources.length > 0 ? { ...best, sources: [...best.sources, ...newSources] } : best);
    kept.add(best.id);
  }

  for (const signal of unclustered) {
    if (!kept.has(signal.id)) {
      kept.add(signal.id);
      result.push(signal);
    }
  }

  return result;
}
