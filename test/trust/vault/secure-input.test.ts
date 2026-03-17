import { describe, expect, it } from 'vitest';

import { createSecretTools } from '../../../src/trust/vault/secure-input.js';
import type { SecretVault } from '../../../src/trust/vault/types.js';

function createMockVault(): SecretVault & { store: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    store,
    async set(key: string, value: string) {
      store[key] = value;
    },
    async get(key: string) {
      if (!(key in store)) throw new Error(`Secret not found: ${key}`);
      return store[key];
    },
    async has(key: string) {
      return key in store;
    },
    async list() {
      return Object.keys(store);
    },
    async delete(key: string) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete store[key];
    },
  };
}

describe('createSecretTools', () => {
  describe('store_credential', () => {
    it('stores value in vault and returns confirmation without the value', async () => {
      const vault = createMockVault();
      const tools = createSecretTools({
        vault,
        readSecret: async () => 'super-secret-api-key-123',
        isTty: () => true,
      });

      const storeTool = tools.find((t) => t.name === 'store_credential')!;
      const result = await storeTool.execute({
        key: 'KEELSON_API_KEY',
        description: 'Keelson API key for enrichment',
      });

      // Value stored in vault
      expect(vault.store['KEELSON_API_KEY']).toBe('super-secret-api-key-123');

      // Tool result contains confirmation but NEVER the value
      expect(result.content).toContain('KEELSON_API_KEY');
      expect(result.content).toContain('stored successfully');
      expect(result.content).not.toContain('super-secret-api-key-123');
      expect(result.isError).toBeUndefined();
    });

    it('returns error when not in TTY mode', async () => {
      const vault = createMockVault();
      const tools = createSecretTools({
        vault,
        isTty: () => false,
      });

      const storeTool = tools.find((t) => t.name === 'store_credential')!;
      const result = await storeTool.execute({
        key: 'API_KEY',
        description: 'Some key',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('no interactive terminal');
      expect(result.content).toContain('yojin secret set API_KEY');
      expect(vault.store['API_KEY']).toBeUndefined();
    });

    it('returns error on empty input', async () => {
      const vault = createMockVault();
      const tools = createSecretTools({
        vault,
        readSecret: async () => '',
        isTty: () => true,
      });

      const storeTool = tools.find((t) => t.name === 'store_credential')!;
      const result = await storeTool.execute({
        key: 'API_KEY',
        description: 'Some key',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('empty value');
      expect(vault.store['API_KEY']).toBeUndefined();
    });

    it('returns error when user cancels', async () => {
      const vault = createMockVault();
      const tools = createSecretTools({
        vault,
        readSecret: async () => {
          throw new Error('Cancelled by user');
        },
        isTty: () => true,
      });

      const storeTool = tools.find((t) => t.name === 'store_credential')!;
      const result = await storeTool.execute({
        key: 'API_KEY',
        description: 'Some key',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Cancelled by user');
    });
  });

  describe('check_credential', () => {
    it('returns exists for stored credential', async () => {
      const vault = createMockVault();
      vault.store['MY_KEY'] = 'secret';

      const tools = createSecretTools({ vault, isTty: () => true });
      const checkTool = tools.find((t) => t.name === 'check_credential')!;
      const result = await checkTool.execute({ key: 'MY_KEY' });

      expect(result.content).toContain('exists');
      // Must NOT contain the value
      expect(result.content).not.toContain('secret');
    });

    it('returns not found for missing credential', async () => {
      const vault = createMockVault();
      const tools = createSecretTools({ vault, isTty: () => true });
      const checkTool = tools.find((t) => t.name === 'check_credential')!;
      const result = await checkTool.execute({ key: 'MISSING' });

      expect(result.content).toContain('not found');
    });
  });

  describe('list_credentials', () => {
    it('lists credential names without values', async () => {
      const vault = createMockVault();
      vault.store['KEY_A'] = 'secret-a';
      vault.store['KEY_B'] = 'secret-b';

      const tools = createSecretTools({ vault, isTty: () => true });
      const listTool = tools.find((t) => t.name === 'list_credentials')!;
      const result = await listTool.execute({});

      expect(result.content).toContain('KEY_A');
      expect(result.content).toContain('KEY_B');
      expect(result.content).not.toContain('secret-a');
      expect(result.content).not.toContain('secret-b');
    });

    it('returns message when no credentials stored', async () => {
      const vault = createMockVault();
      const tools = createSecretTools({ vault, isTty: () => true });
      const listTool = tools.find((t) => t.name === 'list_credentials')!;
      const result = await listTool.execute({});

      expect(result.content).toContain('No credentials stored');
    });
  });

  describe('delete_credential', () => {
    it('deletes existing credential', async () => {
      const vault = createMockVault();
      vault.store['KEY_A'] = 'secret';

      const tools = createSecretTools({ vault, isTty: () => true });
      const deleteTool = tools.find((t) => t.name === 'delete_credential')!;
      const result = await deleteTool.execute({ key: 'KEY_A' });

      expect(result.content).toContain('deleted');
      expect(vault.store['KEY_A']).toBeUndefined();
    });

    it('returns error for missing credential', async () => {
      const vault = createMockVault();
      const tools = createSecretTools({ vault, isTty: () => true });
      const deleteTool = tools.find((t) => t.name === 'delete_credential')!;
      const result = await deleteTool.execute({ key: 'MISSING' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    });
  });

  it('creates exactly 4 tools', () => {
    const vault = createMockVault();
    const tools = createSecretTools({ vault, isTty: () => true });

    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.name).sort()).toEqual([
      'check_credential',
      'delete_credential',
      'list_credentials',
      'store_credential',
    ]);
  });
});
