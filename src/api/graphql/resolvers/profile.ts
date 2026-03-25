/**
 * Device info resolver — exposes the auto-generated device identity.
 * No login, no account — the device IS the identity.
 */

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { loadOrCreateDeviceIdentity } from '../../../identity/device-identity.js';
import { createSubsystemLogger } from '../../../logging/logger.js';
import { CLEARABLE_SUBDIRS, resolveDataRoot } from '../../../paths.js';

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

/** Wipe all runtime data except config, audit, logs, and identity. Returns true on success. */
export async function clearAppDataMutation(): Promise<boolean> {
  const dataRoot = resolveDataRoot();
  const errors: string[] = [];

  for (const sub of CLEARABLE_SUBDIRS) {
    const dir = join(dataRoot, sub);
    try {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
    } catch (err) {
      errors.push(`${sub}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Reset cached identity so it regenerates on next access
  cachedIdentity = null;

  if (errors.length > 0) {
    logger.warn('App data clear completed with errors', { dataRoot, errors });
    return false;
  }

  logger.info('App data cleared', { dataRoot });
  return true;
}
