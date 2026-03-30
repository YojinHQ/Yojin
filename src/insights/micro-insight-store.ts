/**
 * MicroInsightStore — per-ticker JSONL storage for micro research outputs.
 *
 * Each ticker gets its own file at `data/insights/micro/{SYMBOL}.jsonl`.
 * Append-only: new micro insights are appended, `getLatest()` reads the last line.
 */

import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MicroInsightSchema } from './micro-types.js';
import type { MicroInsight } from './micro-types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('micro-insight-store');

export class MicroInsightStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'insights', 'micro');
  }

  async initialize(): Promise<void> {
    if (!existsSync(this.dir)) {
      await mkdir(this.dir, { recursive: true });
    }
  }

  /** Append a micro insight for a ticker. */
  async save(insight: MicroInsight): Promise<void> {
    await this.initialize();
    const filePath = this.filePath(insight.symbol);
    await appendFile(filePath, JSON.stringify(insight) + '\n');
  }

  /** Get the latest micro insight for a ticker, or null if none exists. */
  async getLatest(symbol: string): Promise<MicroInsight | null> {
    const filePath = this.filePath(symbol.toUpperCase());
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }

    const lines = raw.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return null;

    try {
      const lastLine = lines[lines.length - 1];
      if (!lastLine) return null;
      const parsed: unknown = JSON.parse(lastLine);
      return MicroInsightSchema.parse(parsed);
    } catch (err) {
      logger.warn('Failed to parse latest micro insight', { symbol, error: String(err) });
      return null;
    }
  }

  /** Get the latest micro insight for each tracked ticker. */
  async getAllLatest(): Promise<Map<string, MicroInsight>> {
    await this.initialize();
    const result = new Map<string, MicroInsight>();

    let entries: string[];
    try {
      const { readdir } = await import('node:fs/promises');
      entries = await readdir(this.dir);
    } catch {
      return result;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const symbol = entry.replace('.jsonl', '');
      const latest = await this.getLatest(symbol);
      if (latest) result.set(symbol, latest);
    }

    return result;
  }

  /** Get recent micro insights for a ticker (newest first). */
  async getHistory(symbol: string, limit = 10): Promise<MicroInsight[]> {
    const filePath = this.filePath(symbol.toUpperCase());
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      return [];
    }

    const lines = raw.trim().split('\n').filter(Boolean);
    const results: MicroInsight[] = [];

    // Read from end (newest) to start
    for (let i = lines.length - 1; i >= 0 && results.length < limit; i--) {
      const line = lines[i];
      if (!line) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        results.push(MicroInsightSchema.parse(parsed));
      } catch {
        // Skip malformed lines
      }
    }

    return results;
  }

  private filePath(symbol: string): string {
    return join(this.dir, `${symbol.toUpperCase()}.jsonl`);
  }
}
