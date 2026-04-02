/**
 * Signal Curation Pipeline — deterministic filtering, scoring, and ranking
 * of raw signals against the user's portfolio.
 *
 * Runs frequently (default every 15 min) with no LLM calls.
 * Reads raw signals incrementally via watermark, writes curated output
 * to CuratedSignalStore for downstream consumption (Insights, UI).
 */

import type { AssetClass } from '../../api/graphql/types.js';
import { createSubsystemLogger } from '../../logging/logger.js';
import type { PortfolioSnapshotStore } from '../../portfolio/snapshot-store.js';
import type { WatchlistEntry } from '../../watchlist/types.js';
import type { SignalArchive } from '../archive.js';
import { FALSE_MATCH_LABEL_RE, JUNK_CONTENT_RE } from '../quality-patterns.js';
import type { PortfolioRelevanceScore, Signal, SignalOutputType, SignalType } from '../types.js';
import type { CuratedSignalStore } from './curated-signal-store.js';
import type { CuratedSignal, CurationConfig, CurationRunResult } from './types.js';

const logger = createSubsystemLogger('signal-curation');

// ---------------------------------------------------------------------------
// Type relevance lookup — (signalType, assetClass) → relevance score
// ---------------------------------------------------------------------------

const TYPE_RELEVANCE: Record<SignalType, Record<AssetClass, number>> = {
  NEWS: { EQUITY: 0.7, CRYPTO: 0.6, BOND: 0.5, COMMODITY: 0.5, CURRENCY: 0.5, OTHER: 0.5 },
  FUNDAMENTAL: { EQUITY: 0.9, CRYPTO: 0.3, BOND: 0.7, COMMODITY: 0.4, CURRENCY: 0.3, OTHER: 0.4 },
  SENTIMENT: { EQUITY: 0.5, CRYPTO: 0.8, BOND: 0.3, COMMODITY: 0.5, CURRENCY: 0.4, OTHER: 0.4 },
  TECHNICAL: { EQUITY: 0.6, CRYPTO: 0.7, BOND: 0.4, COMMODITY: 0.6, CURRENCY: 0.6, OTHER: 0.4 },
  MACRO: { EQUITY: 0.8, CRYPTO: 0.6, BOND: 0.9, COMMODITY: 0.8, CURRENCY: 0.9, OTHER: 0.6 },
  FILINGS: { EQUITY: 0.9, CRYPTO: 0.2, BOND: 0.6, COMMODITY: 0.2, CURRENCY: 0.2, OTHER: 0.3 },
  SOCIALS: { EQUITY: 0.4, CRYPTO: 0.8, BOND: 0.2, COMMODITY: 0.4, CURRENCY: 0.3, OTHER: 0.4 },
  TRADING_LOGIC_TRIGGER: { EQUITY: 0.8, CRYPTO: 0.8, BOND: 0.7, COMMODITY: 0.7, CURRENCY: 0.7, OTHER: 0.6 },
};

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Source IDs that produce recurring data snapshots (daily price, technicals, sentiment).
// These are valuable for insight generation but not actionable as standalone Intel Feed cards.
const DATA_SNAPSHOT_SOURCES = new Set(['jintel-snapshot', 'jintel-technicals', 'jintel-sentiment']);

// Promotional / low-quality content patterns — paid articles, clickbait listicles,
// question-as-headline filler, and stock-picker spam. Applied as a quality penalty
// rather than an outright block, so multi-source corroborated signals can still
// survive if the underlying event is real.
const PROMOTIONAL_CONTENT_RE =
  /(?:is .+ (?:a buy|a sell|undervalued|overvalued)\??|(?:top|best) \d+ stocks? to (?:buy|sell|watch)|should you (?:buy|sell)|stocks? everyone is (?:buying|talking)|wall street.s (?:top pick|best kept secret)|(?:millionaire|retire|rich) (?:maker|pick|stock)|next (?:big thing|amazon|tesla)|could (?:soar|crash|skyrocket|plummet) \d+%|don.t miss (?:this|these)|hidden gem|under.?the.?radar)/i;

