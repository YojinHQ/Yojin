/**
 * Vault resolvers — vaultStatus, listVaultSecrets,
 * unlockVault, addVaultSecret, updateVaultSecret, deleteVaultSecret.
 *
 * Module-level state pattern: setVault is called once during server startup
 * to inject the EncryptedVault instance.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { SecretMeta } from '../../../trust/vault/types.js';
import type { EncryptedVault } from '../../../trust/vault/vault.js';

let vault: EncryptedVault | undefined;

/** Optional callback fired when a secret is added or updated. */
let onSecretChanged: ((key: string, value: string) => void) | null = null;

/** Called once during server startup to inject the vault. */
export function setVault(v: EncryptedVault): void {
  vault = v;
}

/** Register a callback to react to secret changes (e.g. Jintel key hot-swap). */
export function setVaultSecretChangedCallback(cb: (key: string, value: string) => void): void {
  onSecretChanged = cb;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VaultStatus {
  isUnlocked: boolean;
  hasPassphrase: boolean;
  secretCount: number;
}

interface VaultResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function vaultStatusQuery(): Promise<VaultStatus> {
  if (!vault) return { isUnlocked: false, hasPassphrase: false, secretCount: 0 };

  const isUnlocked = vault.isUnlocked;
  const hasPassphrase = vault.hasPassphrase;
  let secretCount = 0;
  if (isUnlocked) {
    const keys = await vault.list();
    secretCount = keys.length;
  }

  return { isUnlocked, hasPassphrase, secretCount };
}

export async function listVaultSecretsQuery(): Promise<SecretMeta[]> {
  if (!vault) return [];
  if (!vault.isUnlocked) return [];
  return vault.listWithMeta();
}

// ---------------------------------------------------------------------------
// Brute-force protection — shared across unlock + changePassphrase
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60_000; // 1 minute base lockout

interface LockoutState {
  failedAttempts: number;
  lockoutCount: number;
  lockoutUntil: number;
}

let lockout: LockoutState = { failedAttempts: 0, lockoutCount: 0, lockoutUntil: 0 };

function getLockoutPath(): string | null {
  if (!vault) return null;
  // Store lockout state next to the vault file
  const vaultPath = (vault as unknown as { vaultPath: string }).vaultPath;
  return vaultPath ? `${dirname(vaultPath)}/lockout.json` : null;
}

function loadLockoutState(): void {
  const path = getLockoutPath();
  if (!path || !existsSync(path)) return;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as LockoutState;
    lockout = { failedAttempts: data.failedAttempts, lockoutCount: data.lockoutCount, lockoutUntil: data.lockoutUntil };
  } catch {
    // Corrupted file — start fresh
  }
}

function saveLockoutState(): void {
  const path = getLockoutPath();
  if (!path) return;
  try {
    writeFileSync(path, JSON.stringify(lockout), 'utf8');
  } catch {
    // Best-effort — don't crash if write fails
  }
}

function checkLockout(): VaultResult | null {
  loadLockoutState();
  const now = Date.now();
  if (lockout.lockoutUntil > 0 && now < lockout.lockoutUntil) {
    const remainingSec = Math.ceil((lockout.lockoutUntil - now) / 1000);
    return { success: false, error: `Too many failed attempts. Try again in ${remainingSec}s.` };
  }
  // Lockout expired — reset attempt counter for a fresh window
  if (lockout.lockoutUntil > 0 && now >= lockout.lockoutUntil) {
    lockout.failedAttempts = 0;
    lockout.lockoutUntil = 0;
  }
  return null;
}

function recordFailure(): void {
  lockout.failedAttempts++;
  if (lockout.failedAttempts >= MAX_ATTEMPTS) {
    lockout.lockoutCount++;
    const multiplier = Math.pow(2, lockout.lockoutCount - 1); // 1, 2, 4, 8...
    lockout.lockoutUntil = Date.now() + LOCKOUT_DURATION_MS * multiplier;
    lockout.failedAttempts = 0;
  }
  saveLockoutState();
}

function recordSuccess(): void {
  lockout = { failedAttempts: 0, lockoutCount: 0, lockoutUntil: 0 };
  saveLockoutState();
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

export async function unlockVaultMutation(_parent: unknown, args: { passphrase: string }): Promise<VaultResult> {
  if (!vault) return { success: false, error: 'Vault not configured' };

  const blocked = checkLockout();
  if (blocked) return blocked;

  try {
    await vault.unlock(args.passphrase);
    recordSuccess();
    return { success: true };
  } catch (err) {
    recordFailure();
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function setVaultPassphraseMutation(
  _parent: unknown,
  args: { newPassphrase: string },
): Promise<VaultResult> {
  if (!vault) return { success: false, error: 'Vault not configured' };
  if (!vault.isUnlocked) return { success: false, error: 'Vault is locked' };

  try {
    await vault.setPassphrase(args.newPassphrase);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function changeVaultPassphraseMutation(
  _parent: unknown,
  args: { currentPassphrase: string; newPassphrase: string },
): Promise<VaultResult> {
  if (!vault) return { success: false, error: 'Vault not configured' };
  if (!vault.isUnlocked) return { success: false, error: 'Vault is locked' };

  const blocked = checkLockout();
  if (blocked) return blocked;

  try {
    await vault.changePassphrase(args.currentPassphrase, args.newPassphrase);
    recordSuccess();
    return { success: true };
  } catch (err) {
    recordFailure();
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function addVaultSecretMutation(
  _parent: unknown,
  args: { input: { key: string; value: string } },
): Promise<VaultResult> {
  if (!vault) return { success: false, error: 'Vault not configured' };
  if (!vault.isUnlocked) return { success: false, error: 'Vault is locked' };

  try {
    const exists = await vault.has(args.input.key);
    if (exists) {
      return { success: false, error: `Secret "${args.input.key}" already exists. Use update instead.` };
    }
    await vault.set(args.input.key, args.input.value);
    onSecretChanged?.(args.input.key, args.input.value);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function updateVaultSecretMutation(
  _parent: unknown,
  args: { input: { key: string; value: string } },
): Promise<VaultResult> {
  if (!vault) return { success: false, error: 'Vault not configured' };
  if (!vault.isUnlocked) return { success: false, error: 'Vault is locked' };

  try {
    const exists = await vault.has(args.input.key);
    if (!exists) {
      return { success: false, error: `Secret "${args.input.key}" not found` };
    }
    await vault.set(args.input.key, args.input.value);
    onSecretChanged?.(args.input.key, args.input.value);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function deleteVaultSecretMutation(_parent: unknown, args: { key: string }): Promise<VaultResult> {
  if (!vault) return { success: false, error: 'Vault not configured' };
  if (!vault.isUnlocked) return { success: false, error: 'Vault is locked' };

  try {
    await vault.delete(args.key);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
