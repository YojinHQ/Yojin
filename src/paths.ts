/**
 * Path resolution — single source of truth for Yojin's data directories.
 *
 * Data root: $YOJIN_HOME or ~/.yojin/
 * Factory defaults: resolved from the package install location via import.meta.url
 */

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Subdirectories created inside the data root on first run. */
const DATA_SUBDIRS = [
  'config',
  'vault',
  'brain',
  'sessions',
  'snapshots',
  'audit',
  'event-log',
  'cache',
  'news-archive',
  'cron',
  'acp',
  'signals',
  'memory',
  'insights',
] as const;

/**
 * Resolve the runtime data root directory.
 * 1. $YOJIN_HOME if set
 * 2. ~/.yojin/ otherwise
 */
export function resolveDataRoot(): string {
  const envHome = process.env.YOJIN_HOME;
  if (envHome) {
    return resolve(envHome);
  }
  return join(homedir(), '.yojin');
}

/**
 * Resolve the factory defaults directory (bundled with package).
 * Uses import.meta.url to find the package install location.
 * Returns the absolute path to the `data/default/` directory bundled with the package.
 */
export function resolveDefaultsRoot(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // When compiled: dist/src/paths.js → need ../../ to reach project root
  // When running source: src/paths.ts → need ../ to reach project root
  const isCompiledOutput = thisDir.split(sep).includes('dist');
  const projectRoot = isCompiledOutput ? resolve(thisDir, '..', '..') : resolve(thisDir, '..');
  return resolve(projectRoot, 'data', 'default');
}

/**
 * Ensure the data root directory structure exists.
 * Called once on startup — creates subdirectories if missing.
 */
export async function ensureDataDirs(dataRoot: string): Promise<void> {
  for (const sub of DATA_SUBDIRS) {
    await mkdir(join(dataRoot, sub), { recursive: true });
  }
}
