/**
 * GraphQL resolvers for Strategies — trading strategy management.
 */

import { DataCapabilitySchema } from '../../../strategies/capabilities.js';
import type { DataCapability } from '../../../strategies/capabilities.js';
import { parseFromMarkdown, serializeToMarkdown, slugify } from '../../../strategies/strategy-serializer.js';
import type { StrategyStore } from '../../../strategies/strategy-store.js';
import type { Strategy, StrategyCategory } from '../../../strategies/types.js';

// ---------------------------------------------------------------------------
// State — wired by composition root
// ---------------------------------------------------------------------------

let strategyStore: StrategyStore | null = null;

export function setStrategyStore(store: StrategyStore): void {
  strategyStore = store;
}

// ---------------------------------------------------------------------------
// Capability mapping (domain snake_case ↔ GraphQL SCREAMING_SNAKE_CASE)
// Derived from DataCapabilitySchema to stay in sync automatically.
// ---------------------------------------------------------------------------

const CAPABILITY_TO_GQL: Record<string, string> = Object.fromEntries(
  DataCapabilitySchema.options.map((c) => [c, c.toUpperCase()]),
);

const GQL_TO_CAPABILITY: Record<string, DataCapability> = Object.fromEntries(
  DataCapabilitySchema.options.map((c) => [c.toUpperCase(), c]),
);

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export function resolveStrategies(
  _: unknown,
  args: { category?: StrategyCategory; active?: boolean; style?: string; query?: string },
): unknown[] {
  if (!strategyStore) return [];
  let strategies = strategyStore.getAll();
  if (args.category) {
    strategies = strategies.filter((s) => s.category === args.category);
  }
  if (args.active !== undefined) {
    strategies = strategies.filter((s) => s.active === args.active);
  }
  if (args.style) {
    strategies = strategies.filter((s) => s.style === args.style);
  }
  if (args.query) {
    const q = args.query.toLowerCase();
    strategies = strategies.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q),
    );
  }
  return strategies.map(toGraphQL);
}

export function resolveStrategy(_: unknown, args: { id: string }): unknown | null {
  if (!strategyStore) return null;
  const strategy = strategyStore.getById(args.id);
  return strategy ? toGraphQL(strategy) : null;
}