// ---------------------------------------------------------------------------
// Pipeline options
// ---------------------------------------------------------------------------

export interface CurationPipelineOptions {
  signalArchive: SignalArchive;
  curatedStore: CuratedSignalStore;
  snapshotStore: PortfolioSnapshotStore;
  config: CurationConfig;
  watchlistEntries?: WatchlistEntry[];
}

// ---------------------------------------------------------------------------
// Scoring helpers (exported for testing)
// ---------------------------------------------------------------------------

export function computeExposureWeight(positionMarketValue: number, totalPortfolioValue: number): number {
  if (totalPortfolioValue <= 0) return 0;
  return Math.min(positionMarketValue / totalPortfolioValue, 1);
}

export function computeTypeRelevance(signalType: SignalType, assetClass: AssetClass): number {
  return TYPE_RELEVANCE[signalType]?.[assetClass] ?? 0.5;
}

export function computeRecencyFactor(publishedAt: string, now: number): number {
  const ageMs = now - new Date(publishedAt).getTime();
  if (ageMs <= 0) return 1;
  // Exponential decay with 7-day half-life: exp(-age / (7 days))
  return Math.exp(-ageMs / SEVEN_DAYS_MS);
}

export function computeSourceReliability(signal: Signal): number {
  if (signal.sources.length === 0) return 0.5;
  const sum = signal.sources.reduce((acc, s) => acc + s.reliability, 0);
  return sum / signal.sources.length;
}

/**
 * Content quality — signals with substantive content are more valuable than title-only.
 * Multi-source signals also get a boost (corroborated from multiple feeds).
 */
export function computeContentQuality(signal: Signal): number {
  let score = 0.3; // baseline for title-only

  // Has body content
  const contentLen = signal.content?.length ?? 0;
  if (contentLen > 50) score += 0.2;
  if (contentLen > 200) score += 0.15;
  if (contentLen > 500) score += 0.1;

  // Has LLM-generated summary (processed by clustering or summary generator)
  if (signal.tier1 && signal.tier2) score += 0.15;

  // Multi-source corroboration
  if (signal.sources.length >= 2) score += 0.1;

  // Penalize promotional / low-quality content patterns.
  // Many financial news providers mix real journalism with paid articles,
  // listicles, and question-as-headline clickbait. These add noise, not signal.
  const text = [signal.title, signal.content ?? ''].join(' ');
  if (PROMOTIONAL_CONTENT_RE.test(text)) score -= 0.25;

  return Math.max(0, Math.min(1, score));
}

/**
 * Novelty factor — penalize signals whose title closely matches recently curated signals.
 * Receives a set of recent normalized titles for O(1) lookup.
 */
export function computeNoveltyFactor(signal: Signal, recentTitles: Set<string>): number {
  const normalized = signal.title.trim().toLowerCase();
  // Exact title match — very low novelty (not 0, in case scoring or source differs)
  if (recentTitles.has(normalized)) return 0.2;
  return 1.0;
}

export function computeCompositeScore(
  exposureWeight: number,
  typeRelevance: number,
  recencyFactor: number,
  sourceReliability: number,
  weights: CurationConfig['weights'],
  contentQuality?: number,
  noveltyFactor?: number,
): number {
  const cq = contentQuality ?? 0.5;
  const nf = noveltyFactor ?? 1.0;

  const raw =
    weights.exposure * exposureWeight +
    weights.typeRelevance * typeRelevance +
    weights.recency * recencyFactor +
    weights.sourceReliability * sourceReliability +
    (weights.contentQuality ?? 0) * cq;
  // Novelty is a multiplier, not an additive factor — novel signals keep full score,
  // repeat signals get penalized proportionally
  return Math.max(0, Math.min(1, raw * nf));
}

