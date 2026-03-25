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
import { extractTickers } from './ticker-extractor.js';
import type { SymbolResolver } from './ticker-extractor.js';
import { SignalSchema } from './types.js';
import type { Signal, SignalType } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('signal-ingestor');

/** Raw data item from a data source, before classification. */
export interface RawSignalInput {
  /** Source plugin ID (e.g. 'exa-search', 'firecrawl', 'rss-reuters'). */
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

export class SignalIngestor {
  private readonly archive: SignalArchive;
  private readonly symbolResolver?: SymbolResolver;
  private clustering?: SignalClustering;
  private knownHashes = new Map<string, string>(); // contentHash → signalId
  private initialized = false;

  constructor(options: IngestorOptions) {
    this.archive = options.archive;
    this.symbolResolver = options.symbolResolver;
    this.clustering = options.clustering;
  }

  /** Late-wire clustering after LLM provider becomes available. */
  setClustering(clustering: SignalClustering): void {
    this.clustering = clustering;
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

    const result: IngestResult = { ingested: 0, duplicates: 0, errors: [] };
    // Pending signals not yet flushed to archive (keyed by id for fast lookup during same-batch merges)
    const pendingById = new Map<string, Signal>();
    const signals: Signal[] = [];

    for (const item of items) {
      try {
        const signal = this.toSignal(item);
        if (!signal) continue;

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
      if (this.clustering) {
        try {
          await this.clustering.processSignals(signals);
        } catch (err) {
          logger.warn('Signal clustering failed, writing raw signals as fallback', { error: err });
          await this.archive.appendBatch(signals);
        }
      } else {
        await this.archive.appendBatch(signals);
      }
      logger.info(`Ingested ${signals.length} signals`);
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

    // Macro indicators
    if (/\b(fed|federal reserve|gdp|inflation|cpi|interest rate|treasury|fomc|central bank)\b/.test(text)) {
      return 'MACRO';
    }

    // Fundamental data
    if (/\b(earnings|revenue|eps|dividend|balance sheet|cash flow|p\/e|valuation|guidance)\b/.test(text)) {
      return 'FUNDAMENTAL';
    }

    // Sentiment signals
    if (/\b(sentiment|bullish|bearish|fear|greed|social media|trending|reddit|twitter)\b/.test(text)) {
      return 'SENTIMENT';
    }

    // Technical indicators
    if (/\b(moving average|rsi|macd|support|resistance|breakout|volume spike|technical)\b/.test(text)) {
      return 'TECHNICAL';
    }

    // Default to NEWS for unclassified content
    return 'NEWS';
  }

  /** SHA-256 content hash for dedup. Source-agnostic — same event from different sources yields the same hash. */
  private computeHash(title: string, publishedAt: string): string {
    const normalized = title.trim().toLowerCase();
    return createHash('sha256').update(`${normalized}|${publishedAt}`).digest('hex');
  }

  /** Weighted confidence — bonus scales with average reliability so low-quality sources can't inflate score. */
  private weightedConfidence(sources: Signal['sources']): number {
    const totalReliability = sources.reduce((sum, s) => sum + s.reliability, 0);
    const avgReliability = totalReliability / sources.length;
    const multiSourceBonus = avgReliability * 0.1 * (sources.length - 1);
    return Math.min(1, avgReliability + multiSourceBonus);
  }
}
