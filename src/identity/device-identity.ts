/**
 * Device identity — auto-generated Ed25519 keypair per installation.
 *
 * On first run: generate keypair → SHA-256 fingerprint → deviceId.
 * Stored in data/identity/device.json (mode 0o600).
 * No login, no account — the device IS the identity.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  createdAt: string;
}

interface StoredIdentity {
  version: 1;
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAt: string;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const IDENTITY_PATH = path.join(DATA_DIR, 'identity', 'device.json');

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function fingerprintPublicKey(publicKeyPem: string): string {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: 'spki', format: 'der' });
  const raw =
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    Buffer.from(spki.buffer, spki.byteOffset, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
      ? Buffer.from(spki.buffer, spki.byteOffset + ED25519_SPKI_PREFIX.length, 32)
      : spki;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generate(): StoredIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    version: 1,
    deviceId: fingerprintPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
    createdAt: new Date().toISOString(),
  };
}

/** Load existing identity or create one on first run. */
export function loadOrCreateDeviceIdentity(): DeviceIdentity {
  try {
    if (fs.existsSync(IDENTITY_PATH)) {
      const raw = fs.readFileSync(IDENTITY_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as StoredIdentity;
      if (parsed?.version === 1 && parsed.deviceId && parsed.publicKeyPem) {
        // Re-derive to validate
        const derived = fingerprintPublicKey(parsed.publicKeyPem);
        return {
          deviceId: derived,
          publicKeyPem: parsed.publicKeyPem,
          createdAt: parsed.createdAt,
        };
      }
    }
  } catch {
    // Fall through to regenerate
  }

  const identity = generate();
  fs.mkdirSync(path.dirname(IDENTITY_PATH), { recursive: true });
  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(IDENTITY_PATH, 0o600);
  } catch {
    // best-effort
  }

  return {
    deviceId: identity.deviceId,
    publicKeyPem: identity.publicKeyPem,
    createdAt: identity.createdAt,
  };
}

/** Sign a payload with the device private key. */
export function signPayload(payload: string): string {
  const raw = fs.readFileSync(IDENTITY_PATH, 'utf-8');
  const { privateKeyPem } = JSON.parse(raw) as StoredIdentity;
  const key = crypto.createPrivateKey(privateKeyPem);
  return crypto.sign(null, Buffer.from(payload, 'utf-8'), key).toString('base64url');
}
