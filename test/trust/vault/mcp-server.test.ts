import { describe, expect, it } from 'vitest';

import type { AuditEventInput, AuditLog } from '../../../src/trust/audit/types.js';
import { SecretProxy } from '../../../src/trust/vault/mcp-server.js';
import type { SecretVault } from '../../../src/trust/vault/types.js';

/** Minimal mock vault that stores secrets in-memory. */
function createMockVault(secrets: Record<string, string>): SecretVault {
  return {
    async set(key: string, value: string) {
      secrets[key] = value;
    },
    async get(key: string) {
      if (!(key in secrets)) throw new Error(`Secret not found: ${key}`);
      return secrets[key];
    },
    async has(key: string) {
      return key in secrets;
    },
    async list() {
      return Object.keys(secrets);
    },
    async delete(key: string) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete secrets[key];
    },
  };
}

/** Mock audit log that captures appended events. */
function createMockAuditLog(): AuditLog & { events: AuditEventInput[] } {
  const events: AuditEventInput[] = [];
  return {
    events,
    append(event: AuditEventInput) {
      events.push(event);
    },
    async query() {
      return [];
    },
  };
}

/** Mock fetch that returns the provided body and captures the request. */
function createMockFetch(responseBody: string, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const mockFn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(responseBody, { status });
  };
  return { mockFn: mockFn as unknown as typeof fetch, calls };
}

