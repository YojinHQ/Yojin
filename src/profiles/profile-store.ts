/**
 * TickerProfileStore — per-asset persistent knowledge store.
 *
 * One JSONL file per ticker at {dataDir}/{TICKER}.jsonl.
 * Append-only with in-memory BM25 index per ticker for relevance-ranked recall.
 * Compaction via entry-count cap with retention priority for LESSON entries.
 */

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { TickerProfileEntrySchema } from './types.js';
import type { ProfileEntryCategory, TickerProfileBrief, TickerProfileEntry } from './types.js';
import { getLogger } from '../logging/index.js';
import { BM25Index } from '../memory/bm25.js';

const log = getLogger().sub('ticker-profile-store');

/** Retention priority for compaction — higher = keep longer. */
const CATEGORY_PRIORITY: Record<ProfileEntryCategory, number> = {
  LESSON: 4,
  CORRELATION: 3,
  SENTIMENT_SHIFT: 2,
  PATTERN: 1,
  EVENT_REACTION: 1,
  CONTEXT: 0,
};

export class TickerProfileStore {
  private entries = new Map<string, TickerProfileEntry[]>();
  private indices = new Map<string, BM25Index>();
  private readonly baseDir: string;
  private readonly maxEntriesPerTicker: number;
  private dirReady = false;

  constructor(options: { dataDir: string; maxEntriesPerTicker?: number }) {
    this.baseDir = options.dataDir;
    this.maxEntriesPerTicker = options.maxEntriesPerTicker ?? 200;
  }

  async initialize(): Promise<void> {
    await this.ensureDir();

    let files: string[];
    try {
      files = await readdir(this.baseDir);
    } catch {
      return;
    }

    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
    for (const file of jsonlFiles) {
      const ticker = file.replace('.jsonl', '');
      await this.loadTicker(ticker);
    }

    const totalEntries = [...this.entries.values()].reduce((sum, entries) => sum + entries.length, 0);
    log.info('Ticker profile store initialized', {
      tickers: this.entries.size,
      totalEntries,
    });
  }

  async store(input: Omit<TickerProfileEntry, 'id' | 'createdAt'>): Promise<string> {
    const entry: TickerProfileEntry = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    const parsed = TickerProfileEntrySchema.parse(entry);
    await this.appendEntry(parsed);

    const tickerEntries = this.entries.get(parsed.ticker) ?? [];
    tickerEntries.push(parsed);
    this.entries.set(parsed.ticker, tickerEntries);
    this.rebuildIndex(parsed.ticker);

    return parsed.id;
  }

  async storeBatch(inputs: Array<Omit<TickerProfileEntry, 'id' | 'createdAt'>>): Promise<number> {
    const now = new Date().toISOString();
    const byTicker = new Map<string, TickerProfileEntry[]>();

    for (const input of inputs) {
      const entry: TickerProfileEntry = {
        ...input,
        id: randomUUID(),
        createdAt: now,
      };
      const parsed = TickerProfileEntrySchema.parse(entry);
      const group = byTicker.get(parsed.ticker) ?? [];
      group.push(parsed);
      byTicker.set(parsed.ticker, group);
    }

    let stored = 0;
    for (const [ticker, newEntries] of byTicker) {
      const lines = newEntries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await this.ensureDir();
      await appendFile(this.filePath(ticker), lines, 'utf-8');

      const existing = this.entries.get(ticker) ?? [];
      existing.push(...newEntries);
      this.entries.set(ticker, existing);
      this.rebuildIndex(ticker);
      stored += newEntries.length;
    }

    return stored;
  }

  getForTicker(ticker: string): TickerProfileEntry[] {
    return this.entries.get(ticker) ?? [];
  }

  getRecent(ticker: string, limit = 10): TickerProfileEntry[] {
    const entries = this.entries.get(ticker) ?? [];
    return entries.slice(-limit);
  }

  search(ticker: string, query: string, topN = 5): Array<{ entry: TickerProfileEntry; score: number }> {
    const entries = this.entries.get(ticker);
    if (!entries || entries.length === 0) return [];

    const index = this.indices.get(ticker);
    if (!index) return [];

    const results = index.search(query, topN);
    return results.filter((r) => r.score > 0).map((r) => ({ entry: entries[r.index], score: r.score }));
  }

