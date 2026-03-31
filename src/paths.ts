/**
 * Path resolution — single source of truth for Yojin's data directories.
 *
 * Data root: $YOJIN_HOME or ~/.yojin/
 * Factory defaults: resolved from the package install location via import.meta.url
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the credential vault directory.
 * Stored separately from app data so "Clear App Data" never wipes credentials.
 * $YOJIN_VAULT_DIR if set, otherwise ~/.yojin-vault/
 */
export function resolveVaultDir(): string {
  const envDir = process.env.YOJIN_VAULT_DIR;
  if (envDir) return resolve(envDir);
  return join(homedir(), '.yojin-vault');
}

/** Subdirectories created inside the data root on first run. */
export const DATA_SUBDIRS = [
  'config',
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
  'insights/micro',
  'identity',
  'logs',
  'watchlist',
  'actions',
  'skills',
  'snap',
  'profiles', // Per-ticker persistent knowledge profiles
  'data', // General-purpose data storage for data source outputs and imports
  'oauth', // OAuth / pairing state (e.g. WhatsApp Baileys auth)
  'oauth/whatsapp',
] as const;

/**
 * Subdirectories that are wiped by "Clear App Data".
 * Preserved: config, audit (append-only security log), logs (active logger),
 * identity (device keypair — changing it breaks signed payloads),
 * oauth (channel auth state — WhatsApp Signal Protocol keys are device-linked credentials).
 */
const PRESERVED_SUBDIRS = new Set(['config', 'audit', 'logs', 'identity', 'oauth']);
export const CLEARABLE_SUBDIRS = DATA_SUBDIRS.filter(
  (d) => !PRESERVED_SUBDIRS.has(d) && ![...PRESERVED_SUBDIRS].some((p) => d.startsWith(p + '/')),
);

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
  // Vault directory is separate from app data
  const vaultDir = resolveVaultDir();
  await mkdir(vaultDir, { recursive: true });

  // One-time migration: copy vault from old location (~/.yojin/vault/) to new (~/.yojin-vault/)
  const oldVaultPath = join(dataRoot, 'vault', 'secrets.json');
  const newVaultPath = join(vaultDir, 'secrets.json');
  if (existsSync(oldVaultPath) && !existsSync(newVaultPath)) {
    await copyFile(oldVaultPath, newVaultPath);
  }
}