describe('SecretProxy', () => {
  const TEST_SECRET = 'sk-test-super-secret-token-12345';

  it('injects credential into request headers', async () => {
    const vault = createMockVault({ API_KEY: TEST_SECRET });
    const audit = createMockAuditLog();
    const { mockFn, calls } = createMockFetch('{"ok":true}');

    const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);
    await proxy.authenticatedFetch('API_KEY', 'https://api.example.com/data');

    expect(calls).toHaveLength(1);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TEST_SECRET}`);
  });

  it('NEVER returns raw credential in response', async () => {
    const vault = createMockVault({ API_KEY: TEST_SECRET });
    const audit = createMockAuditLog();
    // Even if the API response accidentally includes the credential
    const { mockFn } = createMockFetch(`{"token":"${TEST_SECRET}"}`);

    const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);
    const result = await proxy.authenticatedFetch('API_KEY', 'https://api.example.com/data');

    // The raw secret must NOT appear in the response body
    expect(result.body).not.toContain(TEST_SECRET);
    expect(result.status).toBe(200);
  });

  it('returns clean response body for normal responses', async () => {
    const vault = createMockVault({ API_KEY: 'my-key' });
    const audit = createMockAuditLog();
    const { mockFn } = createMockFetch('{"data":"hello world"}');

    const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);
    const result = await proxy.authenticatedFetch('API_KEY', 'https://api.example.com/data');

    expect(result.body).toBe('{"data":"hello world"}');
    expect(result.scrubbed).toBe(false);
    expect(result.status).toBe(200);
  });

  it('scrubs AWS access keys from response', async () => {
    const vault = createMockVault({ KEY: 'val' });
    const audit = createMockAuditLog();
    const { mockFn } = createMockFetch('{"key":"AKIAIOSFODNN7EXAMPLE"}');

    const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);
    const result = await proxy.authenticatedFetch('KEY', 'https://api.example.com');

    expect(result.body).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.scrubbed).toBe(true);
  });

  it('scrubs JWTs from response', async () => {
    const vault = createMockVault({ KEY: 'val' });
    const audit = createMockAuditLog();
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const { mockFn } = createMockFetch(`{"token":"${jwt}"}`);

    const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);
    const result = await proxy.authenticatedFetch('KEY', 'https://api.example.com');

    expect(result.body).not.toContain(jwt);
    expect(result.scrubbed).toBe(true);
  });

  it('scrubs GitHub tokens from response', async () => {
    const vault = createMockVault({ KEY: 'val' });
    const audit = createMockAuditLog();
    const ghToken = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const { mockFn } = createMockFetch(`{"token":"${ghToken}"}`);

    const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);
    const result = await proxy.authenticatedFetch('KEY', 'https://api.example.com');

    expect(result.body).not.toContain(ghToken);
    expect(result.scrubbed).toBe(true);
  });

  it('uses custom header name and prefix', async () => {
    const vault = createMockVault({ KEY: 'my-api-key' });
    const audit = createMockAuditLog();
    const { mockFn, calls } = createMockFetch('ok');

    const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);
    await proxy.authenticatedFetch('KEY', 'https://api.example.com', {
      headerName: 'X-Api-Key',
      prefix: '',
    });

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('my-api-key');
    // No Authorization header should be set
    expect(headers['Authorization']).toBeUndefined();
  });

  it('passes request body and method', async () => {
    const vault = createMockVault({ KEY: 'val' });
    const audit = createMockAuditLog();
    const { mockFn, calls } = createMockFetch('created', 201);

    const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);
    const result = await proxy.authenticatedFetch('KEY', 'https://api.example.com/items', {
      method: 'POST',
      body: '{"name":"test"}',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe('{"name":"test"}');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(result.status).toBe(201);
  });

  it('logs secret.proxy_fetch audit event for every fetch', async () => {
    const vault = createMockVault({ API_KEY: 'val' });
    const audit = createMockAuditLog();
    const { mockFn } = createMockFetch('ok');

    const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);
    await proxy.authenticatedFetch('API_KEY', 'https://api.example.com/data', {
      method: 'POST',
    });

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0].type).toBe('secret.proxy_fetch');
    expect(audit.events[0].details).toEqual({
      key: 'API_KEY',
      url: 'https://api.example.com/data',
      method: 'POST',
    });
  });

  it('throws when credential key not found', async () => {
    const vault = createMockVault({});
    const audit = createMockAuditLog();
    const { mockFn } = createMockFetch('ok');

    const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);
    await expect(proxy.authenticatedFetch('MISSING_KEY', 'https://api.example.com')).rejects.toThrow(
      'Secret not found: MISSING_KEY',
    );
  });

  it('hasCredential checks vault without exposing values', async () => {
    const vault = createMockVault({ API_KEY: 'val' });
    const audit = createMockAuditLog();
    const proxy = new SecretProxy(vault, audit, { allowedDomains: [] });

    expect(await proxy.hasCredential('API_KEY')).toBe(true);
    expect(await proxy.hasCredential('MISSING')).toBe(false);
  });

  it('listCredentials returns names only, never values', async () => {
    const vault = createMockVault({ API_KEY: 'secret1', DB_PASS: 'secret2' });
    const audit = createMockAuditLog();
    const proxy = new SecretProxy(vault, audit, { allowedDomains: [] });

    const names = await proxy.listCredentials();
    expect(names).toEqual(['API_KEY', 'DB_PASS']);
    // Verify no values leaked
    expect(JSON.stringify(names)).not.toContain('secret1');
    expect(JSON.stringify(names)).not.toContain('secret2');
  });

  it('merges custom headers with injected auth header', async () => {
    const vault = createMockVault({ KEY: 'val' });
    const audit = createMockAuditLog();
    const { mockFn, calls } = createMockFetch('ok');

    const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);
    await proxy.authenticatedFetch('KEY', 'https://api.example.com', {
      headers: { Accept: 'application/json', 'X-Custom': 'value' },
    });

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Accept']).toBe('application/json');
    expect(headers['X-Custom']).toBe('value');
    expect(headers['Authorization']).toBe('Bearer val');
  });

  it('returns HTTP error status without leaking credentials', async () => {
    const vault = createMockVault({ KEY: 'my-secret-key' });
    const audit = createMockAuditLog();
    const { mockFn } = createMockFetch('{"error":"unauthorized"}', 401);

    const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);
    const result = await proxy.authenticatedFetch('KEY', 'https://api.example.com');

    expect(result.status).toBe(401);
    expect(result.body).toBe('{"error":"unauthorized"}');
    expect(result.body).not.toContain('my-secret-key');
  });

  describe('domain allowlist', () => {
    it('blocks credentials to domains not in the allowlist', async () => {
      const vault = createMockVault({ KEY: 'super-secret' });
      const audit = createMockAuditLog();
      const { mockFn, calls } = createMockFetch('ok');

      const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);

      await expect(proxy.authenticatedFetch('KEY', 'https://evil.com/steal')).rejects.toThrow(
        "SecretProxy: credential 'KEY' cannot be sent to 'evil.com' — domain not in allowlist",
      );
      // Credential was never retrieved — fetch was never called
      expect(calls).toHaveLength(0);
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0].type).toBe('secret.proxy_blocked');
      expect(audit.events[0].details).toMatchObject({
        reason: expect.stringContaining('evil.com'),
      });
    });

    it('blocks all requests when allowedDomains is empty', async () => {
      const vault = createMockVault({ KEY: 'val' });
      const audit = createMockAuditLog();
      const { mockFn } = createMockFetch('ok');

      const proxy = new SecretProxy(vault, audit, { allowedDomains: [] }, mockFn);

      await expect(proxy.authenticatedFetch('KEY', 'https://api.example.com')).rejects.toThrow(
        'domain not in allowlist',
      );
    });

    it('allows requests to approved domains', async () => {
      const vault = createMockVault({ KEY: 'val' });
      const audit = createMockAuditLog();
      const { mockFn } = createMockFetch('{"ok":true}');

      const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.binance.com', 'api.coinbase.com'] }, mockFn);

      const result = await proxy.authenticatedFetch('KEY', 'https://api.binance.com/v3/account');
      expect(result.status).toBe(200);
    });

    it('rejects invalid URLs', async () => {
      const vault = createMockVault({ KEY: 'val' });
      const audit = createMockAuditLog();

      const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] });

      await expect(proxy.authenticatedFetch('KEY', 'not-a-url')).rejects.toThrow('SecretProxy: invalid URL');
    });

    it('blocks plaintext HTTP — credentials require HTTPS', async () => {
      const vault = createMockVault({ KEY: 'super-secret' });
      const audit = createMockAuditLog();
      const { mockFn, calls } = createMockFetch('ok');

      const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);

      await expect(proxy.authenticatedFetch('KEY', 'http://api.example.com/data')).rejects.toThrow('HTTPS required');
      expect(calls).toHaveLength(0);
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0].type).toBe('secret.proxy_blocked');
      expect(audit.events[0].details).toMatchObject({
        reason: expect.stringContaining('HTTPS'),
      });
    });

    it('allows HTTPS to approved domains', async () => {
      const vault = createMockVault({ KEY: 'val' });
      const audit = createMockAuditLog();
      const { mockFn } = createMockFetch('{"ok":true}');

      const proxy = new SecretProxy(vault, audit, { allowedDomains: ['api.example.com'] }, mockFn);

      const result = await proxy.authenticatedFetch('KEY', 'https://api.example.com/data');
      expect(result.status).toBe(200);
    });
  });
});
