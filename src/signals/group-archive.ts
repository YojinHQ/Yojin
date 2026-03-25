/**
 * SignalGroup archive — append-only JSONL storage with date-partitioned files.
 *
 * Stores SignalGroups that link causally related signals into narrative chains.
 * Mirrors SignalArchive — same partitioning, dedup, and query patterns.
 *
 * Storage layout:
 *   data/signals/groups/
 *     by-date/
 *       2026-03-21.jsonl
 *       2026-03-22.jsonl
 */

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { SignalGroup } from './group-types.js';
import { SignalGroupSchema } from './group-types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('signal-group-archive');

export interface SignalGroupArchiveOptions {
  dir: string; // e.g. 'data/signals/groups/by-date'
}

export interface SignalGroupQueryFilter {
  ticker?: string;
  tickers?: string[];
  since?: string;
  until?: string;
  limit?: number;
}

export class SignalGroupArchive {
  private readonly dir: string;
  private dirCreated = false;

  constructor(options: SignalGroupArchiveOptions) {
    this.dir = options.dir;
  }

  /** Append a signal group to the date-partitioned archive. */
  async append(group: SignalGroup): Promise<void> {
    await this.ensureDir();
    const dateKey = group.createdAt.slice(0, 10); // YYYY-MM-DD
    const filePath = join(this.dir, `${dateKey}.jsonl`);
    await appendFile(filePath, JSON.stringify(group) + '\n');
  }

  /**
   * Append an updated version of an existing group to the archive.
   * Semantic alias for `append()` — makes update intent clear at call sites.
   * Deduplication (keeping only the highest version) happens on read via `readFile()`.
   */
  async appendUpdate(group: SignalGroup): Promise<void> {
    return this.append(group);
  }

  /** Append multiple groups (batched for same-day writes). */
  async appendBatch(groups: SignalGroup[]): Promise<void> {
    if (groups.length === 0) return;
    await this.ensureDir();

    // Group by date for efficient file I/O
    const byDate = new Map<string, SignalGroup[]>();
    for (const group of groups) {
      const dateKey = group.createdAt.slice(0, 10);
      const bucket = byDate.get(dateKey) ?? [];
      bucket.push(group);
      byDate.set(dateKey, bucket);
    }

    for (const [dateKey, bucket] of byDate) {
      const filePath = join(this.dir, `${dateKey}.jsonl`);
      const lines = bucket.map((g) => JSON.stringify(g)).join('\n') + '\n';
      await appendFile(filePath, lines);
    }
  }

  /** Query groups across date-partitioned files. */
  async query(filter: SignalGroupQueryFilter = {}): Promise<SignalGroup[]> {
    const files = (await this.listFiles()).reverse(); // newest first
    const results: SignalGroup[] = [];
    const limit = filter.limit ?? Infinity;

    for (const file of files) {
      if (results.length >= limit) break;

      const groups = await this.readFile(file);
      for (const group of [...groups].reverse()) {
        // newest within the day first
        if (results.length >= limit) break;
        if (this.matchesFilter(group, filter)) {
          results.push(group);
        }
      }
    }

    return results;
  }

  /** Find a single group by ID (returns early on first match). */
  async getById(id: string): Promise<SignalGroup | null> {
    const files = (await this.listFiles()).reverse(); // newest first — matches query() strategy

    for (const file of files) {
      const groups = await this.readFile(file);
      for (const group of groups) {
        if (group.id === id) return group;
      }
    }

    return null;
  }

  /**
   * Return groups where any ticker in `group.tickers` overlaps with the given tickers,
   * and `lastEventAt` is within the specified time window.
   *
   * @param tickers - Ticker symbols to match (any overlap qualifies).
   * @param windowHours - How far back to look in hours (default: 168 = 7 days).
   */
  async getByTickers(tickers: string[], windowHours = 168): Promise<SignalGroup[]> {
    if (tickers.length === 0) return [];
    const tickerSet = new Set(tickers);
    const windowMs = windowHours * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - windowMs).toISOString();

    const allGroups = await this.query({});
    return allGroups.filter((g) => g.lastEventAt >= cutoff && g.tickers.some((t) => tickerSet.has(t)));
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

  private async readFile(filePath: string): Promise<SignalGroup[]> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const groups: SignalGroup[] = [];

      for (let i = 0; i < lines.length; i++) {
        try {
          const parsed = SignalGroupSchema.safeParse(JSON.parse(lines[i]));
          if (parsed.success) {
            groups.push(parsed.data);
          } else {
            logger.warn(`Skipping invalid group at ${filePath}:${i}: ${parsed.error.message}`);
          }
        } catch {
          logger.warn(`Skipping malformed group at ${filePath}:${i}`);
        }
      }

      return this.deduplicateByVersion(groups);
    } catch {
      return [];
    }
  }

  /**
   * When multiple entries share the same `id`, keep only the one with the
   * highest `version`. Preserves the relative order of the winning entries.
   */
  private deduplicateByVersion(groups: SignalGroup[]): SignalGroup[] {
    const best = new Map<string, SignalGroup>();
    for (const group of groups) {
      const existing = best.get(group.id);
      if (!existing || group.version > existing.version) {
        best.set(group.id, group);
      }
    }
    // Return in original encounter order (first occurrence of each winning id)
    const seen = new Set<string>();
    const result: SignalGroup[] = [];
    for (const group of groups) {
      if (seen.has(group.id)) continue;
      const winner = best.get(group.id);
      if (winner) result.push(winner);
      seen.add(group.id);
    }
    return result;
  }

  private matchesFilter(group: SignalGroup, filter: SignalGroupQueryFilter): boolean {
    if (filter.tickers && filter.tickers.length > 0) {
      const tickerSet = new Set(filter.tickers);
      if (!group.tickers.some((t) => tickerSet.has(t))) return false;
    } else if (filter.ticker && !group.tickers.includes(filter.ticker)) {
      return false;
    }
    if (filter.since) {
      const bound = filter.since.includes('T') ? filter.since : `${filter.since}T00:00:00.000Z`;
      if (group.lastEventAt < bound) return false;
    }
    if (filter.until) {
      const bound = filter.until.includes('T') ? filter.until : `${filter.until}T23:59:59.999Z`;
      if (group.lastEventAt > bound) return false;
    }
    return true;
  }

  private async ensureDir(): Promise<void> {
    if (this.dirCreated) return;
    await mkdir(this.dir, { recursive: true });
    this.dirCreated = true;
  }
}
