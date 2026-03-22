/**
 * Device info resolver — exposes the auto-generated device identity.
 * No login, no account — the device IS the identity.
 */

import { loadOrCreateDeviceIdentity } from '../../../identity/device-identity.js';

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
