import { describe, expect, it } from 'vitest';

import { CliAdapter } from '../../src/data-sources/adapters/cli-adapter.js';
import type { DataSourceConfig } from '../../src/data-sources/types.js';

function createCliConfig(overrides: Partial<DataSourceConfig> = {}): DataSourceConfig {
  return {
    id: 'test-cli',
    name: 'Test CLI',
    capabilities: [{ id: 'news' }],
    enabled: true,
    priority: 10,
    builtin: false,
    config: {
      type: 'cli',
      command: 'echo',
      args: ['hello'],
      outputFormat: 'json',
      timeout: 5_000,
      env: {},
    },
    ...overrides,
  };
}

describe('CliAdapter', () => {
  it('initializes with CLI config', async () => {
    const config = createCliConfig();
    const adapter = new CliAdapter(config);
    await adapter.initialize(config);

    expect(adapter.id).toBe('test-cli');
    expect(adapter.name).toBe('Test CLI');
    expect(adapter.type).toBe('cli');
    expect(adapter.enabled).toBe(true);
    expect(adapter.priority).toBe(10);
  });

  it('rejects non-CLI config', async () => {
    const config = createCliConfig();
    const adapter = new CliAdapter(config);

    const apiConfig: DataSourceConfig = {
      ...config,
      config: {
        type: 'api',
        baseUrl: 'https://example.com',
        authHeader: 'Authorization',
        authPrefix: 'Bearer',
        rateLimitPerMinute: 60,
        supportsAsync: false,
        endpointMapping: {},
      },
    };

    await expect(adapter.initialize(apiConfig)).rejects.toThrow('CliAdapter requires CLI config');
  });

  it('health check passes for installed command', async () => {
    const config = createCliConfig();
    const adapter = new CliAdapter(config);
    await adapter.initialize(config);

    const result = await adapter.healthCheck();
    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('health check fails for missing command', async () => {
    const config = createCliConfig({
      config: {
        type: 'cli',
        command: 'nonexistent-binary-xyz',
        args: [],
        outputFormat: 'json',
        timeout: 5_000,
        env: {},
      },
    });
    const adapter = new CliAdapter(config);
    await adapter.initialize(config);

    const result = await adapter.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('not installed');
  });

  it('health check fails when no command configured', async () => {
    const config = createCliConfig({
      config: {
        type: 'cli',
        command: '',
        args: [],
        outputFormat: 'json',
        timeout: 5_000,
        env: {},
      },
    });
    const adapter = new CliAdapter(config);
    await adapter.initialize(config);

    const result = await adapter.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('No command configured');
  });

  it('query executes command and returns result', async () => {
    const config = createCliConfig({
      config: {
        type: 'cli',
        command: 'echo',
        args: [],
        outputFormat: 'json',
        timeout: 5_000,
        env: {},
      },
    });
    const adapter = new CliAdapter(config);
    await adapter.initialize(config);

    const result = await adapter.query({
      capability: 'news',
      url: 'https://example.com/feed.xml',
      params: {},
    });

    expect(result.sourceId).toBe('test-cli');
    expect(result.capability).toBe('news');
    expect(result.metadata.cached).toBe(false);
  });

  it('shutdown is a no-op', async () => {
    const config = createCliConfig();
    const adapter = new CliAdapter(config);
    await expect(adapter.shutdown()).resolves.toBeUndefined();
  });
});
