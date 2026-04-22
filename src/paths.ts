/**
 * Path resolution — single source of truth for Yojin's data directories.
 *
 * Data root: $YOJIN_HOME or ~/.yojin/
 * Factory defaults: resolved from the package install location via import.meta.url
 */

import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, rename } from 'node:fs/promises';
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
  'summaries',
  'actions',
  'alerts',
  'strategies',
  'market-sentiment',
  'snap',
  'supply-chain-maps', // Per-ticker supply-chain graphs built from Jintel (Phase A: raw capture)
  'profiles', // Per-ticker persistent knowledge profiles
  'data', // General-purpose data storage for data source outputs and imports
  'oauth', // OAuth / pairing state (e.g. WhatsApp Baileys auth)
  'oauth/whatsapp',
  'debug', // Debug output (strategy eval trace reports, etc.)
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
 * Resolve the package root directory (where package.json lives).
 * Works from both source (src/paths.ts) and compiled output (dist/src/paths.js).
 * This is the single source of truth — other modules should derive their paths
 * from this helper instead of computing relative paths from their own file location,
 * because the src→dist depth differs (src/x/file.ts is 2 levels, dist/src/x/file.js is 3).
 */
export function resolvePackageRoot(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // When compiled: dist/src/paths.js → need ../../ to reach project root
  // When running source: src/paths.ts → need ../ to reach project root
  const isCompiledOutput = thisDir.split(sep).includes('dist');
  return isCompiledOutput ? resolve(thisDir, '..', '..') : resolve(thisDir, '..');
}

/**
 * Resolve the factory defaults directory (bundled with package).
 * Returns the absolute path to the `data/default/` directory bundled with the package.
 */
export function resolveDefaultsRoot(): string {
  return resolve(resolvePackageRoot(), 'data', 'default');
}

let cachedPackageVersion: string | undefined;
/**
 * Read the package version from package.json. Cached after first call.
 * Centralized here so consumers don't have to compute their own relative path
 * to package.json — source vs compiled depths differ and cause ENOENT in tests.
 */
export function resolvePackageVersion(): string {
  if (cachedPackageVersion) return cachedPackageVersion;
  const pkgPath = resolve(resolvePackageRoot(), 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
  cachedPackageVersion = pkg.version;
  return cachedPackageVersion;
}

/**
 * Ensure the data root directory structure exists.
 * Called once on startup — creates subdirectories if missing.
 */
export async function ensureDataDirs(dataRoot: string): Promise<void> {
  // One-time migration: ~/.yojin/skills/ → ~/.yojin/strategies/
  // Runs before mkdir so the rename sees an empty destination. If the user
  // has both (shouldn't happen), the migration is skipped and the old dir
  // is left in place for manual reconciliation.
  const legacyStrategiesDir = join(dataRoot, 'skills');
  const strategiesDir = join(dataRoot, 'strategies');
  if (existsSync(legacyStrategiesDir) && !existsSync(strategiesDir)) {
    await rename(legacyStrategiesDir, strategiesDir);
  }

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
