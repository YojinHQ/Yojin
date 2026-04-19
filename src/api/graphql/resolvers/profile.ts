/**
 * Device info resolver — exposes the auto-generated device identity.
 * No login, no account — the device IS the identity.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadOrCreateDeviceIdentity } from '../../../identity/device-identity.js';
import { createSubsystemLogger } from '../../../logging/logger.js';
import { CLEARABLE_SUBDIRS, resolveDataRoot } from '../../../paths.js';

// Files preserved across clearAppData even though they live inside a clearable subdir.
// yojin-soul.md is the chat agent's user-edited voice — wiping it would make users
// re-author their agent's personality after every reset.
const PRESERVED_FILES = ['brain/yojin-soul.md'] as const;

const logger = createSubsystemLogger('profile');

interface DeviceInfo {
  deviceId: string;
  shortId: string;
  createdAt: string;
}

let cachedIdentity: DeviceInfo | null = null;

export function deviceInfoResolver(): DeviceInfo {
  if (!cachedIdentity) {
    const identity = loadOrCreateDeviceIdentity();
    cachedIdentity = {
      deviceId: identity.deviceId,
      shortId: identity.deviceId.slice(0, 8),
      createdAt: identity.createdAt,
    };
  }
  return cachedIdentity;
}

// Callbacks invoked after data wipe to reset in-memory caches (archive dirCreated, ingestor hashes, etc.)
const postClearHooks: Array<() => void> = [];

/** Register a callback to reset in-memory state after clearAppData. */
export function onAppDataCleared(hook: () => void): void {
  if (!postClearHooks.includes(hook)) {
    postClearHooks.push(hook);
  }
}

/** Wipe all runtime data except config, audit, logs, and identity. Returns true on success. */
export async function clearAppDataMutation(): Promise<boolean> {
  const dataRoot = resolveDataRoot();
  const errors: string[] = [];

  // Snapshot preserved files before the wipe so we can restore them afterwards.
  const preserved = new Map<string, Buffer>();
  for (const rel of PRESERVED_FILES) {
    const abs = join(dataRoot, rel);
    if (existsSync(abs)) {
      try {
        preserved.set(rel, await readFile(abs));
      } catch (err) {
        logger.warn('Failed to snapshot preserved file before clear', {
          file: rel,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  for (const sub of CLEARABLE_SUBDIRS) {
    const dir = join(dataRoot, sub);
    try {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
    } catch (err) {
      errors.push(`${sub}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const [rel, contents] of preserved) {
    const abs = join(dataRoot, rel);
    try {
      await mkdir(join(abs, '..'), { recursive: true });
      await writeFile(abs, contents);
    } catch (err) {
      errors.push(`restore ${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Reset cached identity so it regenerates on next access
  cachedIdentity = null;

  // Reset in-memory caches so stale dirCreated flags / hash maps don't cause ENOENT
  for (const hook of postClearHooks) {
    try {
      hook();
    } catch (err) {
      logger.warn('Post-clear hook failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (errors.length > 0) {
    logger.warn('App data clear completed with errors', { dataRoot, errors });
    return false;
  }

  logger.info('App data cleared', { dataRoot });
  return true;
}
