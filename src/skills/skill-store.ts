/**
 * SkillStore — file-driven storage for Skill definitions.
 *
 * Skills are stored as individual JSON files in data/skills/.
 * Built-in skills ship in data/default/skills/ and are copied on first run.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SkillSchema } from './types.js';
import type { Skill } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('skill-store');

export interface SkillStoreOptions {
  dir: string; // e.g. data/skills/
}

export class SkillStore {
  private readonly dir: string;
  private skills = new Map<string, Skill>();

  constructor(options: SkillStoreOptions) {
    this.dir = options.dir;
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  /** Load all skills from disk into memory. */
  async initialize(): Promise<void> {
    this.skills.clear();
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = readFileSync(join(this.dir, file), 'utf-8');
        const skill = SkillSchema.parse(JSON.parse(raw));
        this.skills.set(skill.id, skill);
      } catch (err) {
        logger.warn(`Failed to load skill from ${file}`, { error: err });
      }
    }
    logger.info(`Loaded ${this.skills.size} skills`);
  }

  /** Get all skills. */
  getAll(): Skill[] {
    return [...this.skills.values()];
  }

  /** Get only active skills. */
  getActive(): Skill[] {
    return [...this.skills.values()].filter((s) => s.active);
  }

  /** Get a skill by ID. */
  getById(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /** Save or update a skill. */
  save(skill: Skill): void {
    const validated = SkillSchema.parse(skill);
    this.skills.set(validated.id, validated);
    const filePath = join(this.dir, `${validated.id}.json`);
    writeFileSync(filePath, JSON.stringify(validated, null, 2), 'utf-8');
    logger.info(`Saved skill: ${validated.name}`, { id: validated.id });
  }

  /** Toggle a skill's active state. */
  setActive(id: string, active: boolean): Skill | undefined {
    const skill = this.skills.get(id);
    if (!skill) return undefined;
    const updated = { ...skill, active };
    this.save(updated);
    return updated;
  }

  /** Delete a skill. */
  delete(id: string): boolean {
    const skill = this.skills.get(id);
    if (!skill) return false;
    this.skills.delete(id);
    const filePath = join(this.dir, `${id}.json`);
    try {
      unlinkSync(filePath);
    } catch {
      // File may not exist on disk
    }
    logger.info(`Deleted skill: ${skill.name}`, { id });
    return true;
  }
}