// ---------------------------------------------------------------------------
// Deterministic outputType classification (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Classify a signal's outputType using deterministic rules.
 *
 * If the signal already has an LLM-assigned outputType (from clustering/summary),
 * we preserve it — this function only upgrades from the default 'INSIGHT'.
 *
 * Rules (checked in order, first match wins):
 *   ALERT:
 *     - BEARISH sentiment with confidence > 0.7
 *     - FILINGS type (SEC filings are always time-sensitive)
 *     - TRADING_LOGIC_TRIGGER type (automated strategy signals)
 *     - TECHNICAL type with confidence > 0.8 (strong technical breakout/breakdown)
 *     - Signal already marked ALERT by LLM (preserve)
 *   INSIGHT:
 *     - Everything else
 */
export function classifyOutputType(signal: Signal): SignalOutputType {
  // Preserve LLM-assigned non-default outputType
  if (signal.outputType === 'ALERT' || signal.outputType === 'ACTION') return signal.outputType;

  if (signal.sentiment === 'BEARISH' && signal.confidence > 0.7) return 'ALERT';
  if (signal.type === 'FILINGS') return 'ALERT';
  if (signal.type === 'TRADING_LOGIC_TRIGGER') return 'ALERT';
  if (signal.type === 'TECHNICAL' && signal.confidence > 0.8) return 'ALERT';

  return 'INSIGHT';
}

// ---------------------------------------------------------------------------
// Shared rank, trim, and title-dedup logic
// ---------------------------------------------------------------------------

