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
  if (signal.outputType === 'ALERT' || signal.outputType === 'ACTION') return signal.outputType;
  if (signal.sentiment === 'BEARISH' && signal.confidence > 0.7) return 'ALERT';
  if (signal.type === 'FILINGS') return 'ALERT';
  if (signal.type === 'TRADING_LOGIC_TRIGGER') return 'ALERT';
  if (signal.type === 'TECHNICAL' && signal.confidence > 0.8) return 'ALERT';
  return 'INSIGHT';
}

// ---------------------------------------------------------------------------
// Stale enrichment guard — catches historical signals already in the archive
// ---------------------------------------------------------------------------

const TITLE_DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Source IDs that were known to be broken before the 7-day event filter
 * landed (commit 35242d3) — they set `publishedAt: now` for historical
 * events, leaving the archive with stragglers whose titles embed an old
 * YYYY-MM-DD but whose publishedAt is recent. Kept narrow so legitimate
 * historical enrichment (SEC filings, risk signals) is never dropped.
 */
const STALE_BACKFILL_SOURCE_IDS = new Set(['jintel-key-event', 'jintel-short-interest']);

/**
 * Filter out backfilled key-event / short-interest signals whose titles
 * still reference dates older than 30 days. This only targets the two
 * producers that were historically broken — SEC filings and other dated
 * enrichment records are preserved so explicit historical queries work.
 */
export function filterStaleEnrichmentSignals(signals: Signal[]): Signal[] {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  return signals.filter((s) => {
    if (!s.sources.some((src) => STALE_BACKFILL_SOURCE_IDS.has(src.id))) return true;
    const match = s.title.match(TITLE_DATE_RE);
    if (!match) return true;
    const titleDate = new Date(match[1] + 'T00:00:00Z');
    return titleDate >= cutoff;
  });
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
