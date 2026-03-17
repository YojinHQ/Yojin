import { describe, expect, it, vi } from 'vitest';

import { DataSourceRegistry } from '../../src/data-sources/registry.js';
import type { DataResult, DataSourceConfig, DataSourcePlugin } from '../../src/data-sources/types.js';
import { DataSourceConfigArraySchema, DataSourceConfigSchema } from '../../src/data-sources/types.js';

// ---------------------------------------------------------------------------
// Helpers — mock data source plugins
// ---------------------------------------------------------------------------

function mockSource(overrides: Partial<DataSourcePlugin> = {}): DataSourcePlugin {
  return {
    id: 'test-source',
    name: 'Test Source',
    type: 'api',
    capabilities: [{ id: 'equity-fundamentals' }],
    enabled: true,
    priority: 10,
    initialize: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({
      sourceId: 'test-source',
      capability: 'equity-fundamentals',
      data: { price: 150 },
      metadata: { fetchedAt: new Date().toISOString(), latencyMs: 42, cached: false },
    } satisfies DataResult),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 10 }),
    shutdown: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('DataSourceRegistry — registration', () => {
  it('registers and retrieves a source', () => {
    const registry = new DataSourceRegistry();
    const source = mockSource();
    registry.register(source);

    expect(registry.getSource('test-source')).toBe(source);
    expect(registry.getSources()).toHaveLength(1);
  });

  it('throws on duplicate registration', () => {
    const registry = new DataSourceRegistry();
    registry.register(mockSource());

    expect(() => registry.register(mockSource())).toThrow('already registered');
  });

  it('unregisters a source', () => {
    const registry = new DataSourceRegistry();
    registry.register(mockSource());

    expect(registry.unregister('test-source')).toBe(true);
    expect(registry.getSource('test-source')).toBeUndefined();
    expect(registry.getSources()).toHaveLength(0);
  });

  it('unregister returns false for unknown id', () => {
    const registry = new DataSourceRegistry();
    expect(registry.unregister('nonexistent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Capability resolution
// ---------------------------------------------------------------------------

describe('DataSourceRegistry — capability resolution', () => {
  it('finds sources by capability', () => {
    const registry = new DataSourceRegistry();
    registry.register(mockSource({ id: 'a', capabilities: [{ id: 'news' }] }));
    registry.register(mockSource({ id: 'b', capabilities: [{ id: 'equity-fundamentals' }] }));
    registry.register(mockSource({ id: 'c', capabilities: [{ id: 'news' }, { id: 'sentiment' }] }));

    const newsSources = registry.getByCapability('news');
    expect(newsSources.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('sorts by priority (ascending)', () => {
    const registry = new DataSourceRegistry();
    registry.register(mockSource({ id: 'low', priority: 20, capabilities: [{ id: 'news' }] }));
    registry.register(mockSource({ id: 'high', priority: 1, capabilities: [{ id: 'news' }] }));
    registry.register(mockSource({ id: 'mid', priority: 10, capabilities: [{ id: 'news' }] }));

    const sources = registry.getByCapability('news');
    expect(sources.map((s) => s.id)).toEqual(['high', 'mid', 'low']);
  });

  it('excludes disabled sources', () => {
    const registry = new DataSourceRegistry();
    registry.register(mockSource({ id: 'enabled', enabled: true, capabilities: [{ id: 'news' }] }));
    registry.register(mockSource({ id: 'disabled', enabled: false, capabilities: [{ id: 'news' }] }));

    const sources = registry.getByCapability('news');
    expect(sources.map((s) => s.id)).toEqual(['enabled']);
  });

  it('returns empty array for unknown capability', () => {
    const registry = new DataSourceRegistry();
    registry.register(mockSource());

    expect(registry.getByCapability('unknown')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Synchronous query with fallback
// ---------------------------------------------------------------------------

describe('DataSourceRegistry — query', () => {
  it('returns result from highest-priority source', async () => {
    const registry = new DataSourceRegistry();
    registry.register(
      mockSource({
        id: 'primary',
        priority: 1,
        capabilities: [{ id: 'news' }],
        query: vi.fn().mockResolvedValue({
          sourceId: 'primary',
          capability: 'news',
          data: { headline: 'from primary' },
          metadata: { fetchedAt: new Date().toISOString(), latencyMs: 10, cached: false },
        }),
      }),
    );
    registry.register(
      mockSource({
        id: 'secondary',
        priority: 10,
        capabilities: [{ id: 'news' }],
      }),
    );

    const result = await registry.query({ capability: 'news', params: {} });
    expect(result.sourceId).toBe('primary');
  });

  it('falls back to next source on failure', async () => {
    const registry = new DataSourceRegistry();
    registry.register(
      mockSource({
        id: 'failing',
        priority: 1,
        capabilities: [{ id: 'news' }],
        query: vi.fn().mockRejectedValue(new Error('API down')),
      }),
    );
    registry.register(
      mockSource({
        id: 'backup',
        priority: 10,
        capabilities: [{ id: 'news' }],
        query: vi.fn().mockResolvedValue({
          sourceId: 'backup',
          capability: 'news',
          data: { headline: 'from backup' },
          metadata: { fetchedAt: new Date().toISOString(), latencyMs: 10, cached: false },
        }),
      }),
    );

    const result = await registry.query({ capability: 'news', params: {} });
    expect(result.sourceId).toBe('backup');
  });

  it('throws when no source provides the capability', async () => {
    const registry = new DataSourceRegistry();
    registry.register(mockSource());

    await expect(registry.query({ capability: 'unknown', params: {} })).rejects.toThrow(
      'No data source provides capability "unknown"',
    );
  });

  it('throws with all errors when every source fails', async () => {
    const registry = new DataSourceRegistry();
    registry.register(
      mockSource({
        id: 'a',
        capabilities: [{ id: 'news' }],
        query: vi.fn().mockRejectedValue(new Error('timeout')),
      }),
    );
    registry.register(
      mockSource({
        id: 'b',
        capabilities: [{ id: 'news' }],
        query: vi.fn().mockRejectedValue(new Error('rate limited')),
      }),
    );

    await expect(registry.query({ capability: 'news', params: {} })).rejects.toThrow(
      /All data sources failed.*a: timeout.*b: rate limited/,
    );
  });
});

// ---------------------------------------------------------------------------
// Async job execution
// ---------------------------------------------------------------------------

describe('DataSourceRegistry — async jobs', () => {
  it('starts a job on the highest-priority async-capable source', async () => {
    const registry = new DataSourceRegistry();
    registry.register(
      mockSource({
        id: 'async-source',
        priority: 1,
        capabilities: [{ id: 'web-crawl' }],
        startJob: vi.fn().mockResolvedValue({ jobId: 'job-123', sourceId: 'async-source' }),
      }),
    );

    const handle = await registry.startJob({ capability: 'web-crawl', params: {} });
    expect(handle.jobId).toBe('job-123');
    expect(handle.sourceId).toBe('async-source');
  });

  it('skips sources without startJob', async () => {
    const registry = new DataSourceRegistry();
    // sync-only source (no startJob)
    registry.register(
      mockSource({
        id: 'sync-only',
        priority: 1,
        capabilities: [{ id: 'web-crawl' }],
      }),
    );
    // async-capable source
    registry.register(
      mockSource({
        id: 'async-source',
        priority: 10,
        capabilities: [{ id: 'web-crawl' }],
        startJob: vi.fn().mockResolvedValue({ jobId: 'job-456', sourceId: 'async-source' }),
      }),
    );

    const handle = await registry.startJob({ capability: 'web-crawl', params: {} });
    expect(handle.sourceId).toBe('async-source');
  });

  it('throws when no async source is available', async () => {
    const registry = new DataSourceRegistry();
    registry.register(mockSource({ id: 'sync-only', capabilities: [{ id: 'web-crawl' }] }));

    await expect(registry.startJob({ capability: 'web-crawl', params: {} })).rejects.toThrow(
      'No async-capable data source',
    );
  });

  it('polls job status on the owning source', async () => {
    const registry = new DataSourceRegistry();
    registry.register(
      mockSource({
        id: 'crawler',
        getJobStatus: vi.fn().mockResolvedValue({ state: 'running', progress: 0.5 }),
      }),
    );

    const status = await registry.getJobStatus('crawler', 'job-789');
    expect(status.state).toBe('running');
  });

  it('retrieves job results from the owning source', async () => {
    const registry = new DataSourceRegistry();
    registry.register(
      mockSource({
        id: 'crawler',
        getJobResult: vi.fn().mockResolvedValue({
          sourceId: 'crawler',
          capability: 'web-crawl',
          data: [{ url: 'https://example.com', content: '...' }],
          metadata: { fetchedAt: new Date().toISOString(), latencyMs: 5000, cached: false },
        }),
      }),
    );

    const result = await registry.getJobResult('crawler', 'job-789');
    expect(result.sourceId).toBe('crawler');
  });

  it('throws when polling status on source without async support', async () => {
    const registry = new DataSourceRegistry();
    registry.register(mockSource({ id: 'sync-only' }));

    await expect(registry.getJobStatus('sync-only', 'job-1')).rejects.toThrow('does not support async jobs');
  });

  it('throws distinct error when source not found in getJobStatus', async () => {
    const registry = new DataSourceRegistry();
    await expect(registry.getJobStatus('nonexistent', 'job-1')).rejects.toThrow('Source "nonexistent" not found');
  });

  it('throws distinct error when source not found in getJobResult', async () => {
    const registry = new DataSourceRegistry();
    await expect(registry.getJobResult('nonexistent', 'job-1')).rejects.toThrow('Source "nonexistent" not found');
  });
});

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------

describe('DataSourceRegistry — health checks', () => {
  it('runs health checks on all sources', async () => {
    const registry = new DataSourceRegistry();
    registry.register(
      mockSource({
        id: 'healthy',
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 5 }),
      }),
    );
    registry.register(
      mockSource({
        id: 'unhealthy',
        healthCheck: vi.fn().mockResolvedValue({ healthy: false, latencyMs: -1, error: 'down' }),
      }),
    );

    const results = await registry.healthCheckAll();
    expect(results.get('healthy')?.healthy).toBe(true);
    expect(results.get('unhealthy')?.healthy).toBe(false);
  });

  it('catches health check exceptions', async () => {
    const registry = new DataSourceRegistry();
    registry.register(
      mockSource({
        id: 'exploding',
        healthCheck: vi.fn().mockRejectedValue(new Error('connection refused')),
      }),
    );

    const results = await registry.healthCheckAll();
    expect(results.get('exploding')?.healthy).toBe(false);
    expect(results.get('exploding')?.error).toContain('connection refused');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('DataSourceRegistry — lifecycle', () => {
  it('initializes all sources with matching configs', async () => {
    const registry = new DataSourceRegistry();
    const initFn = vi.fn().mockResolvedValue(undefined);
    registry.register(mockSource({ id: 'src-a', initialize: initFn }));

    const configs: DataSourceConfig[] = [
      {
        id: 'src-a',
        name: 'Source A',
        capabilities: [{ id: 'news' }],
        enabled: true,
        priority: 1,
        config: {
          type: 'api',
          baseUrl: 'https://example.com',
          rateLimitPerMinute: 60,
          authHeader: 'Authorization',
          authPrefix: 'Bearer',
          supportsAsync: false,
          endpointMapping: {},
        },
      },
    ];

    const skipped = await registry.initializeAll(configs);
    expect(initFn).toHaveBeenCalledWith(configs[0]);
    expect(skipped).toEqual([]);
  });

  it('returns skipped source ids when no config matches', async () => {
    const registry = new DataSourceRegistry();
    registry.register(mockSource({ id: 'configured' }));
    registry.register(mockSource({ id: 'unconfigured' }));

    const configs: DataSourceConfig[] = [
      {
        id: 'configured',
        name: 'Configured',
        capabilities: [{ id: 'news' }],
        enabled: true,
        priority: 1,
        config: {
          type: 'api',
          baseUrl: 'https://example.com',
          rateLimitPerMinute: 60,
          authHeader: 'Authorization',
          authPrefix: 'Bearer',
          supportsAsync: false,
          endpointMapping: {},
        },
      },
    ];

    const skipped = await registry.initializeAll(configs);
    expect(skipped).toEqual(['unconfigured']);
  });

  it('throws on config type mismatch', async () => {
    const registry = new DataSourceRegistry();
    registry.register(mockSource({ id: 'cli-plugin', type: 'cli' }));

    const configs: DataSourceConfig[] = [
      {
        id: 'cli-plugin',
        name: 'CLI Plugin',
        capabilities: [{ id: 'news' }],
        enabled: true,
        priority: 1,
        config: {
          type: 'api',
          baseUrl: 'https://example.com',
          rateLimitPerMinute: 60,
          authHeader: 'Authorization',
          authPrefix: 'Bearer',
          supportsAsync: false,
          endpointMapping: {},
        },
      },
    ];

    await expect(registry.initializeAll(configs)).rejects.toThrow(
      'Config type mismatch for "cli-plugin": plugin is "cli" but config is "api"',
    );
  });

  it('shuts down all sources gracefully', async () => {
    const registry = new DataSourceRegistry();
    const shutdownA = vi.fn().mockResolvedValue(undefined);
    const shutdownB = vi.fn().mockRejectedValue(new Error('cleanup failed'));
    registry.register(mockSource({ id: 'a', shutdown: shutdownA }));
    registry.register(mockSource({ id: 'b', shutdown: shutdownB }));

    // Should not throw even if one shutdown fails
    await registry.shutdownAll();
    expect(shutdownA).toHaveBeenCalled();
    expect(shutdownB).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Zod config schema validation
// ---------------------------------------------------------------------------

describe('DataSourceConfigSchema', () => {
  it('validates a CLI config', () => {
    const config = {
      id: 'openbb',
      name: 'OpenBB SDK',
      capabilities: [{ id: 'equity-fundamentals' }],
      config: { type: 'cli', command: 'openbb' },
    };
    const result = DataSourceConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.config.type).toBe('cli');
    }
  });

  it('validates an MCP config', () => {
    const config = {
      id: 'exa-mcp',
      name: 'Exa MCP',
      capabilities: [{ id: 'web-search' }],
      config: {
        type: 'mcp',
        serverCommand: 'npx -y exa-mcp-server',
        capabilityMapping: { 'web-search': 'web_search_exa' },
      },
    };
    const result = DataSourceConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('validates an API config with async support', () => {
    const config = {
      id: 'firecrawl',
      name: 'Firecrawl',
      capabilities: [{ id: 'web-scrape' }, { id: 'web-crawl' }],
      config: {
        type: 'api',
        baseUrl: 'https://api.firecrawl.dev',
        secretRef: 'firecrawl-api-key',
        supportsAsync: true,
      },
    };
    const result = DataSourceConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects invalid base URL for API config', () => {
    const config = {
      id: 'bad',
      name: 'Bad',
      capabilities: [],
      config: { type: 'api', baseUrl: 'not-a-url' },
    };
    const result = DataSourceConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('validates an array of configs', () => {
    const configs = [
      { id: 'a', name: 'A', capabilities: [], config: { type: 'cli', command: 'a' } },
      { id: 'b', name: 'B', capabilities: [], config: { type: 'mcp', serverCommand: 'b' } },
    ];
    const result = DataSourceConfigArraySchema.safeParse(configs);
    expect(result.success).toBe(true);
  });

  it('rejects unknown data source type', () => {
    const config = {
      id: 'bad',
      name: 'Bad',
      capabilities: [],
      config: { type: 'websocket', url: 'ws://localhost' },
    };
    const result = DataSourceConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
