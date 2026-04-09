import { createSubsystemLogger } from '../../../logging/logger.js';
import type { SkillStore } from '../../../skills/skill-store.js';
import { fetchStrategiesFromSource } from '../../../skills/strategy-source-fetcher.js';
import type { StrategySourceStore } from '../../../skills/strategy-source-store.js';
import { syncFromFetched, syncStrategies } from '../../../skills/strategy-source-sync.js';
import type { StrategySyncResult } from '../../../skills/strategy-source-sync.js';
import { parseGitHubUrl } from '../../../skills/strategy-source-types.js';
import type { StrategySource } from '../../../skills/strategy-source-types.js';

const logger = createSubsystemLogger('strategy-source-resolvers');

let strategySourceStore: StrategySourceStore | null = null;
let skillStore: SkillStore | null = null;

export function setStrategySourceStore(store: StrategySourceStore): void {
  strategySourceStore = store;
}

export function setSkillStoreForSources(store: SkillStore): void {
  skillStore = store;
}

function requireStores(): { sourceStore: StrategySourceStore; skillStore: SkillStore } {
  if (!strategySourceStore) throw new Error('Strategy source store not initialized');
  if (!skillStore) throw new Error('Skill store not initialized');
  return { sourceStore: strategySourceStore, skillStore };
}

function toGraphQL(source: StrategySource) {
  return {
    id: source.id,
    owner: source.owner,
    repo: source.repo,
    path: source.path,
    ref: source.ref,
    enabled: source.enabled,
    lastSyncedAt: source.lastSyncedAt ?? null,
    label: source.label ?? null,
  };
}

export function resolveStrategySources() {
  if (!strategySourceStore) return [];
  return strategySourceStore.getAll().map(toGraphQL);
}

export async function resolveAddStrategySource(_: unknown, args: { input: { url: string } }) {
  const { sourceStore, skillStore: skills } = requireStores();
  const parsed = parseGitHubUrl(args.input.url);
  const source = await sourceStore.add({
    owner: parsed.owner,
    repo: parsed.repo,
    path: parsed.path,
    ref: parsed.ref,
    enabled: true,
    label: `${parsed.owner}/${parsed.repo}`,
  });

  try {
    const { strategies } = await fetchStrategiesFromSource(source);
    await syncFromFetched(strategies, skills, source);
    await sourceStore.updateLastSynced(source.id);
  } catch (err) {
    logger.warn('Initial sync failed for new source', { sourceId: source.id, error: err });
  }

  return toGraphQL(sourceStore.getById(source.id) ?? source);
}

export async function resolveRemoveStrategySource(_: unknown, args: { id: string }): Promise<boolean> {
  const { sourceStore } = requireStores();
  await sourceStore.remove(args.id);
  return true;
}

export async function resolveToggleStrategySource(_: unknown, args: { id: string; enabled: boolean }) {
  const { sourceStore } = requireStores();
  const updated = await sourceStore.setEnabled(args.id, args.enabled);
  return toGraphQL(updated);
}

export async function resolveSyncStrategies(): Promise<StrategySyncResult> {
  const { sourceStore, skillStore: skills } = requireStores();
  const enabled = sourceStore.getEnabled();
  return syncStrategies(enabled, skills, sourceStore);
}

export async function resolveSyncStrategySource(_: unknown, args: { id: string }): Promise<StrategySyncResult> {
  const { sourceStore, skillStore: skills } = requireStores();
  const source = sourceStore.getById(args.id);
  if (!source) throw new Error(`Strategy source not found: ${args.id}`);

  const { strategies, errors: fetchErrors } = await fetchStrategiesFromSource(source);
  const result = await syncFromFetched(strategies, skills, source);
  if (fetchErrors.length === 0 && result.failed === 0) {
    await sourceStore.updateLastSynced(source.id);
  }
  return { ...result, errors: [...fetchErrors, ...result.errors] };
}
