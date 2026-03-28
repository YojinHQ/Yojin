/**
 * CuratedSignalStore — date-partitioned JSONL store for curated signals.
 *
 * Mirrors the SignalArchive pattern: one file per day in data/signals/curated/.
 * A separate watermark.json tracks pipeline progress for incremental processing.
 */

import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CuratedSignal, CurationWatermark } from './types.js';
import { CuratedSignalSchema, CurationWatermarkSchema } from './types.js';
import { createSubsystemLogger } from '../../logging/logger.js';

const logger = createSubsystemLogger('curated-signal-store');

export class CuratedSignalStore {
  private readonly baseDir: string;
  private readonly watermarkPath: string;
  private cachedDismissedIds: Set<string> | null = null;

  constructor(dataRoot: string) {
    this.baseDir = join(dataRoot, 'signals', 'curated');
    this.watermarkPath = join(this.baseDir, 'watermark.json');
  }

  /** Write a batch of curated signals, grouped by date for partitioning. */
  async writeBatch(signals: CuratedSignal[]): Promise<void> {
    if (signals.length === 0) return;

    await mkdir(this.baseDir, { recursive: true });

    // Group by curatedAt date
    const byDate = new Map<string, CuratedSignal[]>();
    for (const cs of signals) {
      const date = cs.curatedAt.slice(0, 10); // YYYY-MM-DD
      const group = byDate.get(date);
      if (group) {
        group.push(cs);
      } else {
        byDate.set(date, [cs]);
      }
    }

    // Append to each date file
    const writes = [...byDate.entries()].map(async ([date, batch]) => {
      const filePath = join(this.baseDir, `${date}.jsonl`);
      const lines = batch.map((cs) => JSON.stringify(CuratedSignalSchema.parse(cs))).join('\n') + '\n';
      await appendFile(filePath, lines);
    });

    await Promise.all(writes);
    logger.info('Curated signals written', { count: signals.length, dates: [...byDate.keys()] });
  }

  /**
   * Query curated signals for a set of tickers.
   * Batch query to prevent N+1 — reads each date file once.
   */
  async queryByTickers(tickers: string[], opts?: { since?: string; limit?: number }): Promise<CuratedSignal[]> {
    const tickerSet = new Set(tickers);
    const since = opts?.since;
    const limit = opts?.limit ?? 1000;

    const dateFiles = await this.listDateFiles(since);
    const results: CuratedSignal[] = [];
    const seenIds = new Set<string>();

    // Read newest first (reverse chronological) — dedup by signal ID, keeping latest
    for (let i = dateFiles.length - 1; i >= 0; i--) {
      const lines = await this.readDateFile(dateFiles[i]);

      for (let j = lines.length - 1; j >= 0; j--) {
        const cs = lines[j];
        if (seenIds.has(cs.signal.id)) continue;
        // Match if any score ticker is in the requested set
        const matches = cs.scores.some((s) => tickerSet.has(s.ticker));
        if (matches) {
          seenIds.add(cs.signal.id);
          results.push(cs);
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  /** Find a single curated signal by its inner signal ID. Returns early on first match. */
  async getBySignalId(signalId: string): Promise<CuratedSignal | null> {
    const dateFiles = await this.listDateFiles();
    // Search newest first
    for (let i = dateFiles.length - 1; i >= 0; i--) {
      const lines = await this.readDateFile(dateFiles[i]);
      for (const cs of lines) {
        if (cs.signal.id === signalId) return cs;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Dismiss tracking
  // ---------------------------------------------------------------------------

  private get dismissedPath(): string {
    return join(this.baseDir, 'dismissed.json');
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
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.dismissedPath, JSON.stringify([...dismissed], null, 2));
    logger.info('Signal dismissed', { signalId });
  }

  /** Get the latest watermark, or null if pipeline has never run. */
  async getLatestWatermark(): Promise<CurationWatermark | null> {
    try {
      const raw = await readFile(this.watermarkPath, 'utf-8');
      return CurationWatermarkSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** Persist watermark after a pipeline run. */
  async saveWatermark(watermark: CurationWatermark): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    const validated = CurationWatermarkSchema.parse(watermark);
    await writeFile(this.watermarkPath, JSON.stringify(validated, null, 2));
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** List date files, optionally filtering by since date. */
  private async listDateFiles(since?: string): Promise<string[]> {
    let files: string[];
    try {
      files = await readdir(this.baseDir);
    } catch {
      return [];
    }

    return files
      .filter((f) => f.endsWith('.jsonl'))
      .filter((f) => !since || f.replace('.jsonl', '') >= since)
      .sort(); // ascending by date
  }

  /** Read and parse all curated signals from a single date file. */
  private async readDateFile(fileName: string): Promise<CuratedSignal[]> {
    const filePath = join(this.baseDir, fileName);
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      return [];
    }

    const results: CuratedSignal[] = [];
    for (const line of content.trim().split('\n')) {
      if (!line) continue;
      try {
        results.push(CuratedSignalSchema.parse(JSON.parse(line)));
      } catch {
        logger.warn('Skipping malformed curated signal line', { file: fileName });
      }
    }
    return results;
  }
}