  buildBrief(ticker: string): TickerProfileBrief {
    const entries = this.entries.get(ticker) ?? [];
    if (entries.length === 0) {
      return {
        entryCount: 0,
        recentPatterns: [],
        recentLessons: [],
        correlations: [],
        sentimentHistory: [],
      };
    }

    // Group by category, newest first
    const byCategory = new Map<ProfileEntryCategory, TickerProfileEntry[]>();
    for (const entry of entries) {
      const group = byCategory.get(entry.category) ?? [];
      group.push(entry);
      byCategory.set(entry.category, group);
    }

    // Recent patterns (dedup similar observations)
    const patterns = byCategory.get('PATTERN') ?? [];
    const recentPatterns = dedup(
      patterns
        .slice(-10)
        .reverse()
        .map((e) => e.observation),
      3,
    );

    // Recent lessons
    const lessons = byCategory.get('LESSON') ?? [];
    const recentLessons = lessons
      .slice(-3)
      .reverse()
      .map((e) => e.observation);

    // Correlations
    const correlationEntries = byCategory.get('CORRELATION') ?? [];
    const correlations = dedup(
      correlationEntries
        .slice(-5)
        .reverse()
        .map((e) => e.observation),
      2,
    );

    // Sentiment history from SENTIMENT_SHIFT entries + any entry with rating
    const ratedEntries = entries.filter((e) => e.rating !== null && e.conviction !== null).slice(-5);
    const sentimentHistory = ratedEntries.map((e) => ({
      date: e.insightDate.slice(0, 10),
      rating: e.rating ?? 'NEUTRAL',
      conviction: e.conviction ?? 0,
    }));

    return {
      entryCount: entries.length,
      recentPatterns,
      recentLessons,
      correlations,
      sentimentHistory,
    };
  }

  async prune(ticker: string): Promise<number> {
    const entries = this.entries.get(ticker);
    if (!entries || entries.length <= this.maxEntriesPerTicker) return 0;

    const excess = entries.length - this.maxEntriesPerTicker;

    // Sort by retention priority (ascending) then by date (ascending = oldest first)
    const scored = entries.map((entry, idx) => ({
      entry,
      idx,
      priority: CATEGORY_PRIORITY[entry.category],
      time: new Date(entry.createdAt).getTime(),
    }));

    // Entries within 30 days get a priority boost
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const s of scored) {
      if (s.time > thirtyDaysAgo) s.priority += 5;
    }

    // Sort ascending by priority, then ascending by time → first items are most removable
    scored.sort((a, b) => a.priority - b.priority || a.time - b.time);

    const toRemoveIndices = new Set(scored.slice(0, excess).map((s) => s.idx));
    const retained = entries.filter((_, idx) => !toRemoveIndices.has(idx));

    this.entries.set(ticker, retained);
    await writeFile(this.filePath(ticker), retained.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
    this.rebuildIndex(ticker);

    return excess;
  }

  getTickers(): string[] {
    return [...this.entries.keys()];
  }

  private async loadTicker(ticker: string): Promise<void> {
    const path = this.filePath(ticker);
    let raw: string;
    try {
      raw = await readFile(path, 'utf-8');
    } catch {
      return;
    }

    const entries: TickerProfileEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(TickerProfileEntrySchema.parse(JSON.parse(line)));
      } catch (err) {
        log.warn('Skipping malformed profile entry', { ticker, error: err });
      }
    }

    if (entries.length > 0) {
      this.entries.set(ticker, entries);
      this.rebuildIndex(ticker);
    }
  }

  private rebuildIndex(ticker: string): void {
    const entries = this.entries.get(ticker) ?? [];
    const index = new BM25Index();
    index.build(entries.map((e) => `${e.observation} ${e.evidence}`));
    this.indices.set(ticker, index);
  }

  private async appendEntry(entry: TickerProfileEntry): Promise<void> {
    await this.ensureDir();
    await appendFile(this.filePath(entry.ticker), JSON.stringify(entry) + '\n', 'utf-8');
  }

  private filePath(ticker: string): string {
    return join(this.baseDir, `${ticker}.jsonl`);
  }

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await mkdir(this.baseDir, { recursive: true });
    this.dirReady = true;
  }
}

/**
 * Dedup similar strings by normalized prefix matching.
 * Groups strings with the same first 30 chars and collapses duplicates with count.
 */
function dedup(items: string[], limit: number): string[] {
  const seen = new Map<string, { text: string; count: number }>();

  for (const item of items) {
    const key = item.slice(0, 30).toLowerCase().trim();
    const existing = seen.get(key);
    if (existing) {
      existing.count++;
    } else {
      seen.set(key, { text: item, count: 1 });
    }
  }

  return [...seen.values()].slice(0, limit).map((v) => (v.count > 1 ? `${v.text} (${v.count}x)` : v.text));
}
