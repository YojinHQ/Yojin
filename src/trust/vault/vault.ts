/**
 * EncryptedVault — AES-256-GCM encrypted credential vault.
 *
 * Uses a single JSON file with per-entry encryption. Key names are
 * plaintext (not secrets themselves), values are individually encrypted.
 * Master key derived from passphrase via PBKDF2 (600k iterations).
 */

import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import type { SecretMeta, SecretVault, VaultFile } from './types.js';
import { VaultFileSchema } from './types.js';
import { createSubsystemLogger } from '../../logging/logger.js';
import { resolveVaultDir } from '../../paths.js';
import type { AuditLog } from '../audit/types.js';

const logger = createSubsystemLogger('vault');

const pbkdf2Async = promisify(pbkdf2);

const ALGORITHM = 'aes-256-gcm';
const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96-bit IV per NIST SP 800-38D for AES-GCM
const SALT_LENGTH = 32;
const CANARY_PLAINTEXT = 'yojin-vault-v1';

export interface VaultOptions {
  vaultPath?: string;
  auditLog: AuditLog;
}

export class EncryptedVault implements SecretVault {
  private readonly vaultPath: string;
  private readonly auditLog: AuditLog;
  private derivedKey: Buffer | null = null;
  private vaultData: VaultFile | null = null;

  constructor(options: VaultOptions) {
    this.vaultPath = options.vaultPath ?? `${resolveVaultDir()}/secrets.json`;
    this.auditLog = options.auditLog;
  }

  /** Whether the vault has been unlocked in this session. */
  get isUnlocked(): boolean {
    return this.derivedKey !== null;
  }

  /** Whether the user has set a custom passphrase (vs. default empty passphrase). */
  get hasPassphrase(): boolean {
    if (this.vaultData) return this.vaultData.passphraseSet === true;
    // Vault not yet unlocked — check file on disk
    try {
      const data = this.loadOrCreateVault();
      return data.passphraseSet === true;
    } catch {
      return false;
    }
  }

  /**
   * Try to auto-unlock with an empty passphrase.
   * Returns true if successful (fresh vault or vault using default passphrase).
   * Returns false if the vault has a user-set passphrase — caller must use unlock().
   */
  async tryAutoUnlock(): Promise<boolean> {
    const data = this.loadOrCreateVault();

    // If user has set a passphrase, don't auto-unlock
    if (data.passphraseSet) {
      logger.debug('Auto-unlock skipped — vault has custom passphrase');
      return false;
    }

    // Try empty passphrase
    try {
      await this.unlock('');
      logger.info('Vault auto-unlocked with default passphrase');
      return true;
    } catch {
      // Vault exists with a non-empty passphrase (legacy vault without passphraseSet flag)
      logger.debug('Auto-unlock failed — legacy vault with passphrase');
      return false;
    }
  }

  /** Derive encryption key from passphrase. Must be called before any operation. */
  async unlock(passphrase: string): Promise<void> {
    const data = this.loadOrCreateVault();
    const key = await pbkdf2Async(
      passphrase,
      Buffer.from(data.salt, 'base64'),
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      'sha512',
    );

    // Verify passphrase against canary if vault has one
    if (data.canary) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(data.canary.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(data.canary.tag, 'base64'));
        let decrypted = decipher.update(data.canary.value, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        if (decrypted !== CANARY_PLAINTEXT) {
          throw new Error('Wrong passphrase');
        }
      } catch {
        throw new Error('Wrong passphrase — cannot unlock vault');
      }
    }

    this.derivedKey = key;
    this.vaultData = data;
    logger.info('Vault unlocked', { entryCount: Object.keys(data.entries).length });

