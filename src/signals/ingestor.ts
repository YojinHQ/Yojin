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
import { extractTickers } from './ticker-extractor.js';
import type { SymbolResolver } from './ticker-extractor.js';
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
}

export class SignalIngestor {
  private readonly archive: SignalArchive;
  private readonly symbolResolver?: SymbolResolver;
  private knownHashes = new Set<string>();
  private initialized = false;

  constructor(options: IngestorOptions) {
    this.archive = options.archive;
    this.symbolResolver = options.symbolResolver;
  }

  /** Load existing content hashes from archive for dedup. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.knownHashes = await this.archive.loadContentHashes();
    logger.info(`Loaded ${this.knownHashes.size} existing content hashes`);
    this.initialized = true;
  }

  /** Ingest a batch of raw data items from any source. */
  async ingest(items: RawSignalInput[]): Promise<IngestResult> {
    await this.initialize();

    const result: IngestResult = { ingested: 0, duplicates: 0, errors: [] };
    const signals: Signal[] = [];

    for (const item of items) {
      try {
        const signal = this.toSignal(item);
        if (!signal) continue;

        if (this.knownHashes.has(signal.contentHash)) {
          result.duplicates++;
          continue;
        }

        this.knownHashes.add(signal.contentHash);
        signals.push(signal);
        result.ingested++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to process item "${item.title}": ${msg}`);
      }
    }

    if (signals.length > 0) {
      await this.archive.appendBatch(signals);
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

    const contentHash = this.computeHash(title, input.sourceId, publishedAt);
    const textForTickers = `${title} ${input.content ?? ''}`;

    const tickers = input.tickers ?? extractTickers(textForTickers, this.symbolResolver);
    const type = input.type ?? this.classifyType(input);

    return {
      id: randomUUID().slice(0, 12),
      contentHash,
      type,
      title,
      content: input.content?.trim(),
      assets: tickers.map((ticker) => ({
        ticker,
        relevance: 0.5, // default — refined by portfolio scoring later
        linkType: 'DIRECT' as const,
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
      confidence: input.confidence ?? input.reliability,
      ...(input.metadata || input.link
        ? {
            metadata: {
              ...input.metadata,
              ...(input.link ? { link: input.link } : {}),
            },
          }
        : {}),
    };
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

  /** SHA-256 content hash for dedup. */
  private computeHash(title: string, sourceId: string, publishedAt: string): string {
    return createHash('sha256').update(`${title}|${sourceId}|${publishedAt}`).digest('hex');
  }
}
