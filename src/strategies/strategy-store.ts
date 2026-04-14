/**
 * StrategyStore — file-driven storage for Strategy definitions.
 *
 * Strategies are stored as individual JSON files in data/strategies/.
 * Built-in strategies ship in data/default/strategies/ and are copied on first run.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { StrategySchema, StrategyStyleSchema } from './types.js';
import type { Strategy } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('strategy-store');

export interface StrategyStoreOptions {
  dir: string; // e.g. data/strategies/
}

export class StrategyStore {
  private readonly dir: string;
  private strategies = new Map<string, Strategy>();

  constructor(options: StrategyStoreOptions) {
    this.dir = options.dir;
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  /** Load all strategies from disk into memory. */
  async initialize(): Promise<void> {
    this.strategies.clear();
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = readFileSync(join(this.dir, file), 'utf-8');
        const parsed = JSON.parse(raw);
        const migrated = this.migrateIfNeeded(parsed, file);
        const strategy = StrategySchema.parse(migrated);
        this.strategies.set(strategy.id, strategy);
      } catch (err) {
        logger.warn(`Failed to load strategy from ${file}`, { error: err });
      }
    }
    logger.info(`Loaded ${this.strategies.size} strategies`);
  }

  /**
   * Migrate old { triggers: [...] } format to { triggerGroups: [...] }.
   * Each old trigger becomes its own single-condition group (preserving OR semantics).
   */
  private migrateIfNeeded(raw: Record<string, unknown>, file: string): Record<string, unknown> {
    let changed = false;
    const migrated = { ...raw };

    // Migrate triggers → triggerGroups
    if (!migrated['triggerGroups']) {
      const oldTriggers = migrated['triggers'];
      if (Array.isArray(oldTriggers)) {
        logger.info(`Migrating strategy ${file} from triggers to triggerGroups`);
        migrated['triggerGroups'] = oldTriggers.map((t: unknown) => ({
          label: '',
          conditions: [t],
        }));
        delete migrated['triggers'];
        changed = true;
      }
    }

    // Coerce free-text style to enum value
    const validStyles = StrategyStyleSchema.options as readonly string[];
    if (migrated['style'] !== undefined && !validStyles.includes(migrated['style'] as string)) {
      logger.info(`Coercing unrecognized style "${migrated['style']}" to "general" in ${file}`);
      migrated['style'] = 'general';
      changed = true;
    }

    if (changed) {
      const filePath = join(this.dir, file);
      try {
        writeFileSync(filePath, JSON.stringify(migrated, null, 2), 'utf-8');
      } catch (err) {
        logger.warn(`Failed to persist migration for ${file}`, { error: err });
      }
    }

    return migrated;
  }

  /** Get all strategies. */
  getAll(): Strategy[] {
    return [...this.strategies.values()];
  }

  /** Get only active strategies. */
  getActive(): Strategy[] {
    return [...this.strategies.values()].filter((s) => s.active);
  }

  /** Get a strategy by ID. */
  getById(id: string): Strategy | undefined {
    return this.strategies.get(id);
  }

  /** Save or update a strategy. */
  save(strategy: Strategy): void {
    const validated = StrategySchema.parse(strategy);
    this.strategies.set(validated.id, validated);
    const filePath = join(this.dir, `${validated.id}.json`);
    writeFileSync(filePath, JSON.stringify(validated, null, 2), 'utf-8');
    logger.info(`Saved strategy: ${validated.name}`, { id: validated.id });
  }

  /** Create a new strategy — fails if id already exists. */
  create(strategy: Strategy): void {
    if (this.strategies.has(strategy.id)) {
      throw new Error(`Strategy already exists: ${strategy.id}`);
    }
    this.save(strategy);
  }

  /** Update an existing strategy — fails if id does not exist. */
  update(id: string, fields: Partial<Omit<Strategy, 'id'>>): Strategy {
    const existing = this.strategies.get(id);
    if (!existing) {
      throw new Error(`Strategy not found: ${id}`);
    }
    const updated = { ...existing, ...fields, id };
    this.save(updated);
    return updated;
  }

  /** Toggle a strategy's active state. */
  setActive(id: string, active: boolean): Strategy | undefined {
    const strategy = this.strategies.get(id);
    if (!strategy) return undefined;
    const updated = { ...strategy, active };
    this.save(updated);
    return updated;
  }

  /** Delete a strategy. */
  delete(id: string): boolean {
    const strategy = this.strategies.get(id);
    if (!strategy) return false;
    this.strategies.delete(id);
    const filePath = join(this.dir, `${id}.json`);
    try {
      unlinkSync(filePath);
    } catch {
      // File may not exist on disk
    }
    logger.info(`Deleted strategy: ${strategy.name}`, { id });
    return true;
  }
}