    // Write canary if vault doesn't have one yet (first unlock of legacy vault)
    if (!data.canary) {
      this.writeCanary();
    }
  }

  async set(key: string, value: string): Promise<void> {
    const { key: derivedKey, data } = this.ensureUnlocked();

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, derivedKey, iv);

    let encrypted = cipher.update(value, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const tag = cipher.getAuthTag();

    const now = new Date().toISOString();
    const existing = data.entries[key];

    data.entries[key] = {
      value: encrypted,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.save();
    this.logAccess(key, 'set');
    logger.info('Secret stored', { key });
  }

  async get(key: string): Promise<string> {
    const { key: derivedKey, data } = this.ensureUnlocked();

    const entry = data.entries[key];
    if (!entry) {
      throw new Error(`Secret not found: ${key}`);
    }

    const decipher = createDecipheriv(ALGORITHM, derivedKey, Buffer.from(entry.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));

    let decrypted = decipher.update(entry.value, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    this.logAccess(key, 'get');
    return decrypted;
  }

  async has(key: string): Promise<boolean> {
    const { data } = this.ensureUnlocked();
    return key in data.entries;
  }

  async list(): Promise<string[]> {
    const { data } = this.ensureUnlocked();
    this.logAccess('*', 'list');
    return Object.keys(data.entries);
  }

  async listWithMeta(): Promise<SecretMeta[]> {
    const { data } = this.ensureUnlocked();
    this.logAccess('*', 'list');
    return Object.entries(data.entries).map(([key, entry]) => ({
      key,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
  }

  async delete(key: string): Promise<void> {
    const { data } = this.ensureUnlocked();

    if (!(key in data.entries)) {
      throw new Error(`Secret not found: ${key}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete data.entries[key];
    this.save();
    this.logAccess(key, 'delete');
    logger.info('Secret deleted', { key });
  }

  /**
   * Set a passphrase on a vault that currently uses the default (empty) passphrase.
   * Re-encrypts all entries with the new passphrase.
   */
  async setPassphrase(newPassphrase: string): Promise<void> {
    if (!newPassphrase) throw new Error('Passphrase cannot be empty');
    const { data } = this.ensureUnlocked();
    if (data.passphraseSet) throw new Error('Vault already has a passphrase. Use changePassphrase instead.');

    await this.reEncrypt(newPassphrase);
    this.auditLog.append({ type: 'secret.access', details: { key: '*', operation: 'set-passphrase' as 'set' } });
    logger.info('Vault passphrase set');
  }

  /**
   * Change the vault passphrase. Requires the current passphrase for verification.
   * Pass empty string for newPassphrase to remove the passphrase.
   */
  async changePassphrase(currentPassphrase: string, newPassphrase: string): Promise<void> {
    // Verify current passphrase by deriving key and checking canary
    const data = this.loadOrCreateVault();
    const currentKey = await pbkdf2Async(
      currentPassphrase,
      Buffer.from(data.salt, 'base64'),
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      'sha512',
    );

    if (data.canary) {
      try {
        const decipher = createDecipheriv(ALGORITHM, currentKey, Buffer.from(data.canary.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(data.canary.tag, 'base64'));
        let decrypted = decipher.update(data.canary.value, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        if (decrypted !== CANARY_PLAINTEXT) throw new Error('Wrong passphrase');
      } catch {
        throw new Error('Current passphrase is incorrect');
      }
    }

    await this.reEncrypt(newPassphrase);
    this.auditLog.append({ type: 'secret.access', details: { key: '*', operation: 'change-passphrase' as 'set' } });
    logger.info('Vault passphrase changed');
  }

  /**
   * Re-encrypt all entries with a new passphrase. Generates new salt, key, and canary.
   */
  private async reEncrypt(newPassphrase: string): Promise<void> {
    const { key: oldKey, data } = this.ensureUnlocked();

    // Decrypt all values with old key
    const plainEntries: Array<{ key: string; value: string; createdAt: string; updatedAt: string }> = [];
    for (const [entryKey, entry] of Object.entries(data.entries)) {
      const decipher = createDecipheriv(ALGORITHM, oldKey, Buffer.from(entry.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      let decrypted = decipher.update(entry.value, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      plainEntries.push({ key: entryKey, value: decrypted, createdAt: entry.createdAt, updatedAt: entry.updatedAt });
    }

    // New salt + derive new key
    const newSalt = randomBytes(SALT_LENGTH);
    const newKey = await pbkdf2Async(newPassphrase, newSalt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');

    // Re-encrypt all entries
    data.salt = newSalt.toString('base64');
    data.entries = {};
    data.passphraseSet = newPassphrase.length > 0;

    this.derivedKey = newKey;

    for (const { key: entryKey, value, createdAt, updatedAt } of plainEntries) {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, newKey, iv);
      let encrypted = cipher.update(value, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      const tag = cipher.getAuthTag();

      data.entries[entryKey] = {
        value: encrypted,
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        createdAt,
        updatedAt,
      };
    }

    // Write new canary
    data.canary = undefined;
    this.writeCanary();
  }

  private ensureUnlocked(): { key: Buffer; data: VaultFile } {
    if (!this.derivedKey || !this.vaultData) {
      throw new Error('Vault is locked. Call unlock(passphrase) first.');
    }
    return { key: this.derivedKey, data: this.vaultData };
  }

  /** Write canary value — only called from unlock() after key is derived. */
  private writeCanary(): void {
    const { key: derivedKey, data } = this.ensureUnlocked();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
    let encrypted = cipher.update(CANARY_PLAINTEXT, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const tag = cipher.getAuthTag();

    data.canary = {
      value: encrypted,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };
    this.save();
  }

  private loadOrCreateVault(): VaultFile {
    if (existsSync(this.vaultPath)) {
      const raw = readFileSync(this.vaultPath, 'utf-8');
      return VaultFileSchema.parse(JSON.parse(raw));
    }

    // Create new vault
    logger.info('Creating new vault');
    const salt = randomBytes(SALT_LENGTH);
    const data: VaultFile = {
      version: 1,
      salt: salt.toString('base64'),
      entries: {},
    };

    this.ensureDir();
    writeFileSync(this.vaultPath, JSON.stringify(data, null, 2), 'utf-8');
    return data;
  }

  private save(): void {
    this.ensureDir();
    writeFileSync(this.vaultPath, JSON.stringify(this.vaultData, null, 2), 'utf-8');
  }

  private ensureDir(): void {
    const dir = dirname(this.vaultPath);
    mkdirSync(dir, { recursive: true });
  }

  private logAccess(key: string, operation: 'get' | 'set' | 'delete' | 'list'): void {
    this.auditLog.append({
      type: 'secret.access',
      details: { key, operation },
    });
  }
}
