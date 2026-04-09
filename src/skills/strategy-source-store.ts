/**
 * StrategySourceStore — JSON file store for external strategy source configurations.
 *
 * Stores the list of GitHub repos that supply trading strategy definitions.
 * Persists as a single JSON array file at the given configPath.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';

import { DEFAULT_SOURCE_ID, DEFAULT_STRATEGY_SOURCE, StrategySourceSchema } from './strategy-source-types.js';
import type { StrategySource } from './strategy-source-types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('strategy-source-store');

const StrategySourceArraySchema = z.array(StrategySourceSchema);

export class StrategySourceStore {
  private readonly configPath: string;
  private sources = new Map<string, StrategySource>();

  constructor(configPath: string) {
    this.configPath = configPath;
  }

  /** Load sources from disk, or seed the default source if the file doesn't exist. */
  async initialize(): Promise<void> {
    this.sources.clear();

    if (existsSync(this.configPath)) {
      try {
        const raw = readFileSync(this.configPath, 'utf-8');
        const parsed = StrategySourceArraySchema.parse(JSON.parse(raw));
        for (const source of parsed) {
          this.sources.set(source.id, source);
        }
      } catch (err) {
        logger.warn('Failed to load strategy sources, seeding defaults', { error: err });
        this.seedDefault();
      }
    } else {
      this.seedDefault();
    }

    logger.info(`Loaded ${this.sources.size} strategy sources`);
  }

  /** Get all strategy sources. */
  getAll(): StrategySource[] {
    return [...this.sources.values()];
  }

  /** Get only enabled strategy sources. */
  getEnabled(): StrategySource[] {
    return [...this.sources.values()].filter((s) => s.enabled);
  }

  /** Get a strategy source by ID. */
  getById(id: string): StrategySource | undefined {
    return this.sources.get(id);
  }

  /** Add a new strategy source. Derives id from owner/repo. Throws on duplicate. */
  add(input: Omit<StrategySource, 'id'>): StrategySource {
    const id = `${input.owner}/${input.repo}`;
    if (this.sources.has(id)) {
      throw new Error(`Strategy source already exists: ${id}`);
    }
    const source = StrategySourceSchema.parse({ ...input, id });
    this.sources.set(id, source);
    this.persist();
    logger.info(`Added strategy source: ${id}`);
    return source;
  }

  /** Remove a strategy source by ID. Cannot remove the default source. */
  remove(id: string): void {
    if (id === DEFAULT_SOURCE_ID) {
      throw new Error('Cannot remove the default strategy source. Disable it instead.');
    }
    if (!this.sources.has(id)) {
      throw new Error(`Strategy source not found: ${id}`);
    }
    this.sources.delete(id);
    this.persist();
    logger.info(`Removed strategy source: ${id}`);
  }

  /** Toggle the enabled state of a strategy source. */
  setEnabled(id: string, enabled: boolean): StrategySource {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`Strategy source not found: ${id}`);
    }
    const updated = { ...source, enabled };
    this.sources.set(id, updated);
    this.persist();
    logger.info(`Strategy source ${id} ${enabled ? 'enabled' : 'disabled'}`);
    return updated;
  }

  /** Update the lastSyncedAt timestamp to now. */
  updateLastSynced(id: string): StrategySource {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`Strategy source not found: ${id}`);
    }
    const updated = { ...source, lastSyncedAt: new Date().toISOString() };
    this.sources.set(id, updated);
    this.persist();
    return updated;
  }

  private seedDefault(): void {
    this.sources.set(DEFAULT_STRATEGY_SOURCE.id, DEFAULT_STRATEGY_SOURCE);
    this.persist();
  }

  private persist(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data = [...this.sources.values()];
    writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
