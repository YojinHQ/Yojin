import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

  async initialize(): Promise<void> {
    this.sources.clear();

    try {
      const raw = await readFile(this.configPath, 'utf-8');
      const parsed = StrategySourceArraySchema.parse(JSON.parse(raw));
      for (const source of parsed) {
        this.sources.set(source.id, source);
      }
    } catch {
      await this.seedDefault();
    }

    logger.debug(`Loaded ${this.sources.size} strategy sources`);
  }

  getAll(): StrategySource[] {
    return [...this.sources.values()];
  }

  getEnabled(): StrategySource[] {
    return [...this.sources.values()].filter((s) => s.enabled);
  }

  getById(id: string): StrategySource | undefined {
    return this.sources.get(id);
  }

  async add(input: Omit<StrategySource, 'id'>): Promise<StrategySource> {
    const id = `${input.owner}/${input.repo}`;
    if (this.sources.has(id)) {
      throw new Error(`Strategy source already exists: ${id}`);
    }
    const source = StrategySourceSchema.parse({ ...input, id });
    this.sources.set(id, source);
    await this.persist();
    logger.info(`Added strategy source: ${id}`);
    return source;
  }

  async remove(id: string): Promise<void> {
    if (id === DEFAULT_SOURCE_ID) {
      throw new Error('Cannot remove the default strategy source. Disable it instead.');
    }
    if (!this.sources.has(id)) {
      throw new Error(`Strategy source not found: ${id}`);
    }
    this.sources.delete(id);
    await this.persist();
    logger.info(`Removed strategy source: ${id}`);
  }

  async setEnabled(id: string, enabled: boolean): Promise<StrategySource> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`Strategy source not found: ${id}`);
    }
    const updated = { ...source, enabled };
    this.sources.set(id, updated);
    await this.persist();
    logger.info(`Strategy source ${id} ${enabled ? 'enabled' : 'disabled'}`);
    return updated;
  }

  async updateLastSynced(id: string): Promise<StrategySource> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`Strategy source not found: ${id}`);
    }
    const updated = { ...source, lastSyncedAt: new Date().toISOString() };
    this.sources.set(id, updated);
    await this.persist();
    return updated;
  }

  private async seedDefault(): Promise<void> {
    this.sources.set(DEFAULT_STRATEGY_SOURCE.id, DEFAULT_STRATEGY_SOURCE);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const data = [...this.sources.values()];
    await writeFile(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