function rankTrimAndDedup(curatedSignals: CuratedSignal[], topNPerPosition: number): CuratedSignal[] {
  const scoresByTicker = new Map<string, Array<{ signalId: string; compositeScore: number }>>();
  for (const cs of curatedSignals) {
    for (const score of cs.scores) {
      const group = scoresByTicker.get(score.ticker);
      if (group) {
        group.push({ signalId: cs.signal.id, compositeScore: score.compositeScore });
      } else {
        scoresByTicker.set(score.ticker, [{ signalId: cs.signal.id, compositeScore: score.compositeScore }]);
      }
    }
  }

  const keptIds = new Set<string>();
  for (const [, entries] of scoresByTicker) {
    entries.sort((a, b) => b.compositeScore - a.compositeScore);
    for (const entry of entries.slice(0, topNPerPosition)) {
      keptIds.add(entry.signalId);
    }
  }

  const ranked = curatedSignals.filter((cs) => keptIds.has(cs.signal.id));

  const byTitle = new Map<string, CuratedSignal>();
  for (const cs of ranked) {
    const key = cs.signal.title.trim().toLowerCase();
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, cs);
    } else {
      const maxExisting = Math.max(...existing.scores.map((s) => s.compositeScore));
      const maxCurrent = Math.max(...cs.scores.map((s) => s.compositeScore));
      if (maxCurrent > maxExisting) byTitle.set(key, cs);
    }
  }

  return [...byTitle.values()];
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runCurationPipeline(options: CurationPipelineOptions): Promise<CurationRunResult> {
  const start = Date.now();
  const { signalArchive, curatedStore, snapshotStore, config } = options;

  // 0. Get current portfolio
  const snapshot = await snapshotStore.getLatest();
  const hasPortfolio = snapshot && snapshot.positions.length > 0;
  const hasWatchlist = options.watchlistEntries && options.watchlistEntries.length > 0;

  if (!hasPortfolio && !hasWatchlist) {
    logger.info('No portfolio or watchlist — skipping curation');
    return { signalsProcessed: 0, signalsCurated: 0, signalsDropped: 0, durationMs: Date.now() - start };
  }

  const positions = snapshot?.positions ?? [];
  const portfolioTickers = new Set(positions.map((p) => p.symbol));
  const positionByTicker = new Map(positions.map((p) => [p.symbol, p]));
  const totalValue = snapshot?.totalValue ?? 0;

  // 1. LOAD — incremental via watermark
  // First run: 48-hour lookback (by publishedAt). Subsequent runs: delta from last watermark (by ingestedAt).
  // Using sinceIngested ensures day-precision signals (e.g. fundamentals with publishedAt=00:00:00)
  // aren't skipped on re-runs when the watermark advances past midnight.
  const watermark = await curatedStore.getLatestWatermark();
  const sinceIngested = watermark ? watermark.lastSignalIngestedAt : undefined;
  const since = watermark ? undefined : new Date(Date.now() - FORTY_EIGHT_HOURS_MS).toISOString();

  const rawSignals =
    portfolioTickers.size > 0
      ? await signalArchive.query({ tickers: [...portfolioTickers], since, sinceIngested })
      : [];

  if (rawSignals.length === 0 && !hasWatchlist) {
    logger.info('No new signals to curate');
    return { signalsProcessed: 0, signalsCurated: 0, signalsDropped: 0, durationMs: Date.now() - start };
  }

  // 1b. DEDUP — load already-curated signal IDs to skip re-processing
  const allTickers = [...portfolioTickers];
  if (hasWatchlist && options.watchlistEntries) {
    for (const e of options.watchlistEntries) {
      const sym = e.symbol.toUpperCase();
      if (!portfolioTickers.has(sym)) allTickers.push(sym);
    }
  }
  const alreadyCurated = allTickers.length > 0 ? await curatedStore.queryByTickers(allTickers, { limit: 10000 }) : [];
  const alreadyCuratedIds = new Set(alreadyCurated.map((cs) => cs.signal.id));

  // 2. FILTER — LLM quality flags (primary), then deterministic safety nets
  const spamRegexes = config.spamPatterns.map((p) => new RegExp(p, 'i'));

  const filtered = rawSignals.filter((signal) => {
    // Skip already-curated signals
    if (alreadyCuratedIds.has(signal.id)) return false;

    // Skip recurring data snapshots (price, technicals, sentiment) — they feed insight
    // generation via DataBrief but aren't actionable as standalone Intel Feed cards.
    if (signal.sources.some((s) => DATA_SNAPSHOT_SOURCES.has(s.id))) return false;

    // --- PRIMARY GATE: LLM quality assessment (persisted at ingestion/clustering) ---
    if (signal.isFalseMatch === true) return false;
    if (signal.isIrrelevant === true) return false;
    if (signal.isDuplicate === true) return false;
    if (signal.qualityScore !== undefined && signal.qualityScore < config.minQualityScore) return false;

    // --- SAFETY NETS: deterministic fallbacks for signals that bypassed LLM enrichment ---

    // Confidence threshold
    if (signal.confidence < config.minConfidence) return false;

    // Spam title patterns
    if (spamRegexes.some((rx) => rx.test(signal.title))) return false;

    // Content-based junk filter — drop signals whose body reveals non-substantive content
    // (tracking pixels, ad images, empty scrapes). Check tier1/tier2 summaries too since
    // the LLM may have described the junk content in its summary.
    const bodyText = [signal.content, signal.tier1, signal.tier2].filter(Boolean).join(' ');
    if (JUNK_CONTENT_RE.test(bodyText)) return false;

    // False-match text pattern — catches signals from external sources that report
    // false-match detections as insights (e.g. "no relevance to AXT Inc.").
    if (FALSE_MATCH_LABEL_RE.test(bodyText)) return false;

    // Must have at least one portfolio ticker
    return signal.assets.some((a) => portfolioTickers.has(a.ticker));
  });

  // 3. SCORE — compute PortfolioRelevanceScore per (signal, position)
  const now = Date.now();
  const curatedSignals: CuratedSignal[] = [];

  // Build recent title set for novelty scoring — titles of already-curated signals
  const recentTitles = new Set(alreadyCurated.map((cs) => cs.signal.title.trim().toLowerCase()));

  for (const signal of filtered) {
    const scores: PortfolioRelevanceScore[] = [];
    const reliability = computeSourceReliability(signal);
    const recency = computeRecencyFactor(signal.publishedAt, now);
    const contentQuality = computeContentQuality(signal);
    const novelty = computeNoveltyFactor(signal, recentTitles);

    for (const asset of signal.assets) {
      const position = positionByTicker.get(asset.ticker);
      if (!position) continue;

      const exposure = computeExposureWeight(position.marketValue, totalValue);
      const typeRel = computeTypeRelevance(signal.type, position.assetClass);
      const composite = computeCompositeScore(
        exposure,
        typeRel,
        recency,
        reliability,
        config.weights,
        contentQuality,
        novelty,
      );

      const relevanceScore: PortfolioRelevanceScore = {
        signalId: signal.id,
        ticker: asset.ticker,
        exposureWeight: Number(exposure.toFixed(4)),
        typeRelevance: Number(typeRel.toFixed(4)),
        compositeScore: Number(composite.toFixed(4)),
      };

      scores.push(relevanceScore);
    }

    if (scores.length > 0) {
      // Deterministic outputType classification — upgrades default INSIGHT to ALERT when rules match
      const outputType = classifyOutputType(signal);
      const classified = outputType !== signal.outputType ? { ...signal, outputType } : signal;

      curatedSignals.push({
        signal: classified,
        scores,
        curatedAt: new Date().toISOString(),
        feedTarget: 'PORTFOLIO',
      });
    }
  }

  // 4. RANK & TRIM & TITLE DEDUP
  const rankedDeduped = rankTrimAndDedup(curatedSignals, config.topNPerPosition);

  // 4c. CROSS-TYPE EVENT GROUPING — when the same ticker has both a price-move signal
  // (TECHNICAL from jintel-market) and a news/fundamental signal on the same day,
  // the price move is redundant — the news explains the move. Drop the price-move
  // signal if a more informative signal exists for the same ticker+day.
  const REDUNDANT_SOURCES = new Set(['jintel-market']); // price-move signals
  const tickerDayHasExplanation = new Set<string>();
  for (const cs of rankedDeduped) {
    if (!cs.signal.sources.some((s) => REDUNDANT_SOURCES.has(s.id))) {
      const day = cs.signal.publishedAt.slice(0, 10);
      for (const score of cs.scores) {
        tickerDayHasExplanation.add(`${score.ticker}|${day}`);
      }
    }
  }
  const finalCurated = rankedDeduped.filter((cs) => {
    if (!cs.signal.sources.some((s) => REDUNDANT_SOURCES.has(s.id))) return true;
    // Drop price-move signal if there's already a news/fundamental signal for same ticker+day
    const day = cs.signal.publishedAt.slice(0, 10);
    return !cs.scores.some((score) => tickerDayHasExplanation.has(`${score.ticker}|${day}`));
  });

  await curatedStore.writeBatch(finalCurated);

  // Prevent multi-ticker signals from being re-curated as WATCHLIST
  for (const cs of finalCurated) {
    alreadyCuratedIds.add(cs.signal.id);
  }

  const watchlistResult = options.watchlistEntries
    ? await curateWatchlistSignals({
        watchlistEntries: options.watchlistEntries,
        portfolioTickers,
        signalArchive,
        curatedStore,
        config,
        since,
        sinceIngested,
        alreadyCuratedIds,
        spamRegexes,
      })
    : { curated: [], rawCount: 0 };

  if (watchlistResult.curated.length > 0) {
    await curatedStore.writeBatch(watchlistResult.curated);
  }

  const totalProcessed = rawSignals.length + watchlistResult.rawCount;
  const totalCurated = finalCurated.length + watchlistResult.curated.length;

  if (totalProcessed > 0) {
    const latestIngestedAt =
      rawSignals.length > 0
        ? rawSignals.reduce(
            (latest, s) => (s.ingestedAt > latest ? s.ingestedAt : latest),
            watermark?.lastSignalIngestedAt ?? rawSignals[0].ingestedAt,
          )
        : (watermark?.lastSignalIngestedAt ?? new Date().toISOString());

    await curatedStore.saveWatermark({
      lastRunAt: new Date().toISOString(),
      lastSignalIngestedAt: latestIngestedAt,
      signalsProcessed: totalProcessed,
      signalsCurated: totalCurated,
    });
  }

  const result: CurationRunResult = {
    signalsProcessed: totalProcessed,
    signalsCurated: totalCurated,
    signalsDropped: totalProcessed - totalCurated,
    durationMs: Date.now() - start,
  };

  logger.info('Curation pipeline complete', { ...result, watchlistCurated: watchlistResult.curated.length });
  return result;
}

