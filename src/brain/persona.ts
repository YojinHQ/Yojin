/**
 * Persona — default/override pattern for the Strategist's personality.
 *
 * Factory default lives at data/default/persona.default.md (git-tracked).
 * User override lives at data/brain/persona.md (gitignored).
 * First run auto-copies default to override. git pull updates defaults
 * without clobbering user customizations.
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { PersonaManager as PersonaManagerInterface } from './types.js';

const DEFAULT_PERSONA_PATH = 'data/default/persona.default.md';
const OVERRIDE_PERSONA_PATH = 'data/brain/persona.md';

export class PersonaManager implements PersonaManagerInterface {
  private readonly defaultPath: string;
  private readonly overridePath: string;

  constructor(dataRoot = '.') {
    this.defaultPath = `${dataRoot}/${DEFAULT_PERSONA_PATH}`;
    this.overridePath = `${dataRoot}/${OVERRIDE_PERSONA_PATH}`;
  }

  async getPersona(): Promise<string> {
    // Try override first
    if (existsSync(this.overridePath)) {
      return readFile(this.overridePath, 'utf-8');
    }

    // Auto-copy default to override on first run
    if (existsSync(this.defaultPath)) {
      await this.ensureOverrideDir();
      await copyFile(this.defaultPath, this.overridePath);
      return readFile(this.overridePath, 'utf-8');
    }

    return '# No persona configured\n\nUsing default behavior.\n';
  }

  async setPersona(content: string): Promise<void> {
    await this.ensureOverrideDir();
    await writeFile(this.overridePath, content, 'utf-8');
  }

  async resetPersona(): Promise<void> {
    if (existsSync(this.overridePath)) {
      await unlink(this.overridePath);
    }
  }

  private async ensureOverrideDir(): Promise<void> {
    const dir = dirname(this.overridePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}

/**
 * Load an agent's system prompt using the default/override pattern.
 *
 * Default: data/default/agents/{agentId}.default.md (git-tracked)
 * Override: data/brain/agents/{agentId}.md (gitignored)
 */
export async function loadAgentPrompt(agentId: string, dataRoot = '.'): Promise<string> {
  const overridePath = `${dataRoot}/data/brain/agents/${agentId}.md`;
  const defaultPath = `${dataRoot}/data/default/agents/${agentId}.default.md`;

  if (existsSync(overridePath)) {
    return readFile(overridePath, 'utf-8');
  }

  if (existsSync(defaultPath)) {
    return readFile(defaultPath, 'utf-8');
  }

  return `You are the ${agentId} agent. No specific system prompt configured.\n`;
}
