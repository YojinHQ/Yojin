/**
 * Signal ingestor — converts raw data from any DataSourcePlugin into Signals.
 *
 * The ingestor is the bridge between the generic DataSourcePlugin system
 * (user-configured, source-agnostic) and the signal archive. It:
 *   1. Takes a DataResult from any connected source
 *   2. Auto-classifies the signal type (NEWS, FUNDAMENTAL, etc.)
 *   3. Extracts tickers from the content
 *   4. Computes content hash for deduplication
 *   5. Archives the signal
 *
 * Data sources are connected by the user via DataSourcePlugin config.
 * The ingestor doesn't know or care which specific source produced the data.
 */

import { createHash, randomUUID } from 'node:crypto';

import type { SignalArchive } from './archive.js';
import type { SignalClustering } from './clustering.js';
import type { QualityAgent, QualityVerdict, RecentSignalContext } from './quality-agent.js';
import { JUNK_DOMAIN_RE, JUNK_TITLE_RE, MAX_SIGNAL_AGE_MS, MIN_TITLE_LENGTH } from './quality-patterns.js';
import { extractTickers } from './ticker-extractor.js';
import type { SymbolResolver } from './ticker-extractor.js';
import { SignalSchema } from './types.js';
import type { Signal, SignalType } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('signal-ingestor');

// ---------------------------------------------------------------------------
// Pre-ingest quality filter — cheap deterministic checks that catch obvious
// junk BEFORE we spend LLM tokens on quality evaluation.
// ---------------------------------------------------------------------------

/** Fast pre-filter: returns false for items that are obvious junk. */
function passesPreFilter(item: RawSignalInput): boolean {
  const title = item.title?.trim();
  if (!title || title.length < MIN_TITLE_LENGTH) return false;

  // Stale content
  const pubDate = new Date(item.publishedAt);
  if (isNaN(pubDate.getTime()) || Date.now() - pubDate.getTime() > MAX_SIGNAL_AGE_MS) return false;

  // Non-financial domains
  const link = (item.metadata?.link as string) ?? item.link ?? '';
  if (link && JUNK_DOMAIN_RE.test(link)) return false;

  // Junk title patterns
  if (JUNK_TITLE_RE.test(title)) return false;

  return true;
}

/** Raw data item from a data source, before classification. */
export interface RawSignalInput {
  /** Source plugin ID (e.g. 'web-search', 'rss-reuters'). */
  sourceId: string;
  /** Human-readable source name. */
  sourceName: string;
  /** How the data was obtained. */
  sourceType: 'API' | 'RSS' | 'SCRAPER' | 'ENRICHMENT';
  /** Source reliability score 0-1. */
  reliability: number;
  /** Signal title. */
  title: string;
  /** Full content (optional). */
  content?: string;
  /** URL link (optional). */
  link?: string;
  /** When the data was originally published. */
  publishedAt: string;
  /** Explicit signal type override. If omitted, auto-classified. */
  type?: SignalType;
  /** Explicit ticker list. If omitted, extracted from text. */
  tickers?: string[];
  /** Confidence score 0-1. Defaults to source reliability. */
  confidence?: number;
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  ingested: number;
  duplicates: number;
  errors: string[];
}

export interface IngestorOptions {
  archive: SignalArchive;
  symbolResolver?: SymbolResolver;
  clustering?: SignalClustering;
}

/** Provider that returns the current set of portfolio tickers. */
export type PortfolioTickerProvider = () => Promise<Set<string> | null>;

/** Provider that returns the current set of watchlist tickers. */
export type WatchlistTickerProvider = () => Promise<Set<string> | null>;

/** Hook called after signals are written to the archive. */
export type PostIngestHook = (tickers: string[], ingested: number) => Promise<void>;

export class SignalIngestor {
  private readonly archive: SignalArchive;
  private readonly symbolResolver?: SymbolResolver;
  private clustering?: SignalClustering;
  private qualityAgent?: QualityAgent;
  private portfolioTickerProvider?: PortfolioTickerProvider;
  private watchlistTickerProvider?: WatchlistTickerProvider;
  private postIngestHook?: PostIngestHook;
  private knownHashes = new Map<string, string>(); // contentHash → signalId
  private initialized = false;

