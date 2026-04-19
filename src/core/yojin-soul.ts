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

  if (existsSync(overridePath)) {
    try {
      return await readFile(overridePath, 'utf-8');
    } catch (err) {
      // Override exists but can't be read (bad perms, partial write, transient FS error).
      // Don't leave the agent with only the inline fallback — try the bundled default next.
      logger.warn('Failed to read yojin-soul override, falling back to bundled default', {
        err: String(err),
      });
    }
  }

  if (existsSync(defaultPath)) {
    try {
      return await readFile(defaultPath, 'utf-8');
    } catch (err) {
      logger.warn('Failed to read bundled yojin-soul default, using inline fallback', {
        err: String(err),
      });
    }
  }

  return FALLBACK_SOUL;
}
