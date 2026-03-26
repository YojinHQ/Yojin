import { describe, expect, it, vi } from 'vitest';

import { ApiAdapter } from '../../src/data-sources/adapters/api-adapter.js';
import type { DataSourceConfig, HealthCheckResult } from '../../src/data-sources/types.js';

function createApiConfig(overrides: Partial<DataSourceConfig> = {}): DataSourceConfig {
  return {
    id: 'test-api',
    name: 'Test API',
    capabilities: [{ id: 'search' }],
    enabled: true,
    priority: 5,
    builtin: false,
    config: {
      type: 'api',
      baseUrl: 'https://api.example.com',
      secretRef: 'test-key',
      authHeader: 'Authorization',
      authPrefix: 'Bearer',
      rateLimitPerMinute: 60,
      supportsAsync: false,
      endpointMapping: {},
    },
    ...overrides,
  };
}

describe('ApiAdapter', () => {
  it('initializes with API config', async () => {
    const config = createApiConfig();
    const adapter = new ApiAdapter(config);
    await adapter.initialize(config);

    expect(adapter.id).toBe('test-api');
    expect(adapter.name).toBe('Test API');
    expect(adapter.type).toBe('api');
    expect(adapter.enabled).toBe(true);
    expect(adapter.priority).toBe(5);
  });

  it('rejects non-API config', async () => {
    const config = createApiConfig();
    const adapter = new ApiAdapter(config);

    const cliConfig: DataSourceConfig = {
      ...config,
      config: {
        type: 'cli',
        command: 'curl',
        args: [],
        outputFormat: 'json',
        timeout: 30_000,
        env: {},
      },
    };

    await expect(adapter.initialize(cliConfig)).rejects.toThrow('ApiAdapter requires API config');
  });

  it('throws when vault is locked and secretRef is set', async () => {
    const config = createApiConfig();
    const adapter = new ApiAdapter(config, {
      vault: { isUnlocked: false, get: vi.fn() } as never,
    });
    await adapter.initialize(config);

    await expect(adapter.query({ capability: 'search', params: {}, prompt: 'test' })).rejects.toThrow(
      'Vault is locked',
    );
  });

  it('throws when API key is missing from vault', async () => {
    const config = createApiConfig();
    const mockVault = { isUnlocked: true, get: vi.fn().mockResolvedValue(null) };
    const adapter = new ApiAdapter(config, { vault: mockVault as never });
    await adapter.initialize(config);

    await expect(adapter.query({ capability: 'search', params: {}, prompt: 'test' })).rejects.toThrow(
      'not found in vault',
    );
  });

  it('uses custom health check when provided', async () => {
    const customResult: HealthCheckResult = { healthy: true, latencyMs: 42 };
    const config = createApiConfig();
    const adapter = new ApiAdapter(config, {
      healthCheckFn: vi.fn().mockResolvedValue(customResult),
    });
    await adapter.initialize(config);

    const result = await adapter.healthCheck();
    expect(result).toEqual(customResult);
  });

  it('falls back to HTTP health check when no custom fn', async () => {
    const config = createApiConfig();
    const adapter = new ApiAdapter(config);
    await adapter.initialize(config);

    // Without a real server, the health check will fail — but it shouldn't throw
    const result = await adapter.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeDefined();
  });

  it('shutdown is a no-op', async () => {
    const config = createApiConfig();
    const adapter = new ApiAdapter(config);
    await expect(adapter.shutdown()).resolves.toBeUndefined();
  });
});
