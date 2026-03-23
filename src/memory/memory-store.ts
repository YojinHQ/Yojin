import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BM25Index } from './bm25.js';
import { MemoryEntrySchema } from './types.js';
import type { MemoryAgentRole, MemoryEntry, NewMemoryInput, ReflectionInput } from './types.js';
import { getLogger } from '../logging/index.js';

const log = getLogger().sub('signal-memory-store');

export class SignalMemoryStore {
  private entries = new Map<string, MemoryEntry>();
  private index = new BM25Index();
  private indexedIds: string[] = [];
  private dirReady = false;
  private readonly role: MemoryAgentRole;
  private readonly filePath: string;
  private readonly maxEntries: number;

  constructor(options: { role: MemoryAgentRole; dataDir: string; maxEntries?: number }) {
    this.role = options.role;
    this.filePath = join(options.dataDir, options.role, 'entries.jsonl');
    this.maxEntries = options.maxEntries ?? 1000;
  }

  async initialize(): Promise<void> {
    await this.ensureDir();

    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch {
      return;
    }

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = MemoryEntrySchema.parse(JSON.parse(line));
        this.entries.set(entry.id, entry);
      } catch (err) {
        log.warn('Skipping malformed memory entry', { error: err });
      }
    }

    this.rebuildIndex();
    log.info('Memory store initialized', { role: this.role, entries: this.entries.size });
  }

  async store(input: NewMemoryInput): Promise<string> {
    const entry: MemoryEntry = {
      id: randomUUID(),
      agentRole: this.role,
      tickers: input.tickers,
      situation: input.situation,
      recommendation: input.recommendation,
      confidence: input.confidence,
      createdAt: new Date().toISOString(),
      outcome: null,
      lesson: null,
      actualReturn: null,
      grade: null,
      reflectedAt: null,
    };

    await this.appendEntry(entry);
    this.entries.set(entry.id, entry);
    this.rebuildIndex();
    return entry.id;
  }

  async reflect(
    id: string,
    reflection: ReflectionInput,
  ): Promise<{ success: true } | { success: false; error: string }> {
    const existing = this.entries.get(id);
    if (!existing) return { success: false, error: `Memory entry not found: ${id}` };

    if (existing.reflectedAt !== null) {
      return { success: false, error: `Memory entry already reflected: ${id}` };
    }

    const updated: MemoryEntry = {
      ...existing,
      outcome: reflection.outcome,
      lesson: reflection.lesson,
      actualReturn: reflection.actualReturn,
      grade: reflection.grade,
      reflectedAt: new Date().toISOString(),
    };

    await this.appendEntry(updated);
    this.entries.set(id, updated);
    return { success: true };
  }

  get(id: string): MemoryEntry | undefined {
    return this.entries.get(id);
  }

  async recall(
    situation: string,
    options?: { topN?: number; tickers?: string[] },
  ): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    const topN = options?.topN ?? 3;
    const tickerFilter = options?.tickers;

    if (tickerFilter && tickerFilter.length > 0) {
      const filtered = [...this.entries.values()].filter((e) => e.tickers.some((t) => tickerFilter.includes(t)));
      if (filtered.length === 0) return [];

      const scopedIndex = new BM25Index();
      scopedIndex.build(filtered.map((e) => e.situation));
      const results = scopedIndex.search(situation, topN);
      return results.filter((r) => r.score > 0).map((r) => ({ entry: filtered[r.index], score: r.score }));
    }

    const results = this.index.search(situation, topN);
    return results
      .filter((r) => r.score > 0)
      .map((r) => {
        const entry = this.entries.get(this.indexedIds[r.index]);
        if (!entry) throw new Error(`Index/entry mismatch for id: ${this.indexedIds[r.index]}`);
        return { entry, score: r.score };
      });
  }

  async findUnreflected(options?: { olderThan?: Date; ticker?: string }): Promise<MemoryEntry[]> {
    return [...this.entries.values()].filter((e) => {
      if (e.reflectedAt !== null) return false;
      if (options?.olderThan && new Date(e.createdAt) > options.olderThan) return false;
      if (options?.ticker && !e.tickers.includes(options.ticker)) return false;
      return true;
    });
  }

  async prune(): Promise<number> {
    if (this.entries.size <= this.maxEntries) return 0;

    const excess = this.entries.size - this.maxEntries;
    const all = [...this.entries.values()].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const reflected = all.filter((e) => e.reflectedAt !== null);
    const toRemove = reflected.slice(0, excess);

    if (toRemove.length < excess) {
      const unreflected = all.filter((e) => e.reflectedAt === null);
      toRemove.push(...unreflected.slice(0, excess - toRemove.length));
    }

    for (const entry of toRemove) {
      this.entries.delete(entry.id);
    }

    // Compact the JSONL file so pruned entries don't resurface on restart
    const retained = [...this.entries.values()];
    await writeFile(this.filePath, retained.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');

    this.rebuildIndex();
    return toRemove.length;
  }

  private rebuildIndex(): void {
    this.indexedIds = [...this.entries.keys()];
    const docs = this.indexedIds.map((id) => {
      const entry = this.entries.get(id);
      if (!entry) throw new Error(`Index/entry mismatch for id: ${id}`);
      return entry.situation;
    });
    this.index.build(docs);
  }

  private async appendEntry(entry: MemoryEntry): Promise<void> {
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await mkdir(join(this.filePath, '..'), { recursive: true });
    this.dirReady = true;
  }
}
