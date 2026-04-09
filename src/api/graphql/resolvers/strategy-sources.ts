/**
 * GraphQL resolvers for Strategy Sources — external GitHub repos containing strategies.
 */

import { createSubsystemLogger } from '../../../logging/logger.js';
import type { SkillStore } from '../../../skills/skill-store.js';
import { fetchStrategiesFromSource } from '../../../skills/strategy-source-fetcher.js';
import type { StrategySourceStore } from '../../../skills/strategy-source-store.js';
import { syncFromFetched, syncStrategies } from '../../../skills/strategy-source-sync.js';
import type { SyncResult } from '../../../skills/strategy-source-sync.js';
import { parseGitHubUrl } from '../../../skills/strategy-source-types.js';
import type { StrategySource } from '../../../skills/strategy-source-types.js';

const logger = createSubsystemLogger('strategy-source-resolvers');

// ---------------------------------------------------------------------------
// GraphQL return shapes
// ---------------------------------------------------------------------------

interface GqlStrategySource {
  id: string;
  owner: string;
  repo: string;
  path: string;
  ref: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  label: string | null;
}

interface GqlSyncResult {
  added: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// State — wired by composition root
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toGraphQL(source: StrategySource): GqlStrategySource {
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

function syncResultToGraphQL(result: SyncResult): GqlSyncResult {
  return {
    added: result.added,
    skipped: result.skipped,
    failed: result.failed,
    errors: result.errors,
  };
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export function resolveStrategySources(): GqlStrategySource[] {
  if (!strategySourceStore) return [];
  return strategySourceStore.getAll().map(toGraphQL);
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

export async function resolveAddStrategySource(
  _: unknown,
  args: { input: { url: string } },
): Promise<GqlStrategySource> {
  const { sourceStore, skillStore: skills } = requireStores();
  const parsed = parseGitHubUrl(args.input.url);
  const source = sourceStore.add({
    owner: parsed.owner,
    repo: parsed.repo,
    path: parsed.path,
    ref: parsed.ref,
    enabled: true,
    label: `${parsed.owner}/${parsed.repo}`,
  });

  // Immediately sync strategies from the new source
  try {
    const { strategies } = await fetchStrategiesFromSource(source);
    await syncFromFetched(strategies, skills, source);
    sourceStore.updateLastSynced(source.id);
  } catch (err) {
    logger.warn('Initial sync failed for new source', { sourceId: source.id, error: err });
  }

  return toGraphQL(sourceStore.getById(source.id) ?? source);
}

export function resolveRemoveStrategySource(_: unknown, args: { id: string }): boolean {
  const { sourceStore } = requireStores();
  sourceStore.remove(args.id);
  return true;
}

export function resolveToggleStrategySource(_: unknown, args: { id: string; enabled: boolean }): GqlStrategySource {
  const { sourceStore } = requireStores();
  const updated = sourceStore.setEnabled(args.id, args.enabled);
  return toGraphQL(updated);
}

export async function resolveSyncStrategies(): Promise<GqlSyncResult> {
  const { sourceStore, skillStore: skills } = requireStores();
  const enabled = sourceStore.getEnabled();
  const result = await syncStrategies(enabled, skills, sourceStore);
  return syncResultToGraphQL(result);
}

export async function resolveSyncStrategySource(_: unknown, args: { id: string }): Promise<GqlSyncResult> {
  const { sourceStore, skillStore: skills } = requireStores();
  const source = sourceStore.getById(args.id);
  if (!source) throw new Error(`Strategy source not found: ${args.id}`);

  const { strategies } = await fetchStrategiesFromSource(source);
  const result = await syncFromFetched(strategies, skills, source);
  sourceStore.updateLastSynced(source.id);
  return syncResultToGraphQL(result);
}
