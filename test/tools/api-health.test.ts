import { describe, expect, it } from 'vitest';

import { createApiHealthTools } from '../../src/tools/api-health.js';
import type { DataSourceRegistry } from '../../src/data-sources/registry.js';
import type { DataSourcePlugin, HealthCheckResult } from '../../src/data-sources/types.js';
import type { ToolDefinition } from '../../src/core/types.js';

function makeSource(
  id: string,
  options: { healthy?: boolean; latencyMs?: number; error?: string; name?: string } = {},
): DataSourcePlugin {
  const { healthy = true, latencyMs = 50, error, name } = options;
  return {
    id,
    name: name ?? `Source ${id}`,
    type: 'api',
    capabilities: [{ id: 'equity-fundamentals' }],
    enabled: true,
    priority: 10,
    healthCheck: async () => ({ healthy, latencyMs, error }),
    initialize: async () => {},
    query: async () => ({
      sourceId: id,
      capability: 'equity-fundamentals',
      data: {},
      metadata: { fetchedAt: new Date().toISOString(), latencyMs, cached: false },
    }),
    shutdown: async () => {},
  } as DataSourcePlugin;
}

function makeRegistry(sources: DataSourcePlugin[]): DataSourceRegistry {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));

  return {
    getSource: (id: string) => sourceMap.get(id),
    getSources: () => sources,
    healthCheckAll: async () => {
      const results = new Map<string, HealthCheckResult>();
      for (const source of sources) {
        try {
          results.set(source.id, await source.healthCheck());
        } catch (err) {
          results.set(source.id, {
            healthy: false,
            latencyMs: -1,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return results;
    },
  } as unknown as DataSourceRegistry;
}

function getHealthTool(registry: DataSourceRegistry): ToolDefinition {
  return createApiHealthTools({ dataSourceRegistry: registry })[0];
}

describe('createApiHealthTools', () => {
  it('creates 1 tool', () => {
    const tools = createApiHealthTools({ dataSourceRegistry: makeRegistry([]) });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('check_api_health');
  });
});

describe('check_api_health', () => {
  it('reports healthy source', async () => {
    const registry = makeRegistry([makeSource('openbb', { latencyMs: 42 })]);
    const tool = getHealthTool(registry);

    const result = await tool.execute({ sourceId: 'openbb' });
    expect(result.content).toContain('HEALTHY');
    expect(result.content).toContain('42ms');
  });

  it('reports unhealthy source', async () => {
    const registry = makeRegistry([makeSource('broken', { healthy: false, error: 'Connection refused' })]);
    const tool = getHealthTool(registry);

    const result = await tool.execute({ sourceId: 'broken' });
    expect(result.content).toContain('UNHEALTHY');
    expect(result.content).toContain('Connection refused');
  });

  it('returns error for unknown source', async () => {
    const registry = makeRegistry([]);
    const tool = getHealthTool(registry);

    const result = await tool.execute({ sourceId: 'nonexistent' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
  });

  it('reports all sources when no sourceId given', async () => {
    const registry = makeRegistry([
      makeSource('src-a', { latencyMs: 30 }),
      makeSource('src-b', { healthy: false, error: 'timeout' }),
      makeSource('src-c', { latencyMs: 80 }),
    ]);
    const tool = getHealthTool(registry);

    const result = await tool.execute({});
    expect(result.content).toContain('Data Source Health Report');
    expect(result.content).toContain('[OK] Source src-a');
    expect(result.content).toContain('[FAIL] Source src-b');
    expect(result.content).toContain('[OK] Source src-c');
    expect(result.content).toContain('Total: 3');
    expect(result.content).toContain('Healthy: 2');
    expect(result.content).toContain('Unhealthy: 1');
  });

  it('handles empty registry', async () => {
    const registry = makeRegistry([]);
    const tool = getHealthTool(registry);

    const result = await tool.execute({});
    expect(result.content).toBe('No data sources registered.');
  });

  it('handles health check exceptions', async () => {
    const failingSource = {
      ...makeSource('crasher'),
      healthCheck: async () => {
        throw new Error('Unexpected crash');
      },
    } as DataSourcePlugin;

    const registry = makeRegistry([failingSource]);
    const tool = getHealthTool(registry);

    const result = await tool.execute({ sourceId: 'crasher' });
    expect(result.content).toContain('UNREACHABLE');
    expect(result.content).toContain('Unexpected crash');
  });
});