  constructor(options: IngestorOptions) {
    this.archive = options.archive;
    this.symbolResolver = options.symbolResolver;
    this.clustering = options.clustering;
  }

  /** Wire portfolio ticker filter — signals with no portfolio ticker are dropped at ingestion. */
  setPortfolioTickerProvider(provider: PortfolioTickerProvider): void {
    this.portfolioTickerProvider = provider;
  }

  /** Wire watchlist ticker filter — watchlist assets are included alongside portfolio assets. */
  setWatchlistTickerProvider(provider: WatchlistTickerProvider): void {
    this.watchlistTickerProvider = provider;
  }

  /** Wire auto-curation — runs deterministic curation after every ingestion. */
  setPostIngestHook(hook: PostIngestHook): void {
    this.postIngestHook = hook;
  }

  /** Late-wire clustering after LLM provider becomes available. */
  setClustering(clustering: SignalClustering): void {
    this.clustering = clustering;
  }

  /** Late-wire quality agent — single LLM gate for all incoming signals. */
  setQualityAgent(agent: QualityAgent): void {
    this.qualityAgent = agent;
  }

  /** Reset cached state after external data wipe (clearAppData). */
  reset(): void {
    this.knownHashes.clear();
    this.initialized = false;
  }

  /** Load existing content hashes from archive for dedup. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const recentSignals = await this.archive.query({ since: ninetyDaysAgo });
    for (const sig of recentSignals) {
      this.knownHashes.set(sig.contentHash, sig.id);
      const currentHash = this.computeHash(sig.title, sig.publishedAt);
      if (currentHash !== sig.contentHash) {
        this.knownHashes.set(currentHash, sig.id);
      }
    }
    logger.info(`Loaded ${this.knownHashes.size} existing content hashes`);
    this.initialized = true;
  }

  /** Ingest a batch of raw data items from any source. */
  async ingest(items: RawSignalInput[]): Promise<IngestResult> {
    await this.initialize();

    // Pre-filter: cheap deterministic checks before we spend LLM tokens.
    const preFiltered = items.filter(passesPreFilter);
    if (preFiltered.length < items.length) {
      logger.debug(`Pre-filter dropped ${items.length - preFiltered.length}/${items.length} items`);
    }

    // Load portfolio + watchlist tickers once for the entire batch
    const portfolioTickers = this.portfolioTickerProvider ? await this.portfolioTickerProvider() : null;
    const watchlistTickers = this.watchlistTickerProvider ? await this.watchlistTickerProvider() : null;

    // Merge into one Set for the filter — a signal is relevant if it matches portfolio OR watchlist
    const relevantTickers: Set<string> | null = (() => {
      if (!portfolioTickers && !watchlistTickers) return null;
      const combined = new Set<string>();
      for (const t of portfolioTickers ?? []) combined.add(t);
      for (const t of watchlistTickers ?? []) combined.add(t);
      return combined;
    })();

    const result: IngestResult = { ingested: 0, duplicates: 0, errors: [] };
    // Pending signals not yet flushed to archive (keyed by id for fast lookup during same-batch merges)
    const pendingById = new Map<string, Signal>();
    const signals: Signal[] = [];
    let dropped = 0;

    for (const item of preFiltered) {
      try {
        const signal = this.toSignal(item);
        if (!signal) continue;

        // Drop signals that have explicit tickers but none match the portfolio or watchlist.
        // Signals with zero extracted tickers are kept — they may be relevant
        // macro/market news that the curation pipeline will score later.
        if (
          relevantTickers &&
          signal.assets.length > 0 &&
          !signal.assets.some((a) => relevantTickers.has(a.ticker.toUpperCase()))
        ) {
          dropped++;
          continue;
        }

        const existingId = this.knownHashes.get(signal.contentHash);
        if (existingId) {
          // Check pending batch first (signal not yet flushed), then archive
          const existing = pendingById.get(existingId) ?? (await this.archive.getById(existingId));
          if (existing) {
            const newSource = signal.sources[0];
            if (!existing.sources.some((s) => s.id === newSource.id)) {
              const merged: Signal = {
                ...existing,
                sources: [...existing.sources, newSource],
                confidence: this.weightedConfidence([...existing.sources, newSource]),
                version: (existing.version ?? 1) + 1,
              };
              // Update pending map so subsequent same-batch dupes see the merged version
              if (pendingById.has(existingId)) {
                pendingById.set(existingId, merged);
                // Replace in signals array so appendBatch writes the merged version
                const idx = signals.findIndex((s) => s.id === existingId);
                if (idx !== -1) signals[idx] = merged;
              } else {
                await this.archive.appendUpdate(merged);
              }
            }
          }
          result.duplicates++;
          continue;
        }

        this.knownHashes.set(signal.contentHash, signal.id);
        pendingById.set(signal.id, signal);
        signals.push(signal);
        result.ingested++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to process item "${item.title}": ${msg}`);
      }
    }

    if (signals.length > 0) {
      // ENRICHMENT-sourced signals bypass clustering + quality agent — write directly.
      // Editorial signals (API/RSS/SCRAPER) go through the full pipeline.
      // Use isEnrichmentOnlySignal so routing is stable regardless of source merge order.
      const enrichmentSignals = signals.filter((s) => this.isEnrichmentOnlySignal(s));
      const editorialSignals = signals.filter((s) => !this.isEnrichmentOnlySignal(s));

      // Evaluate editorial signals BEFORE writing enrichment snapshots so the
      // recent-signals query inside evaluateQuality only sees prior history,
      // not synthetic snapshots from the current batch.
      // Track persisted editorial signals to build an accurate post-ingest ticker set.
      let persistedEditorial: Signal[] = [];
      if (editorialSignals.length > 0) {
        if (this.clustering) {
          try {
            await this.clustering.processSignals(editorialSignals);
            // clustering writes internally — best-effort: treat input as persisted
            persistedEditorial = editorialSignals;
          } catch (err) {
            logger.warn('Signal clustering failed, writing raw signals as fallback', { error: err });
            const enriched = await this.evaluateQuality(editorialSignals);
            await this.archive.appendBatch(enriched);
            persistedEditorial = enriched;
          }
        } else {
          const enriched = await this.evaluateQuality(editorialSignals);
          await this.archive.appendBatch(enriched);
          persistedEditorial = enriched;
        }
      }

      if (enrichmentSignals.length > 0) {
        await this.archive.appendBatch(enrichmentSignals);
      }
      logger.info(
        `Ingested ${signals.length} signals${dropped > 0 ? `, ${dropped} dropped (not in portfolio or watchlist)` : ''}`,
      );

      // Auto-curate: run deterministic curation immediately after ingestion.
      // Derive tickers from actually-persisted signals so downstream consumers
      // (micro research, watchlist cache invalidation) don't fan out for assets
      // whose signals were dropped by quality evaluation.
      if (this.postIngestHook) {
        const persistedSignals = [...persistedEditorial, ...enrichmentSignals];
        const ingestedTickers = [
          ...new Set(persistedSignals.flatMap((s) => s.assets.map((a) => a.ticker.toUpperCase()))),
        ];
        try {
          await this.postIngestHook(ingestedTickers, persistedSignals.length);
        } catch (err) {
          logger.warn('Post-ingest curation failed', { error: err });
        }
      }
    }

    return result;
  }

  /** Convert a raw input to a Signal. */
  private toSignal(input: RawSignalInput): Signal | null {
    const title = input.title?.trim();
    if (!title) return null;

    const pubDate = new Date(input.publishedAt);
    if (isNaN(pubDate.getTime())) return null;
    const publishedAt = pubDate.toISOString();

    const contentHash = this.computeHash(title, publishedAt);
    const textForTickers = `${title} ${input.content ?? ''}`;

    const tickers = input.tickers ?? extractTickers(textForTickers, this.symbolResolver);
    const type = input.type ?? this.classifyType(input);

    const confidence = input.confidence ?? this.scoreConfidence(input, title, tickers, type);

    const metadata: Record<string, unknown> = { ...input.metadata };
    if (input.link) metadata.link = input.link;

    const raw = {
      id: `sig-${randomUUID()}`,
      contentHash,
      type,
      title,
      content: input.content?.trim(),
      assets: tickers.map((ticker) => ({
        ticker,
        relevance: 0.5, // default — refined by portfolio scoring later
        linkType: type === 'MACRO' ? ('MACRO' as const) : ('DIRECT' as const),
      })),
      sources: [
        {
          id: input.sourceId,
          name: input.sourceName,
          type: input.sourceType,
          reliability: input.reliability,
        },
      ],
      publishedAt,
      ingestedAt: new Date().toISOString(),
      confidence,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };

    // Validate before archiving — ensures write/read symmetry
    const result = SignalSchema.safeParse(raw);
    if (!result.success) {
      logger.warn(`Signal validation failed for "${title}": ${result.error.message}`);
      return null;
    }

    return result.data;
  }

  /**
   * Score confidence based on signal quality indicators.
   * Starts from source reliability and adjusts up/down based on content.
   */
  private scoreConfidence(input: RawSignalInput, title: string, tickers: string[], type: SignalType): number {
    let score = input.reliability; // base: 0.7 for RSS/API

    // Specific tickers → more actionable
    if (tickers.length > 0) score += 0.15;
    // Too many tickers → probably a roundup/listicle
    if (tickers.length > 5) score -= 0.1;

    // Classified as something specific (not generic NEWS)
    if (type !== 'NEWS') score += 0.1;

    // Has substantive content beyond just a title
    const content = input.content ?? '';
    if (content.length > 100) score += 0.05;

    // Short vague titles are noise
    if (title.length < 20) score -= 0.15;

    // Clickbait/vague patterns
    if (/\b(you won't believe|shocking|breaking|watch this)\b/i.test(title)) score -= 0.2;

    // Sponsored/ad content
    if (/\b(sponsored|advertisement|promoted|paid post)\b/i.test(`${title} ${content}`)) score -= 0.3;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Auto-classify signal type from content and metadata.
   * Simple heuristic — can be replaced with ML classification later.
   */
  private classifyType(input: RawSignalInput): SignalType {
    const text = `${input.title} ${input.content ?? ''}`.toLowerCase();

    // Filings — SEC, regulatory submissions
    if (/\b(10-k|10-q|8-k|s-1|13f|sec filing|proxy statement|annual report|form 4|insider filing)\b/.test(text)) {
      return 'FILINGS';
    }

    // Social media signals
    if (/\b(tiktok|instagram|youtube|facebook|reddit post|tweet|x\.com|threads|social buzz|viral)\b/.test(text)) {
      return 'SOCIALS';
    }

    // Macro indicators
    if (/\b(fed|federal reserve|gdp|inflation|cpi|interest rate|treasury|fomc|central bank)\b/.test(text)) {
      return 'MACRO';
    }

    // Fundamental data
    if (/\b(earnings|revenue|eps|dividend|balance sheet|cash flow|p\/e|valuation|guidance)\b/.test(text)) {
      return 'FUNDAMENTAL';
    }

    // Sentiment signals
    if (/\b(sentiment|bullish|bearish|fear|greed|social media|trending)\b/.test(text)) {
      return 'SENTIMENT';
    }

    // Technical indicators
    if (/\b(moving average|rsi|macd|support|resistance|breakout|volume spike|technical)\b/.test(text)) {
      return 'TECHNICAL';
    }

    // Default to NEWS for unclassified content
    return 'NEWS';
  }

  /**
   * SHA-256 content hash for dedup. Source-agnostic — same event from
   * different sources yields the same hash.
   *
   * Uses day-precision for publishedAt so that the same article/data point
   * published at different times on the same day is still detected as a
   * duplicate (e.g. RSS feeds republishing with updated timestamps, or
   * enrichment signals re-ingested on the same day).
   */
  private computeHash(title: string, publishedAt: string): string {
    const normalized = title.trim().toLowerCase();
    const day = publishedAt.slice(0, 10); // YYYY-MM-DD
    return createHash('sha256').update(`${normalized}|${day}`).digest('hex');
  }

  /**
   * True when every source on a signal is ENRICHMENT-typed.
   * Used to decide whether a signal bypasses the quality agent.
   * Checking all sources (not just sources[0]) ensures routing is stable
   * regardless of merge order — a signal that had an API source merged in
   * still routes through quality evaluation.
   */
  private isEnrichmentOnlySignal(signal: Signal): boolean {
    return signal.sources.length > 0 && signal.sources.every((s) => s.type === 'ENRICHMENT');
  }

  /** Weighted confidence — bonus scales with average reliability so low-quality sources can't inflate score. */
  private weightedConfidence(sources: Signal['sources']): number {
    const totalReliability = sources.reduce((sum, s) => sum + s.reliability, 0);
    const avgReliability = totalReliability / sources.length;
    const multiSourceBonus = avgReliability * 0.1 * (sources.length - 1);
    return Math.min(1, avgReliability + multiSourceBonus);
  }

  /**
   * Run the quality agent on signals that don't go through clustering.
   * Single LLM call per signal — decides KEEP/DROP and produces summaries.
   *
   * ENRICHMENT-sourced signals bypass the LLM quality gate entirely — they are
   * purpose-built data snapshots (market quotes, technicals, financials) that
   * would score as "boilerplate" despite being valid investment data.
   */
  private async evaluateQuality(signals: Signal[]): Promise<Signal[]> {
    if (!this.qualityAgent) return signals;

    // Split: ENRICHMENT signals are always kept; only editorial signals need LLM evaluation
    const enrichmentSignals = signals.filter((s) => this.isEnrichmentOnlySignal(s));
    const editorialSignals = signals.filter((s) => !this.isEnrichmentOnlySignal(s));

    if (editorialSignals.length === 0) return signals;

    // Pre-fetch recent signals for all tickers in the batch (single query, no N+1).
    const allTickers = [...new Set(editorialSignals.flatMap((s) => s.assets.map((a) => a.ticker)))];
    const recentByTicker = await this.getRecentSignalsByTicker(allTickers);

    const results: Signal[] = [...enrichmentSignals];
    const dropCounts: Record<string, number> = {};
    for (const signal of editorialSignals) {
      const hasSummary = Boolean(signal.tier1 && signal.tier2);
      try {
        // Collect recent signals for this signal's tickers (deduplicated by id)
        const seen = new Set<string>();
        const recentContext: RecentSignalContext[] = [];
        for (const asset of signal.assets) {
          for (const r of recentByTicker.get(asset.ticker) ?? []) {
            if (!seen.has(r.id) && r.id !== signal.id) {
              seen.add(r.id);
              recentContext.push({ id: r.id, title: r.title, tier1: r.tier1, publishedAt: r.publishedAt });
            }
          }
        }

        const verdict: QualityVerdict = await this.qualityAgent.evaluate(signal, recentContext);

        if (verdict.verdict === 'DROP') {
          const reason = verdict.dropReason ?? 'unknown';
          dropCounts[reason] = (dropCounts[reason] ?? 0) + 1;
          logger.info('Quality agent dropped signal', {
            signalId: signal.id,
            title: signal.title,
            reason,
            qualityScore: verdict.qualityScore,
          });
          continue;
        }

        // Persist quality fields + summaries on the signal
        const qualityFields = {
          qualityScore: verdict.qualityScore,
          isFalseMatch: false,
          isIrrelevant: false,
          isDuplicate: false,
        };

        if (hasSummary) {
          results.push({ ...signal, ...qualityFields });
        } else {
          results.push({
            ...signal,
            tier1: verdict.tier1,
            tier2: verdict.tier2,
            sentiment: verdict.sentiment,
            outputType: verdict.outputType,
            ...qualityFields,
          });
        }
      } catch (err) {
        logger.warn('Quality evaluation failed for signal, using raw', {
          signalId: signal.id,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push(signal);
      }
    }
    const totalDropped = Object.values(dropCounts).reduce((sum, n) => sum + n, 0);
    if (totalDropped > 0) {
      logger.info(`Quality agent dropped ${totalDropped} signals`, dropCounts);
    }
    return results;
  }

  private static readonly RECENT_LOOKBACK_MS = 72 * 60 * 60 * 1000;

  /** Single-query fetch of recent signals grouped by ticker for dedup context. */
  private async getRecentSignalsByTicker(tickers: string[]): Promise<Map<string, Signal[]>> {
    if (tickers.length === 0) return new Map();
    const since = new Date(Date.now() - SignalIngestor.RECENT_LOOKBACK_MS).toISOString();
    const recent = await this.archive.query({ tickers, since, limit: tickers.length * 10 });
    const byTicker = new Map<string, Signal[]>();
    for (const signal of recent) {
      for (const asset of signal.assets) {
        const group = byTicker.get(asset.ticker);
        if (group) {
          group.push(signal);
        } else {
          byTicker.set(asset.ticker, [signal]);
        }
      }
    }
    return byTicker;
  }
}
