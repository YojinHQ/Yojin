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

import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
  /** ISO date string — only signals published on or after this date. */
  since?: string;
  /** ISO date string — only signals published on or before this date. */
  until?: string;
  /** ISO date string — only signals ingested on or after this timestamp (uses ingestedAt, not publishedAt). */
  sinceIngested?: string;
  /** Text search in title + content (case-insensitive). */
  search?: string;
  /** Minimum confidence threshold (0-1). Signals below this are excluded. */
  minConfidence?: number;
  /** Filter by output type (INSIGHT or ALERT). */
  outputType?: string;
  /** Max signals to return. */
  limit?: number;
}

/** Pre-compiled filter — avoids per-signal allocations in the hot loop. */
interface CompiledFilter {
  id: string | undefined;
  type: string | undefined;
  tickerSet: Set<string> | null;
  sourceId: string | undefined;
  sinceBound: string | null;
  sinceIngestedBound: string | null;
  untilBound: string | null;
  searchTerm: string | null;
  minConfidence: number | null;
  outputType: string | undefined;
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

  /**
   * Append an updated version of an existing signal to the archive.
   * Semantic alias for `append()` — makes update intent clear at call sites.
   * Deduplication (keeping only the highest version) happens on read via `readFile()`.
   */
  async appendUpdate(signal: Signal): Promise<void> {
    return this.append(signal);
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
    // Only prune by publishedAt date. sinceIngested is a record-level filter —
    // don't use it as a file-level hint because files are indexed by publishedAt.
    const fileHintSince = filter.since;
    const files = (await this.listFiles(fileHintSince, filter.until)).reverse(); // newest first
    const results: Signal[] = [];
    const limit = filter.limit ?? Infinity;

    // Pre-compute ticker set once instead of per-signal
    const compiled = this.compileFilter(filter);

    for (const file of files) {
      if (results.length >= limit) break;

      const signals = await this.readFile(file);
      for (const signal of [...signals].reverse()) {
        // newest within the day first
        if (results.length >= limit) break;
        if (this.matchesCompiled(signal, compiled)) {
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

  /** Find multiple signals by ID in a single pass over the archive files. */
  async getByIds(ids: string[]): Promise<Signal[]> {
    if (ids.length === 0) return [];
    const remaining = new Set(ids);
    const found = new Map<string, Signal>();
    const files = (await this.listFiles()).reverse();

    for (const file of files) {
      if (remaining.size === 0) break;
      const signals = await this.readFile(file);
      for (const signal of signals) {
        if (remaining.has(signal.id)) {
          found.set(signal.id, signal);
          remaining.delete(signal.id);
        }
      }
    }

    // Return in the original request order
    return ids.map((id) => found.get(id)).filter((s): s is Signal => s != null);
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

      return this.deduplicateByVersion(signals);
    } catch {
      return [];
    }
  }

  /**
   * When multiple entries share the same `id`, keep only the one with the
   * highest `version`. Preserves the relative order of the winning entries.
   */
  private deduplicateByVersion(signals: Signal[]): Signal[] {
    const best = new Map<string, Signal>();
    for (const signal of signals) {
      const existing = best.get(signal.id);
      if (!existing || signal.version > existing.version) {
        best.set(signal.id, signal);
      }
    }
    // Return in original encounter order (first occurrence of each winning id)
    const seen = new Set<string>();
    const result: Signal[] = [];
    for (const signal of signals) {
      if (seen.has(signal.id)) continue;
      const winner = best.get(signal.id);
      if (winner) result.push(winner);
      seen.add(signal.id);
    }
    return result;
  }

  /**
   * Pre-compute expensive filter values once (ticker Set, lowered search term,
   * ISO bounds) so matchesCompiled does zero allocations per signal.
   */
  private compileFilter(filter: SignalQueryFilter): CompiledFilter {
    return {
      id: filter.id,
      type: filter.type,
      tickerSet:
        filter.tickers && filter.tickers.length > 0
          ? new Set(filter.tickers)
          : filter.ticker
            ? new Set([filter.ticker])
            : null,
      sourceId: filter.sourceId,
      sinceBound: filter.since ? (filter.since.includes('T') ? filter.since : `${filter.since}T00:00:00.000Z`) : null,
      sinceIngestedBound: filter.sinceIngested ?? null,
      untilBound: filter.until ? (filter.until.includes('T') ? filter.until : `${filter.until}T23:59:59.999Z`) : null,
      searchTerm: filter.search?.toLowerCase() ?? null,
      minConfidence: filter.minConfidence ?? null,
      outputType: filter.outputType,
    };
  }

  private matchesCompiled(signal: Signal, f: CompiledFilter): boolean {
    if (f.id && signal.id !== f.id) return false;
    if (f.type && signal.type !== f.type) return false;
    if (f.tickerSet) {
      const ts = f.tickerSet;
      if (!signal.assets.some((a) => ts.has(a.ticker))) return false;
    }
    if (f.sourceId && !signal.sources.some((s) => s.id === f.sourceId)) return false;
    if (f.sinceBound && signal.publishedAt < f.sinceBound) return false;
    if (f.sinceIngestedBound && signal.ingestedAt < f.sinceIngestedBound) return false;
    if (f.untilBound && signal.publishedAt > f.untilBound) return false;
    if (f.searchTerm) {
      const haystack = `${signal.title} ${signal.content ?? ''}`.toLowerCase();
      if (!haystack.includes(f.searchTerm)) return false;
    }
    if (f.minConfidence != null && signal.confidence < f.minConfidence) return false;
    if (f.outputType && (signal.outputType ?? 'INSIGHT') !== f.outputType) return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Dismiss tracking
  // ---------------------------------------------------------------------------

  private cachedDismissedIds: Set<string> | null = null;

  private get dismissedPath(): string {
    return join(this.dir, 'dismissed.json');
  }

  /** Load the set of dismissed signal IDs (cached in memory after first load). */
  async getDismissedIds(): Promise<Set<string>> {
    if (this.cachedDismissedIds) return this.cachedDismissedIds;
    try {
      const raw = await readFile(this.dismissedPath, 'utf-8');
      const ids = JSON.parse(raw) as string[];
      this.cachedDismissedIds = new Set(ids);
    } catch {
      this.cachedDismissedIds = new Set();
    }
    return this.cachedDismissedIds;
  }

  /** Mark a signal as dismissed. */
  async dismiss(signalId: string): Promise<void> {
    const dismissed = await this.getDismissedIds();
    dismissed.add(signalId);
    await this.ensureDir();
    await writeFile(this.dismissedPath, JSON.stringify([...dismissed], null, 2));
    logger.info('Signal dismissed', { signalId });
  }

  // ---------------------------------------------------------------------------
  // Shown tracking — auto-dismiss after staleness window
  // ---------------------------------------------------------------------------

  private cachedShownMap: Map<string, string> | null = null;

  private get shownPath(): string {
    return join(this.dir, 'shown.json');
  }

  /** Load the shown map: signalId → ISO timestamp of first display. */
  private async getShownMap(): Promise<Map<string, string>> {
    if (this.cachedShownMap) return this.cachedShownMap;
    try {
      const raw = await readFile(this.shownPath, 'utf-8');
      const obj = JSON.parse(raw) as Record<string, string>;
      this.cachedShownMap = new Map(Object.entries(obj));
    } catch {
      this.cachedShownMap = new Map();
    }
    return this.cachedShownMap;
  }

  private async persistShownMap(): Promise<void> {
    const shown = await this.getShownMap();
    await this.ensureDir();
    await writeFile(this.shownPath, JSON.stringify(Object.fromEntries(shown), null, 2));
  }

  /** Record the first time signal IDs are shown to the user. Already-tracked and dismissed IDs are skipped. */
  async markShown(signalIds: string[]): Promise<void> {
    if (signalIds.length === 0) return;
    const shown = await this.getShownMap();
    const dismissed = await this.getDismissedIds();
    const now = new Date().toISOString();
    let added = 0;
    for (const id of signalIds) {
      if (!shown.has(id) && !dismissed.has(id)) {
        shown.set(id, now);
        added++;
      }
    }
    if (added > 0) {
      await this.persistShownMap();
      logger.debug('Marked signals as shown', { added, total: shown.size });
    }
  }

  /** Auto-dismiss signals shown longer than `maxAgeMs` ago. Returns count of newly dismissed. */
  async autoDismissStale(maxAgeMs: number): Promise<number> {
    const shown = await this.getShownMap();
    if (shown.size === 0) return 0;

    const cutoff = Date.now() - maxAgeMs;
    const staleIds: string[] = [];

    for (const [id, shownAt] of shown) {
      if (new Date(shownAt).getTime() <= cutoff) {
        staleIds.push(id);
      }
    }

    if (staleIds.length === 0) return 0;

    // Dismiss stale signals
    const dismissed = await this.getDismissedIds();
    for (const id of staleIds) {
      dismissed.add(id);
      shown.delete(id);
    }

    // Persist both files
    await this.ensureDir();
    await Promise.all([writeFile(this.dismissedPath, JSON.stringify([...dismissed], null, 2)), this.persistShownMap()]);

    logger.info('Auto-dismissed stale signals', { count: staleIds.length });
    return staleIds.length;
  }

  /** Reset cached state after external data wipe (clearAppData). */
  reset(): void {
    this.dirCreated = false;
    this.cachedDismissedIds = null;
    this.cachedShownMap = null;
  }

  private async ensureDir(): Promise<void> {
    if (this.dirCreated) return;
    await mkdir(this.dir, { recursive: true });
    this.dirCreated = true;
  }
}
