import { parseFromMarkdown } from './skill-serializer.js';
import type { SkillStore } from './skill-store.js';
import { fetchStrategiesFromSource } from './strategy-source-fetcher.js';
import type { FetchedStrategy } from './strategy-source-fetcher.js';
import type { StrategySourceStore } from './strategy-source-store.js';
import type { StrategySource } from './strategy-source-types.js';
import { DEFAULT_SOURCE_ID } from './strategy-source-types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('strategy-source-sync');

export interface StrategySyncResult {
  added: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * Sync strategies from pre-fetched markdown into the skill store.
 * Skips strategies whose ID already exists.
 */
export async function syncFromFetched(
  fetched: FetchedStrategy[],
  skillStore: SkillStore,
  source: StrategySource,
): Promise<StrategySyncResult> {
  const result: StrategySyncResult = { added: 0, skipped: 0, failed: 0, errors: [] };
  const isDefault = source.id === DEFAULT_SOURCE_ID;

  for (const { filename, markdown } of fetched) {
    try {
      const skill = parseFromMarkdown(markdown);
      skill.source = isDefault ? 'built-in' : 'community';
      skill.createdBy = source.id;

      if (skillStore.getById(skill.id)) {
        result.skipped++;
        continue;
      }

      skillStore.save(skill);
      result.added++;
    } catch (err) {
      result.failed++;
      result.errors.push(`${filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logger.info(`Sync from ${source.id}: added=${result.added} skipped=${result.skipped} failed=${result.failed}`);
  return result;
}

/**
 * Sync strategies from all provided sources: fetch from GitHub, parse, save new ones.
 */
export async function syncStrategies(
  sources: StrategySource[],
  skillStore: SkillStore,
  sourceStore?: StrategySourceStore,
): Promise<StrategySyncResult> {
  const totalResult: StrategySyncResult = { added: 0, skipped: 0, failed: 0, errors: [] };

  for (const source of sources) {
    const { strategies: fetched, errors: fetchErrors } = await fetchStrategiesFromSource(source);
    totalResult.errors.push(...fetchErrors);

    const result = await syncFromFetched(fetched, skillStore, source);
    totalResult.added += result.added;
    totalResult.skipped += result.skipped;
    totalResult.failed += result.failed;
    totalResult.errors.push(...result.errors);

    if (fetchErrors.length === 0 && result.failed === 0) {
      await sourceStore?.updateLastSynced(source.id);
    }
  }

  return totalResult;
}
