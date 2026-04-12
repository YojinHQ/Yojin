/**
 * Signal cleanup pass — the first phase of a dream run.
 *
 * 1. Staleness sweep: auto-dismiss signals older than the configured window
 * 2. Cross-source dedup: find near-duplicate signals and mark the lower-quality ones
 * 3. Quality feedback: extract patterns from signals repeatedly classified as NOISE
 */

import type { DreamConfig, SignalCleanupResult } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { SignalArchive } from '../signals/archive.js';
import type { AssessmentStore } from '../signals/curation/assessment-store.js';
import type { Signal } from '../signals/types.js';

const logger = createSubsystemLogger('dream-signal-cleanup');

// ---------------------------------------------------------------------------
// Title similarity — cheap Jaccard on word sets
// ---------------------------------------------------------------------------

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const SIMILARITY_THRESHOLD = 0.75;

// ---------------------------------------------------------------------------
// Pass 1: Staleness sweep
// ---------------------------------------------------------------------------

async function sweepStaleSignals(archive: SignalArchive, config: DreamConfig): Promise<number> {
  const maxAgeMs = config.staleSignalDays * 24 * 60 * 60 * 1000;
  const dismissed = await archive.autoDismissStale(maxAgeMs);
  if (dismissed > 0) {
    logger.info('Dismissed stale signals', { count: dismissed, maxAgeDays: config.staleSignalDays });
  }
  return dismissed;
}

// ---------------------------------------------------------------------------
// Pass 2: Cross-source dedup
// ---------------------------------------------------------------------------

async function deduplicateCrossSources(archive: SignalArchive, config: DreamConfig): Promise<number> {
  const since = new Date(Date.now() - config.staleSignalDays * 24 * 60 * 60 * 1000).toISOString();
  const signals = await archive.query({ since, limit: 2000 });

  if (signals.length < 2) return 0;

  // Group by primary ticker for efficient comparison
  const byTicker = new Map<string, Signal[]>();
  for (const signal of signals) {
    const ticker = signal.assets[0]?.ticker ?? '_none';
    let group = byTicker.get(ticker);
    if (!group) {
      group = [];
      byTicker.set(ticker, group);
    }
    group.push(signal);
  }

  const toDismiss: string[] = [];

  for (const [, group] of byTicker) {
    if (group.length < 2) continue;

    // Pre-tokenize titles
    const tokenized = group.map((s) => ({ signal: s, tokens: tokenize(s.title) }));

    // Compare pairs within the group
    for (let i = 0; i < tokenized.length; i++) {
      for (let j = i + 1; j < tokenized.length; j++) {
        const similarity = jaccardSimilarity(tokenized[i].tokens, tokenized[j].tokens);
        if (similarity >= SIMILARITY_THRESHOLD) {
          // Keep the higher quality signal, dismiss the other
          const a = tokenized[i].signal;
          const b = tokenized[j].signal;
          const loser = pickLowerQuality(a, b);
          toDismiss.push(loser.id);
        }
      }
    }
  }

  // Deduplicate the dismiss list (a signal could lose to multiple winners)
  const uniqueDismissals = [...new Set(toDismiss)];

  // Dismiss in batch
  const dismissed = await archive.getDismissedIds();
  let newDismissals = 0;
  for (const id of uniqueDismissals) {
    if (!dismissed.has(id)) {
      await archive.dismiss(id);
      newDismissals++;
    }
  }

  if (newDismissals > 0) {
    logger.info('Dismissed cross-source duplicates', { count: newDismissals });
  }
  return newDismissals;
}

/** Pick the lower-quality signal from a near-duplicate pair. */
function pickLowerQuality(a: Signal, b: Signal): Signal {
  // Prefer higher quality score
  const qa = a.qualityScore ?? 50;
  const qb = b.qualityScore ?? 50;
  if (qa !== qb) return qa < qb ? a : b;

  // Prefer higher confidence
  if (a.confidence !== b.confidence) return a.confidence < b.confidence ? a : b;

  // Prefer more sources
  if (a.sources.length !== b.sources.length) return a.sources.length < b.sources.length ? a : b;

  // Tie-break: keep the newer one
  return new Date(a.publishedAt).getTime() < new Date(b.publishedAt).getTime() ? a : b;
}

// ---------------------------------------------------------------------------
// Pass 3: Quality feedback — learn patterns from repeated NOISE
// ---------------------------------------------------------------------------

async function extractNoisePatterns(assessmentStore: AssessmentStore, config: DreamConfig): Promise<string[]> {
  // Query recent assessments across all tickers
  // AssessmentStore.queryByTickers needs tickers — we scan recent reports instead
  const latest = await assessmentStore.getLatest();
  if (!latest) return [];

  // Collect NOISE verdicts from recent assessment reports
  const noiseReasons = new Map<string, number>();
  for (const assessment of latest.assessments) {
    if (assessment.verdict === 'NOISE') {
      // Extract a normalizable pattern from the reasoning
      const key = normalizeNoiseReason(assessment.reasoning);
      if (key) {
        noiseReasons.set(key, (noiseReasons.get(key) ?? 0) + 1);
      }
    }
  }

  // Only graduate patterns that appear enough times
  const learned: string[] = [];
  for (const [pattern, count] of noiseReasons) {
    if (count >= config.noisePatternThreshold) {
      learned.push(pattern);
    }
  }

  if (learned.length > 0) {
    logger.info('Learned noise patterns from assessments', { count: learned.length, patterns: learned });
  }

  return learned;
}

/**
 * Extract a normalizable pattern from a NOISE reasoning string.
 * Returns null if the reasoning is too specific to generalize.
 */
function normalizeNoiseReason(reasoning: string): string | null {
  const lower = reasoning.toLowerCase();

  // Common generalizable noise patterns
  if (lower.includes('price recap') || lower.includes('price summary')) return 'price recap';
  if (lower.includes('no new information') || lower.includes('already known')) return 'no new information';
  if (lower.includes('generic market') || lower.includes('broad market')) return 'generic market commentary';
  if (lower.includes('listicle') || lower.includes('top stocks')) return 'listicle';
  if (lower.includes('clickbait')) return 'clickbait';
  if (lower.includes('outdated') || lower.includes('old news')) return 'outdated';
  if (lower.includes('promotional') || lower.includes('sponsored')) return 'promotional';

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SignalCleanupDeps {
  signalArchive: SignalArchive;
  assessmentStore: AssessmentStore;
}

export async function runSignalCleanup(deps: SignalCleanupDeps, config: DreamConfig): Promise<SignalCleanupResult> {
  const [dismissed, duplicatesMarked, learnedPatterns] = await Promise.all([
    sweepStaleSignals(deps.signalArchive, config),
    deduplicateCrossSources(deps.signalArchive, config),
    extractNoisePatterns(deps.assessmentStore, config),
  ]);

  return { dismissed, duplicatesMarked, learnedPatterns };
}
