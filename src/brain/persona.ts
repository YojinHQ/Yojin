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

  isFirstRun(): boolean {
    return !existsSync(this.overridePath);
  }

  async getPersona(): Promise<string> {
    try {
      // Try override first
      if (existsSync(this.overridePath)) {
        return await readFile(this.overridePath, 'utf-8');
      }

      // Auto-copy default to override on first run
      if (existsSync(this.defaultPath)) {
        const content = await readFile(this.defaultPath, 'utf-8');
        await this.ensureOverrideDir();
        await copyFile(this.defaultPath, this.overridePath).catch(() => undefined);
        return content;
      }
    } catch {
      // fall through to default
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
  if (!/^[a-z0-9-]+$/.test(agentId)) {
    throw new Error(`Invalid agentId: "${agentId}"`);
  }

  const overridePath = `${dataRoot}/data/brain/agents/${agentId}.md`;
  const defaultPath = `${dataRoot}/data/default/agents/${agentId}.default.md`;

  try {
    if (existsSync(overridePath)) return await readFile(overridePath, 'utf-8');
    if (existsSync(defaultPath)) return await readFile(defaultPath, 'utf-8');
  } catch {
    // fall through on TOCTOU race or permission error
  }

  return `You are the ${agentId} agent. No specific system prompt configured.\n`;
}
