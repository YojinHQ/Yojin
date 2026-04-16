/**
 * MarketSentimentBaselineStore — accumulates daily social sentiment snapshots
 * for broad index ETFs (SPY, QQQ, DIA, IWM).
 *
 * Append-only JSONL in data/market-sentiment/baseline.jsonl.
 * One entry per ticker per day (deduped by ticker+date on append).
 *
 * Once MIN_BASELINE_DAYS of data exist, rolling stats (mean, stddev) can be
 * computed to detect when index sentiment deviates from normal.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MIN_BASELINE_DAYS, SentimentSnapshotSchema } from './types.js';
import type { SentimentBaselineStats, SentimentSnapshot } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('market-sentiment-baseline');

export class MarketSentimentBaselineStore {
  private readonly filePath: string;
  /** In-memory cache of all snapshots, loaded on initialize(). */
  private snapshots: SentimentSnapshot[] = [];
  /** Dedup key set: "TICKER:YYYY-MM-DD" */
  private seen = new Set<string>();

  constructor(dataRoot: string) {
    this.filePath = join(dataRoot, 'market-sentiment', 'baseline.jsonl');
  }

  /** Load existing baseline data from disk. */
  initialize(): void {
    this.snapshots = [];
    this.seen.clear();

    if (!existsSync(this.filePath)) return;

    const lines = readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = SentimentSnapshotSchema.parse(JSON.parse(line));
        const key = `${parsed.ticker}:${parsed.date}`;
        if (!this.seen.has(key)) {
          this.snapshots.push(parsed);
          this.seen.add(key);
        }
      } catch {
        // Skip malformed lines
      }
    }
    logger.info(`Loaded ${this.snapshots.length} sentiment baseline entries`);
  }

  /**
   * Append a sentiment snapshot. Dedupes by ticker+date —
   * only the first observation per ticker per day is kept.
   */
  append(snapshot: SentimentSnapshot): boolean {
    const validated = SentimentSnapshotSchema.parse(snapshot);
    const key = `${validated.ticker}:${validated.date}`;
    if (this.seen.has(key)) return false;

    this.seen.add(key);
    this.snapshots.push(validated);
    appendFileSync(this.filePath, JSON.stringify(validated) + '\n');
    return true;
  }

  /** Get all snapshots for a ticker, ordered by date. */
  getForTicker(ticker: string): SentimentSnapshot[] {
    return this.snapshots.filter((s) => s.ticker === ticker).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Get all snapshots within a date range. */
  getRange(since: string, until?: string): SentimentSnapshot[] {
    return this.snapshots.filter((s) => s.date >= since && (!until || s.date <= until));
  }

  /** Total number of unique days with data for a ticker. */
  dataPointsFor(ticker: string): number {
    return this.getForTicker(ticker).length;
  }

  /** Whether we have enough data to compute meaningful stats. */
  hasEnoughData(ticker: string): boolean {
    return this.dataPointsFor(ticker) >= MIN_BASELINE_DAYS;
  }

  /**
   * Compute rolling baseline stats for a ticker.
   * Returns null if fewer than MIN_BASELINE_DAYS of data exist.
   */
  computeStats(ticker: string): SentimentBaselineStats | null {
    const entries = this.getForTicker(ticker);
    if (entries.length < MIN_BASELINE_DAYS) return null;

    const mentions = entries.map((e) => e.mentions);
    const momenta = entries.reduce<number[]>((acc, e) => {
      if (e.mentionMomentum != null) acc.push(e.mentionMomentum);
      return acc;
    }, []);
    const upvotes = entries.map((e) => e.upvotes);
    const convictions = entries.filter((e) => e.mentions > 0).map((e) => e.upvotes / e.mentions);

    return {
      ticker,
      dataPoints: entries.length,
      mentionsMean: mean(mentions),
      mentionsStdDev: stddev(mentions),
      momentumMean: momenta.length > 0 ? mean(momenta) : 0,
      momentumStdDev: momenta.length > 0 ? stddev(momenta) : 0,
      upvotesMean: mean(upvotes),
      convictionMean: convictions.length > 0 ? mean(convictions) : 0,
    };
  }

  /** Total entries across all tickers. */
  get size(): number {
    return this.snapshots.length;
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
