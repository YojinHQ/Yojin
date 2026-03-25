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

/** Wipe all runtime data except config. Returns true on success. */
export async function clearAppDataMutation(): Promise<boolean> {
  const dataRoot = resolveDataRoot();

  for (const sub of CLEARABLE_SUBDIRS) {
    const dir = join(dataRoot, sub);
    try {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
    } catch {
      // best-effort — dir may not exist
    }
  }

  // Reset cached identity so it regenerates on next access
  cachedIdentity = null;

  logger.info('App data cleared', { dataRoot });
  return true;
}
