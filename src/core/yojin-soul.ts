/**
 * Yojin Soul — default/override loader for the chat agent's voice.
 *
 * Factory default lives at `data/default/yojin-soul.md` (bundled).
 * User override lives at `brain/yojin-soul.md` under the data root (gitignored).
 * Same default/override pattern as PersonaManager, but scoped to the
 * user-facing chat agent rather than the Strategist.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createSafeLogger } from '../logging/logger.js';
import { resolveDefaultsRoot } from '../paths.js';

const logger = createSafeLogger('core/yojin-soul');

const OVERRIDE_SOUL_PATH = 'brain/yojin-soul.md';
const DEFAULT_SOUL_FILE = 'yojin-soul.md';

const FALLBACK_SOUL = 'You are Yojin. Talk like a smart friend who trades for a living — direct, honest, no hype.\n';

export async function loadYojinSoul(dataRoot: string): Promise<string> {
  const overridePath = join(dataRoot, OVERRIDE_SOUL_PATH);
  const defaultPath = join(resolveDefaultsRoot(), DEFAULT_SOUL_FILE);

  try {
    if (existsSync(overridePath)) return await readFile(overridePath, 'utf-8');
    if (existsSync(defaultPath)) return await readFile(defaultPath, 'utf-8');
  } catch (err) {
    logger.warn('Failed to load yojin-soul, falling back to inline default', { err: String(err) });
  }

  return FALLBACK_SOUL;
}
