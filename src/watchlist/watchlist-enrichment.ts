import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { EnrichmentCacheEntrySchema } from './types.js';
import type { EnrichmentCacheEntry } from './types.js';
import type { WatchlistStore } from './watchlist-store.js';
import type { JintelClient } from '../jintel/client.js';
import type { EnrichmentField } from '../jintel/types.js';
import { getLogger } from '../logging/index.js';

const log = getLogger().sub('watchlist-enrichment');

const ENRICHMENT_FIELDS: EnrichmentField[] = ['market', 'news', 'risk'];
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

export class WatchlistEnrichment {
  private readonly cache = new Map<string, EnrichmentCacheEntry>();
  private readonly cachePath: string;
  private readonly store: WatchlistStore;
  private jintelClient?: JintelClient;
  private readonly ttlSeconds: number;

  constructor(options: { store: WatchlistStore; jintelClient?: JintelClient; dataDir: string; ttlSeconds?: number }) {
    this.store = options.store;
    this.jintelClient = options.jintelClient;
    this.cachePath = join(options.dataDir, 'watchlist', 'enrichment-cache.jsonl');
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  /** Update the Jintel client (e.g. after hot-swap on key validation). */
  setJintelClient(client: JintelClient): void {
    this.jintelClient = client;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true });

    let raw: string;
    try {
      raw = await readFile(this.cachePath, 'utf-8');
    } catch {
      return; // No cache file yet
    }

    const lines = raw.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        const entry = EnrichmentCacheEntrySchema.parse(parsed);
        this.cache.set(entry.symbol.toUpperCase(), entry);
      } catch (err) {
        log.warn('Skipping invalid enrichment cache entry', { line, error: String(err) });
      }
    }
  }

  async resolveEntity(symbol: string): Promise<string | undefined> {
    if (!this.jintelClient) return undefined;

    const key = symbol.toUpperCase();
    const entry = this.store.list().find((e) => e.symbol === key);
    if (!entry) return undefined;

    // Try symbol first
    const bySymbol = await this.jintelClient.searchEntities(key, { limit: 1 });
    if (bySymbol.success && bySymbol.data.length > 0) {
      const entityId = bySymbol.data[0].id;
      await this.store.updateEntry(key, { jintelEntityId: entityId });
      return entityId;
    }

    // Fallback to name
    const byName = await this.jintelClient.searchEntities(entry.name, { limit: 1 });
    if (byName.success && byName.data.length > 0) {
      const entityId = byName.data[0].id;
      await this.store.updateEntry(key, { jintelEntityId: entityId });
      return entityId;
    }

    log.warn('Could not resolve Jintel entity', { symbol: key, name: entry.name });
    return undefined;
  }

  async enrichSymbol(symbol: string): Promise<EnrichmentCacheEntry | null> {
    if (!this.jintelClient) return null;

    const key = symbol.toUpperCase();
    const result = await this.jintelClient.enrichEntity(key, ENRICHMENT_FIELDS);
    if (!result.success) {
      log.warn('Enrichment failed', { symbol: key, error: result.error });
      return this.cache.get(key) ?? null;
    }

    const entity = result.data;
    const cacheEntry: EnrichmentCacheEntry = {
      symbol: key,
      enrichedAt: new Date().toISOString(),
      quote: entity.market?.quote ?? null,
      news: (entity.news ?? []).slice(0, 3),
      riskScore: entity.risk?.overallScore ?? null,
    };

    this.cache.set(key, cacheEntry);
    await this.flushCache();
    return cacheEntry;
  }

  async getEnriched(symbol: string): Promise<EnrichmentCacheEntry | null> {
    if (!this.jintelClient) return null;

    const key = symbol.toUpperCase();

    const entry = this.store.list().find((e) => e.symbol === key);
    if (entry && !entry.jintelEntityId) {
      await this.resolveEntity(key);
    }

    const cached = this.cache.get(key);
    if (cached && !this.isStale(cached)) {
      return cached;
    }

    return this.enrichSymbol(key);
  }

  getCached(symbol: string): EnrichmentCacheEntry | null {
    return this.cache.get(symbol.toUpperCase()) ?? null;
  }

  async removeCache(symbol: string): Promise<void> {
    const key = symbol.toUpperCase();
    this.cache.delete(key);
    await this.flushCache();
  }

  private isStale(entry: EnrichmentCacheEntry): boolean {
    const enrichedAt = new Date(entry.enrichedAt).getTime();
    const now = Date.now();
    return now - enrichedAt >= this.ttlSeconds * 1000;
  }

  private async flushCache(): Promise<void> {
    const lines = Array.from(this.cache.values())
      .map((e) => JSON.stringify(e))
      .join('\n');
    await writeFile(this.cachePath, lines ? `${lines}\n` : '', 'utf-8');
  }
}
