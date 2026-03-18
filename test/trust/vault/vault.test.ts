import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileAuditLog } from '../../../src/trust/audit/audit-log.js';
import { EncryptedVault } from '../../../src/trust/vault/vault.js';

const PASSPHRASE = 'test-passphrase-for-unit-tests';

describe('EncryptedVault', () => {
  let tempDir: string;
  let auditLog: FileAuditLog;
  let vault: EncryptedVault;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-vault-'));
    auditLog = new FileAuditLog(join(tempDir, 'audit'));
    vault = new EncryptedVault({
      vaultPath: join(tempDir, 'vault.enc.json'),
      auditLog,
    });
    await vault.unlock(PASSPHRASE);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('encrypts and decrypts a secret round-trip', async () => {
    await vault.set('API_KEY', 'sk-ant-api03-secret-value');
    const value = await vault.get('API_KEY');
    expect(value).toBe('sk-ant-api03-secret-value');
  });

  it('stores encrypted values in vault file', async () => {
    await vault.set('MY_SECRET', 'plaintext-value');

    const raw = readFileSync(join(tempDir, 'vault.enc.json'), 'utf-8');
    const data = JSON.parse(raw);

    // Value in file should NOT be plaintext
    expect(data.entries.MY_SECRET.value).not.toBe('plaintext-value');
    expect(data.entries.MY_SECRET.iv).toBeDefined();
    expect(data.entries.MY_SECRET.tag).toBeDefined();
  });

  it('list returns key names only', async () => {
    await vault.set('KEY_A', 'value-a');
    await vault.set('KEY_B', 'value-b');

    const keys = await vault.list();
    expect(keys).toContain('KEY_A');
    expect(keys).toContain('KEY_B');
    expect(keys).toHaveLength(2);
  });

  it('has returns true for existing keys', async () => {
    await vault.set('EXISTS', 'yes');
    expect(await vault.has('EXISTS')).toBe(true);
    expect(await vault.has('NOPE')).toBe(false);
  });

  it('delete removes a secret', async () => {
    await vault.set('TO_DELETE', 'value');
    expect(await vault.has('TO_DELETE')).toBe(true);

    await vault.delete('TO_DELETE');
    expect(await vault.has('TO_DELETE')).toBe(false);
  });

  it('get throws for nonexistent key', async () => {
    await expect(vault.get('NONEXISTENT')).rejects.toThrow('Secret not found');
  });

  it('delete throws for nonexistent key', async () => {
    await expect(vault.delete('NONEXISTENT')).rejects.toThrow('Secret not found');
  });

  it('throws when vault is locked', async () => {
    const lockedVault = new EncryptedVault({
      vaultPath: join(tempDir, 'locked.enc.json'),
      auditLog,
    });
    await expect(lockedVault.get('KEY')).rejects.toThrow('Vault is locked');
  });

  it('wrong passphrase fails on unlock', async () => {
    await vault.set('SENSITIVE', 'top-secret');

    // Create a new vault instance with wrong passphrase — should fail at unlock, not get
    const wrongVault = new EncryptedVault({
      vaultPath: join(tempDir, 'vault.enc.json'),
      auditLog,
    });
    await expect(wrongVault.unlock('wrong-passphrase')).rejects.toThrow('Wrong passphrase');
  });

  it('persists across vault instances', async () => {
    await vault.set('PERSISTENT', 'survives-restart');

    // Create a new vault instance with same passphrase
    const vault2 = new EncryptedVault({
      vaultPath: join(tempDir, 'vault.enc.json'),
      auditLog,
    });
    await vault2.unlock(PASSPHRASE);

    const value = await vault2.get('PERSISTENT');
    expect(value).toBe('survives-restart');
  });

  it('set overwrites existing entries', async () => {
    await vault.set('KEY', 'original');
    await vault.set('KEY', 'updated');

    const value = await vault.get('KEY');
    expect(value).toBe('updated');
  });

  it('vault file is valid JSON', async () => {
    await vault.set('TEST', 'value');

    const raw = readFileSync(join(tempDir, 'vault.enc.json'), 'utf-8');
    const data = JSON.parse(raw);
    expect(data.version).toBe(1);
    expect(data.salt).toBeDefined();
    expect(data.entries).toBeDefined();
  });

  describe('audit logging', () => {
    it('logs secret.access on get', async () => {
      await vault.set('KEY', 'value');
      await vault.get('KEY');

      const events = await auditLog.query({ type: 'secret.access' });
      const getEvents = events.filter((e) => (e.details as Record<string, unknown>).operation === 'get');
      expect(getEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('logs secret.access on set', async () => {
      await vault.set('KEY', 'value');

      const events = await auditLog.query({ type: 'secret.access' });
      const setEvents = events.filter((e) => (e.details as Record<string, unknown>).operation === 'set');
      expect(setEvents).toHaveLength(1);
    });

    it('logs secret.access on list', async () => {
      await vault.list();

      const events = await auditLog.query({ type: 'secret.access' });
      const listEvents = events.filter((e) => (e.details as Record<string, unknown>).operation === 'list');
      expect(listEvents).toHaveLength(1);
    });

    it('logs secret.access on delete', async () => {
      await vault.set('KEY', 'value');
      await vault.delete('KEY');

      const events = await auditLog.query({ type: 'secret.access' });
      const deleteEvents = events.filter((e) => (e.details as Record<string, unknown>).operation === 'delete');
      expect(deleteEvents).toHaveLength(1);
    });
  });
});
