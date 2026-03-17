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

import type { SecretVault, VaultFile } from './types.js';
import { VaultFileSchema } from './types.js';
import type { AuditLog } from '../audit/types.js';

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
    this.vaultPath = options.vaultPath ?? 'data/config/vault.enc.json';
    this.auditLog = options.auditLog;
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

  async delete(key: string): Promise<void> {
    const { data } = this.ensureUnlocked();

    if (!(key in data.entries)) {
      throw new Error(`Secret not found: ${key}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete data.entries[key];
    this.save();
    this.logAccess(key, 'delete');
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
