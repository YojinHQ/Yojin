import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { WatchlistEntrySchema } from './types.js';
import type { Result, WatchlistEntry } from './types.js';
import { getLogger } from '../logging/index.js';

const log = getLogger().sub('watchlist-store');

export class WatchlistStore {
  private readonly entries = new Map<string, WatchlistEntry>();
  private readonly filePath: string;

  constructor(options: { dataDir: string }) {
    this.filePath = join(options.dataDir, 'watchlist', 'watchlist.jsonl');
  }

  async initialize(): Promise<void> {
    const dir = join(this.filePath, '..');
    await mkdir(dir, { recursive: true });

    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch {
      return; // File doesn't exist yet — created on first flush
    }

    const lines = raw.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        const entry = WatchlistEntrySchema.parse(parsed);
        this.entries.set(entry.symbol.toUpperCase(), entry);
      } catch (err) {
        log.warn('Skipping invalid watchlist entry', { line, error: String(err) });
      }
    }
  }

  async add(entry: Omit<WatchlistEntry, 'addedAt'>): Promise<Result> {
    const symbol = entry.symbol.toUpperCase();
    if (this.entries.has(symbol)) {
      return { success: false, error: 'already in watchlist' };
    }

    const full: WatchlistEntry = {
      ...entry,
      symbol,
      addedAt: new Date().toISOString(),
    };
    this.entries.set(symbol, full);
    await this.flush();
    return { success: true };
  }

  async remove(symbol: string): Promise<Result> {
    const key = symbol.toUpperCase();
    if (!this.entries.has(key)) {
      return { success: false, error: 'symbol not found' };
    }

    this.entries.delete(key);
    await this.flush();
    return { success: true };
  }

  list(): WatchlistEntry[] {
    return Array.from(this.entries.values());
  }

  get(symbol: string): WatchlistEntry | undefined {
    return this.entries.get(symbol.toUpperCase());
  }

  has(symbol: string): boolean {
    return this.entries.has(symbol.toUpperCase());
  }

  async updateEntry(
    symbol: string,
    update: Partial<Pick<WatchlistEntry, 'jintelEntityId' | 'resolveAttemptedAt'>>,
  ): Promise<Result> {
    const key = symbol.toUpperCase();
    const entry = this.entries.get(key);
    if (!entry) return { success: false, error: 'symbol not found' };
    this.entries.set(key, { ...entry, ...update });
    await this.flush();
    return { success: true };
  }

  private async flush(): Promise<void> {
    const lines = Array.from(this.entries.values())
      .map((e) => JSON.stringify(e))
      .join('\n');
    await writeFile(this.filePath, lines ? `${lines}\n` : '', 'utf-8');
  }
}
