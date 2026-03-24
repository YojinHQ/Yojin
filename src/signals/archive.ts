/**
 * Signal archive — append-only JSONL storage with date-partitioned files.
 *
 * Stores Signals from any data source (RSS, API, scraper, enrichment).
 * The archive is source-agnostic — it doesn't know or care where signals
 * came from. Data sources are connected via DataSourcePlugin and feed
 * signals through the ingestor.
 *
 * Storage layout:
 *   data/signals/
 *     by-date/
 *       2026-03-21.jsonl
 *       2026-03-22.jsonl
 */

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Signal } from './types.js';
import { SignalSchema } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('signal-archive');

export interface SignalArchiveOptions {
  dir: string; // e.g. 'data/signals/by-date'
}

export interface SignalQueryFilter {
  /** Find a single signal by ID (short-circuits on first match). */
  id?: string;
  /** Filter by signal type (NEWS, FUNDAMENTAL, etc.). */
  type?: string;
  /** Filter by ticker symbol (case-sensitive). */
  ticker?: string;
  /** Filter by multiple ticker symbols (matches any). Takes precedence over `ticker`. */
  tickers?: string[];
  /** Filter by data source ID. */
  sourceId?: string;
  /** ISO date string — only signals on or after this date. */
  since?: string;
  /** ISO date string — only signals on or before this date. */
  until?: string;
  /** Text search in title + content (case-insensitive). */
  search?: string;
  /** Minimum confidence threshold (0-1). Signals below this are excluded. */
  minConfidence?: number;
  /** Max signals to return. */
  limit?: number;
}

export class SignalArchive {
  private readonly dir: string;
  private dirCreated = false;

  constructor(options: SignalArchiveOptions) {
    this.dir = options.dir;
  }

  /** Append a signal to the date-partitioned archive. */
  async append(signal: Signal): Promise<void> {
    await this.ensureDir();
    const dateKey = signal.publishedAt.slice(0, 10); // YYYY-MM-DD
    const filePath = join(this.dir, `${dateKey}.jsonl`);
    await appendFile(filePath, JSON.stringify(signal) + '\n');
  }

  /** Append multiple signals (batched for same-day writes). */
  async appendBatch(signals: Signal[]): Promise<void> {
    if (signals.length === 0) return;
    await this.ensureDir();

    // Group by date for efficient file I/O
    const byDate = new Map<string, Signal[]>();
    for (const signal of signals) {
      const dateKey = signal.publishedAt.slice(0, 10);
      const group = byDate.get(dateKey) ?? [];
      group.push(signal);
      byDate.set(dateKey, group);
    }

    for (const [dateKey, group] of byDate) {
      const filePath = join(this.dir, `${dateKey}.jsonl`);
      const lines = group.map((s) => JSON.stringify(s)).join('\n') + '\n';
      await appendFile(filePath, lines);
    }
  }

  /** Query signals across date-partitioned files. */
  async query(filter: SignalQueryFilter = {}): Promise<Signal[]> {
    const files = (await this.listFiles(filter.since, filter.until)).reverse(); // newest first
    const results: Signal[] = [];
    const limit = filter.limit ?? Infinity;

    for (const file of files) {
      if (results.length >= limit) break;

      const signals = await this.readFile(file);
      for (const signal of [...signals].reverse()) {
        // newest within the day first
        if (results.length >= limit) break;
        if (this.matchesFilter(signal, filter)) {
          results.push(signal);
        }
      }
    }

    return results;
  }

  /** Find a single signal by ID (returns early on first match). */
  async getById(id: string): Promise<Signal | null> {
    const files = (await this.listFiles()).reverse(); // newest first — matches query() strategy

    for (const file of files) {
      const signals = await this.readFile(file);
      for (const signal of signals) {
        if (signal.id === id) return signal;
      }
    }

    return null;
  }

  /** List all available date keys (YYYY-MM-DD). */
  async listDates(): Promise<string[]> {
    try {
      const entries = await readdir(this.dir);
      return entries
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.replace('.jsonl', ''))
        .sort();
    } catch {
      return [];
    }
  }

  /** Load all content hashes for deduplication. */
  async loadContentHashes(): Promise<Set<string>> {
    const hashes = new Set<string>();
    const files = await this.listFiles();

    for (const file of files) {
      const signals = await this.readFile(file);
      for (const signal of signals) {
        hashes.add(signal.contentHash);
      }
    }

    return hashes;
  }

  private async listFiles(since?: string, until?: string): Promise<string[]> {
    let dates: string[];
    try {
      const entries = await readdir(this.dir);
      dates = entries
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.replace('.jsonl', ''))
        .sort();
    } catch {
      return [];
    }

    if (since) {
      const sinceDate = since.slice(0, 10);
      dates = dates.filter((d) => d >= sinceDate);
    }
    if (until) {
      const untilDate = until.slice(0, 10);
      dates = dates.filter((d) => d <= untilDate);
    }

    return dates.map((d) => join(this.dir, `${d}.jsonl`));
  }

  private async readFile(filePath: string): Promise<Signal[]> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const signals: Signal[] = [];

      for (let i = 0; i < lines.length; i++) {
        try {
          const parsed = SignalSchema.safeParse(JSON.parse(lines[i]));
          if (parsed.success) {
            signals.push(parsed.data);
          } else {
            logger.warn(`Skipping invalid signal at ${filePath}:${i}: ${parsed.error.message}`);
          }
        } catch {
          logger.warn(`Skipping malformed signal at ${filePath}:${i}`);
        }
      }

      return signals;
    } catch {
      return [];
    }
  }

  private matchesFilter(signal: Signal, filter: SignalQueryFilter): boolean {
    if (filter.id && signal.id !== filter.id) return false;
    if (filter.type && signal.type !== filter.type) return false;
    if (filter.tickers && filter.tickers.length > 0) {
      const tickerSet = new Set(filter.tickers);
      if (!signal.assets.some((a) => tickerSet.has(a.ticker))) return false;
    } else if (filter.ticker && !signal.assets.some((a) => a.ticker === filter.ticker)) {
      return false;
    }
    if (filter.sourceId && !signal.sources.some((s) => s.id === filter.sourceId)) return false;
    if (filter.since) {
      // When since is a date-only string (no 'T'), match from start of day
      const bound = filter.since.includes('T') ? filter.since : `${filter.since}T00:00:00.000Z`;
      if (signal.publishedAt < bound) return false;
    }
    if (filter.until) {
      // When until is a date-only string (no 'T'), include the entire day
      const bound = filter.until.includes('T') ? filter.until : `${filter.until}T23:59:59.999Z`;
      if (signal.publishedAt > bound) return false;
    }
    if (filter.search) {
      const term = filter.search.toLowerCase();
      const haystack = `${signal.title} ${signal.content ?? ''}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    if (filter.minConfidence != null && signal.confidence < filter.minConfidence) return false;
    return true;
  }

  private async ensureDir(): Promise<void> {
    if (this.dirCreated) return;
    await mkdir(this.dir, { recursive: true });
    this.dirCreated = true;
  }
}
