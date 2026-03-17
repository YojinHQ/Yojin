import { describe, expect, it, vi } from 'vitest';

import { DataSourceRegistry } from '../../src/data-sources/registry.js';
import type {
  DataResult,
  DataSourceConfig,
  DataSourcePlugin,
} from '../../src/data-sources/types.js';
import {
  DataSourceConfigArraySchema,
  DataSourceConfigSchema,
} from '../../src/data-sources/types.js';

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
    registry.register(
      mockSource({ id: 'disabled', enabled: false, capabilities: [{ id: 'news' }] }),
    );

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
// Query with fallback
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
        query: vi.fn().mockResolvedValue({
          sourceId: 'secondary',
          capability: 'news',
          data: { headline: 'from secondary' },
          metadata: { fetchedAt: new Date().toISOString(), latencyMs: 10, cached: false },
        }),
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
          endpointMapping: {},
        },
      },
    ];

    await registry.initializeAll(configs);
    expect(initFn).toHaveBeenCalledWith(configs[0]);
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
      expect(result.data.enabled).toBe(true); // default
      expect(result.data.config.type).toBe('cli');
    }
  });

  it('validates an MCP config', () => {
    const config = {
      id: 'twitter-mcp',
      name: 'Twitter MCP',
      capabilities: [{ id: 'social-sentiment' }],
      config: {
        type: 'mcp',
        serverCommand: 'npx @yojin/twitter-mcp',
        capabilityMapping: { 'social-sentiment': 'get_sentiment' },
      },
    };
    const result = DataSourceConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('validates an API config', () => {
    const config = {
      id: 'keelson',
      name: 'Keelson API',
      capabilities: [{ id: 'sentiment' }, { id: 'enrichment' }],
      config: {
        type: 'api',
        baseUrl: 'https://api.keelson.io/graphql',
        secretRef: 'keelson-api-key',
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