export function resolveExportStrategy(_: unknown, args: { id: string }): string {
  if (!strategyStore) throw new Error('Strategy store not initialized');
  const strategy = strategyStore.getById(args.id);
  if (!strategy) throw new Error(`Strategy not found: ${args.id}`);
  return serializeToMarkdown(strategy);
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

export function resolveToggleStrategy(_: unknown, args: { id: string; active: boolean }): unknown {
  if (!strategyStore) throw new Error('Strategy store not initialized');
  const updated = strategyStore.setActive(args.id, args.active);
  if (!updated) throw new Error(`Strategy not found: ${args.id}`);
  return toGraphQL(updated);
}

interface StrategyTriggerInput {
  type: string;
  description: string;
  params?: string;
}

interface CreateStrategyInput {
  name: string;
  description: string;
  category: StrategyCategory;
  style: string;
  requires?: string[];
  content: string;
  triggers: StrategyTriggerInput[];
  tickers?: string[];
  maxPositionSize?: number;
  targetAllocation?: number;
}

interface UpdateStrategyInput {
  name?: string;
  description?: string;
  category?: StrategyCategory;
  style?: string;
  requires?: string[];
  content?: string;
  triggers?: StrategyTriggerInput[];
  tickers?: string[];
  maxPositionSize?: number;
  targetAllocation?: number;
}

function mapTriggersFromInput(triggers: StrategyTriggerInput[]): Strategy['triggers'] {
  return triggers.map((t, i) => {
    let params: Record<string, unknown> | undefined;
    if (t.params) {
      try {
        params = JSON.parse(t.params) as Record<string, unknown>;
      } catch {
        throw new Error(`Trigger ${i + 1}: invalid JSON in params`);
      }
    }
    return {
      type: t.type as Strategy['triggers'][number]['type'],
      description: t.description,
      ...(params ? { params } : {}),
    };
  });
}

function mapRequiresFromInput(requires?: string[]): DataCapability[] {
  if (!requires) return [];
  return requires.map((r) => GQL_TO_CAPABILITY[r] ?? (r.toLowerCase() as DataCapability));
}

export function resolveCreateStrategy(_: unknown, args: { input: CreateStrategyInput }): unknown {
  if (!strategyStore) throw new Error('Strategy store not initialized');
  const { input } = args;
  let id = slugify(input.name);
  const existing = strategyStore.getById(id);
  if (existing) {
    id = `${id}-${Date.now()}`;
  }
  const strategy: Strategy = {
    id,
    name: input.name,
    description: input.description,
    category: input.category,
    style: input.style,
    requires: mapRequiresFromInput(input.requires),
    active: false,
    source: 'custom',
    createdBy: 'user',
    createdAt: new Date().toISOString(),
    content: input.content,
    triggers: mapTriggersFromInput(input.triggers),
    tickers: input.tickers ?? [],
    ...(input.maxPositionSize !== undefined ? { maxPositionSize: input.maxPositionSize } : {}),
    ...(input.targetAllocation !== undefined ? { targetAllocation: input.targetAllocation } : {}),
  };
  strategyStore.create(strategy);
  return toGraphQL(strategy);
}

export function resolveUpdateStrategy(_: unknown, args: { id: string; input: UpdateStrategyInput }): unknown {
  if (!strategyStore) throw new Error('Strategy store not initialized');
  const { id, input } = args;
  const fields: Partial<Omit<Strategy, 'id'>> = {};
  if (input.name !== undefined) fields.name = input.name;
  if (input.description !== undefined) fields.description = input.description;
  if (input.category !== undefined) fields.category = input.category;
  if (input.style !== undefined) fields.style = input.style;
  if (input.requires !== undefined) fields.requires = mapRequiresFromInput(input.requires);
  if (input.content !== undefined) fields.content = input.content;
  if (input.triggers !== undefined) fields.triggers = mapTriggersFromInput(input.triggers);
  if (input.tickers !== undefined) fields.tickers = input.tickers;
  if (input.maxPositionSize !== undefined) fields.maxPositionSize = input.maxPositionSize;
  if (input.targetAllocation !== undefined) fields.targetAllocation = input.targetAllocation;
  const updated = strategyStore.update(id, fields);
  return toGraphQL(updated);
}

export function resolveDeleteStrategy(_: unknown, args: { id: string }): boolean {
  if (!strategyStore) throw new Error('Strategy store not initialized');
  const deleted = strategyStore.delete(args.id);
  if (!deleted) throw new Error(`Strategy not found: ${args.id}`);
  return true;
}

export function resolveImportStrategy(_: unknown, args: { markdown: string }): unknown {
  if (!strategyStore) throw new Error('Strategy store not initialized');
  const strategy = parseFromMarkdown(args.markdown);
  if (strategyStore.getById(strategy.id)) {
    strategy.id = `${strategy.id}-${Date.now()}`;
  }
  strategyStore.create(strategy);
  return toGraphQL(strategy);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toGraphQL(strategy: Strategy): unknown {
  return {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    category: strategy.category,
    style: strategy.style,
    requires: strategy.requires.map((r) => CAPABILITY_TO_GQL[r] ?? r.toUpperCase()),
    active: strategy.active,
    source: strategy.source,
    createdBy: strategy.createdBy,
    createdAt: strategy.createdAt,
    content: strategy.content,
    triggers: strategy.triggers.map((t) => ({
      type: t.type,
      description: t.description,
      params: t.params ? JSON.stringify(t.params) : null,
    })),
    maxPositionSize: strategy.maxPositionSize ?? null,
    targetAllocation: strategy.targetAllocation ?? null,
    tickers: strategy.tickers,
  };
}