// ---------------------------------------------------------------------------
// Watchlist curation — high-signal only (grouped signals, no exposure weight)
// ---------------------------------------------------------------------------

interface WatchlistCurationOptions {
  watchlistEntries: WatchlistEntry[];
  portfolioTickers: Set<string>;
  signalArchive: SignalArchive;
  curatedStore: CuratedSignalStore;
  config: CurationConfig;
  since?: string;
  sinceIngested?: string;
  alreadyCuratedIds: Set<string>;
  spamRegexes: RegExp[];
}

interface WatchlistCurationResult {
  curated: CuratedSignal[];
  rawCount: number;
}

async function curateWatchlistSignals(opts: WatchlistCurationOptions): Promise<WatchlistCurationResult> {
  const watchlistOnly = opts.watchlistEntries.filter((e) => !opts.portfolioTickers.has(e.symbol.toUpperCase()));
  if (watchlistOnly.length === 0) return { curated: [], rawCount: 0 };

  const watchlistTickers = new Set(watchlistOnly.map((e) => e.symbol.toUpperCase()));
  const assetClassByTicker = new Map(watchlistOnly.map((e) => [e.symbol.toUpperCase(), e.assetClass]));

  const rawSignals = await opts.signalArchive.query({
    tickers: [...watchlistTickers],
    since: opts.since,
    sinceIngested: opts.sinceIngested,
  });

  if (rawSignals.length === 0) return { curated: [], rawCount: 0 };

  const now = Date.now();
  const recentTitles = new Set<string>();
  const curatedSignals: CuratedSignal[] = [];

  const filtered = rawSignals.filter((signal) => {
    if (opts.alreadyCuratedIds.has(signal.id)) return false;
    if (signal.sources.some((s) => DATA_SNAPSHOT_SOURCES.has(s.id))) return false;
    if (signal.confidence < opts.config.minConfidence) return false;
    if (opts.spamRegexes.some((rx) => rx.test(signal.title))) return false;
    const bodyText = [signal.content, signal.tier1, signal.tier2].filter(Boolean).join(' ');
    if (JUNK_CONTENT_RE.test(bodyText)) return false;
    if (!signal.assets.some((a) => watchlistTickers.has(a.ticker))) return false;
    // Noise gate: only signals that are part of a causal chain (signal group)
    if (!signal.groupId) return false;
    return true;
  });

  for (const signal of filtered) {
    const scores: PortfolioRelevanceScore[] = [];
    const reliability = computeSourceReliability(signal);
    const recency = computeRecencyFactor(signal.publishedAt, now);
    const contentQuality = computeContentQuality(signal);
    const novelty = computeNoveltyFactor(signal, recentTitles);

    for (const asset of signal.assets) {
      if (!watchlistTickers.has(asset.ticker)) continue;
      const assetClass = assetClassByTicker.get(asset.ticker) ?? 'OTHER';
      const typeRel = computeTypeRelevance(signal.type, assetClass);
      const composite = computeCompositeScore(
        0,
        typeRel,
        recency,
        reliability,
        opts.config.weights,
        contentQuality,
        novelty,
      );

      scores.push({
        signalId: signal.id,
        ticker: asset.ticker,
        exposureWeight: 0,
        typeRelevance: Number(typeRel.toFixed(4)),
        compositeScore: Number(composite.toFixed(4)),
      });
    }

    if (scores.length > 0) {
      const outputType = classifyOutputType(signal);
      const classified = outputType !== signal.outputType ? { ...signal, outputType } : signal;
      curatedSignals.push({
        signal: classified,
        scores,
        curatedAt: new Date().toISOString(),
        feedTarget: 'WATCHLIST',
      });
      recentTitles.add(signal.title.trim().toLowerCase());
    }
  }

  const curated = rankTrimAndDedup(curatedSignals, opts.config.topNPerPosition);
  if (curated.length > 0) {
    logger.info('Watchlist curation pass', { signals: curated.length, tickers: [...watchlistTickers] });
  }
  return { curated, rawCount: rawSignals.length };
}
