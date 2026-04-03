/**
 * GraphQL resolvers for Skills — trading strategy management.
 */

import type { SkillStore } from '../../../skills/skill-store.js';
import type { SkillCategory } from '../../../skills/types.js';

// ---------------------------------------------------------------------------
// State — wired by composition root
// ---------------------------------------------------------------------------

let skillStore: SkillStore | null = null;

export function setSkillStore(store: SkillStore): void {
  skillStore = store;
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export function resolveSkills(_: unknown, args: { category?: SkillCategory; active?: boolean }): unknown[] {
  if (!skillStore) return [];
  let skills = skillStore.getAll();
  if (args.category) {
    skills = skills.filter((s) => s.category === args.category);
  }
  if (args.active !== undefined) {
    skills = skills.filter((s) => s.active === args.active);
  }
  return skills.map(toGraphQL);
}

export function resolveSkill(_: unknown, args: { id: string }): unknown | null {
  if (!skillStore) return null;
  const skill = skillStore.getById(args.id);
  return skill ? toGraphQL(skill) : null;
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

export function resolveToggleSkill(_: unknown, args: { id: string; active: boolean }): unknown {
  if (!skillStore) throw new Error('Skill store not initialized');
  const updated = skillStore.setActive(args.id, args.active);
  if (!updated) throw new Error(`Skill not found: ${args.id}`);
  return toGraphQL(updated);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toGraphQL(skill: ReturnType<SkillStore['getAll']>[number]): unknown {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    active: skill.active,
    source: skill.source,
    createdBy: skill.createdBy,
    createdAt: skill.createdAt,
    content: skill.content,
    triggers: skill.triggers.map((t) => ({
      type: t.type,
      description: t.description,
      params: t.params ? JSON.stringify(t.params) : null,
    })),
    maxPositionSize: skill.maxPositionSize ?? null,
    tickers: skill.tickers,
  };
}
