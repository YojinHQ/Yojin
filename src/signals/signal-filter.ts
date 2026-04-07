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

// Stop words excluded from fuzzy title comparison
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'its',
  'it',
  'this',
  'that',
  'these',
  'those',
  'as',
  'not',
  'no',
  'so',
  'if',
  'up',
  'out',
  'about',
  'into',
  'over',
  'after',
  'before',
  'between',
  'through',
  'new',
  'says',
  'said',
  'sign',
  'signs',
  'report',
  'reports',
  'according',
]);

/** Extract significant words from a title for fuzzy comparison. */
function extractSignificantWords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return new Set(words);
}

/** Jaccard similarity between two word sets (0-1). */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Minimum Jaccard similarity to consider two titles as covering the same event. */
const FUZZY_DEDUP_THRESHOLD = 0.45;

/**
 * Title-based dedup — keeps the signal with highest confidence per title.
 * Uses fuzzy matching: Jaccard word similarity above threshold treats
 * differently-worded headlines about the same event as duplicates.
 */
export function deduplicateByTitle(signals: Signal[]): Signal[] {
  // First pass: exact title dedup (fast path)
  const byExactTitle = new Map<string, Signal>();
  for (const s of signals) {
    const key = s.title.trim().toLowerCase();
    const existing = byExactTitle.get(key);
    if (!existing || s.confidence > existing.confidence) {
      byExactTitle.set(key, s);
    }
  }
  const exactDeduped = [...byExactTitle.values()];

  // Second pass: fuzzy dedup — group signals covering the same event
  const kept: Signal[] = [];
  const keptWords: Array<{ signal: Signal; words: Set<string> }> = [];

  for (const signal of exactDeduped) {
    const words = extractSignificantWords(signal.title);

    // Check against already-kept signals for fuzzy match
    let isDuplicate = false;
    for (const entry of keptWords) {
      const similarity = jaccardSimilarity(words, entry.words);
      if (similarity >= FUZZY_DEDUP_THRESHOLD) {
        // Keep the one with higher confidence
        if (signal.confidence > entry.signal.confidence) {
          const idx = kept.indexOf(entry.signal);
          kept[idx] = signal;
          entry.signal = signal;
          entry.words = words;
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(signal);
      keptWords.push({ signal, words });
    }
  }

  return kept;
}
