import { describe, expect, it } from 'vitest';

import type { ToolDefinition } from '../../src/core/types.js';
import type { DataSourceRegistry } from '../../src/data-sources/registry.js';
import type { DataSourcePlugin, HealthCheckResult } from '../../src/data-sources/types.js';
import { createErrorAnalysisTools } from '../../src/tools/error-analysis.js';

function makeSource(
  id: string,
  overrides: Partial<DataSourcePlugin> & { health?: HealthCheckResult } = {},
): DataSourcePlugin {
  const health = overrides.health ?? { healthy: true, latencyMs: 50 };
  return {
    id,
    name: overrides.name ?? `Source ${id}`,
    type: 'api',
    capabilities: overrides.capabilities ?? [{ id: 'equity-fundamentals' }],
    enabled: overrides.enabled ?? true,
    priority: overrides.priority ?? 10,
    healthCheck: async () => health,
    initialize: async () => {},
    query: async () => ({
      sourceId: id,
      capability: 'equity-fundamentals',
      data: {},
      metadata: { fetchedAt: new Date().toISOString(), latencyMs: 50, cached: false },
    }),
    shutdown: async () => {},
  } as DataSourcePlugin;
}

function makeRegistry(sources: DataSourcePlugin[]): DataSourceRegistry {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));

  return {
    getSource: (id: string) => sourceMap.get(id),
    getSources: () => sources,
    getByCapability: (cap: string) => sources.filter((s) => s.enabled && s.capabilities.some((c) => c.id === cap)),
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

function getDiagnoseTool(registry: DataSourceRegistry): ToolDefinition {
  return createErrorAnalysisTools({ dataSourceRegistry: registry })[0];
}

describe('createErrorAnalysisTools', () => {
  it('creates 1 tool', () => {
    const tools = createErrorAnalysisTools({ dataSourceRegistry: makeRegistry([]) });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('diagnose_data_error');
  });
});

describe('diagnose_data_error', () => {
  it('diagnoses a specific healthy source', async () => {
    const registry = makeRegistry([makeSource('openbb')]);
    const tool = getDiagnoseTool(registry);

    const result = await tool.execute({ sourceId: 'openbb' });
    expect(result.content).toContain('Source: Source openbb');
    expect(result.content).toContain('Healthy: true');
    expect(result.content).toContain('No issues detected');
  });

  it('diagnoses a specific unhealthy source', async () => {
    const registry = makeRegistry([
      makeSource('failing', {
        health: { healthy: false, latencyMs: -1, error: 'ECONNREFUSED' },
      }),
    ]);
    const tool = getDiagnoseTool(registry);

    const result = await tool.execute({ sourceId: 'failing' });
    expect(result.content).toContain('Healthy: false');
    expect(result.content).toContain('Network issue');
    expect(result.content).toContain('Remediation');
  });

  it('returns error for unknown source', async () => {
    const registry = makeRegistry([]);
    const tool = getDiagnoseTool(registry);

    const result = await tool.execute({ sourceId: 'nonexistent' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
  });

  it('checks all sources when no sourceId given', async () => {
    const registry = makeRegistry([
      makeSource('healthy-source'),
      makeSource('bad-source', {
        health: { healthy: false, latencyMs: -1, error: '401 Unauthorized' },
      }),
    ]);
    const tool = getDiagnoseTool(registry);

    const result = await tool.execute({});
    expect(result.content).toContain('healthy-source');
    expect(result.content).toContain('bad-source');
    expect(result.content).toContain('2 sources checked, 1 unhealthy');
  });

  it('filters by capability when specified', async () => {
    const registry = makeRegistry([
      makeSource('news-src', { capabilities: [{ id: 'news' }] }),
      makeSource('equity-src', { capabilities: [{ id: 'equity-fundamentals' }] }),
    ]);
    const tool = getDiagnoseTool(registry);

    const result = await tool.execute({ capability: 'news' });
    expect(result.content).toContain('news-src');
    expect(result.content).not.toContain('equity-src');
  });

  it('handles auth errors in diagnosis', async () => {
    const registry = makeRegistry([
      makeSource('auth-fail', {
        health: { healthy: false, latencyMs: 200, error: '403 Forbidden' },
      }),
    ]);
    const tool = getDiagnoseTool(registry);

    const result = await tool.execute({ sourceId: 'auth-fail' });
    expect(result.content).toContain('Authentication issue');
  });

  it('returns error when no sources provide requested capability', async () => {
    const registry = makeRegistry([makeSource('equity-only', { capabilities: [{ id: 'equity-fundamentals' }] })]);
    const tool = getDiagnoseTool(registry);

    const result = await tool.execute({ capability: 'sentiment' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('No sources provide capability');
  });
});
