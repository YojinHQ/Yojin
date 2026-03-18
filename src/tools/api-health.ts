/**
 * API health tool — check connectivity and status of connected data sources.
 *
 * Runs health checks on the DataSourceRegistry and formats results as a
 * readable status report. Flags unhealthy sources for investigation.
 */

import { z } from 'zod';

import type { ToolDefinition, ToolResult } from '../core/types.js';
import type { DataSourceRegistry } from '../data-sources/registry.js';

export interface ApiHealthOptions {
  dataSourceRegistry: DataSourceRegistry;
}

export function createApiHealthTools(options: ApiHealthOptions): ToolDefinition[] {
  const { dataSourceRegistry } = options;

  const checkHealth: ToolDefinition = {
    name: 'check_api_health',
    description:
      'Check the health and connectivity of connected data sources. ' +
      'Reports status, latency, and errors for each source.',
    parameters: z.object({
      sourceId: z
        .string()
        .optional()
        .describe('Check a specific source (omit for all sources)'),
    }),
    async execute(params: { sourceId?: string }): Promise<ToolResult> {
      // Single source check
      if (params.sourceId) {
        const source = dataSourceRegistry.getSource(params.sourceId);
        if (!source) {
          return {
            content: `Source "${params.sourceId}" not found.`,
            isError: true,
          };
        }

        try {
          const health = await source.healthCheck();
          const status = health.healthy ? 'HEALTHY' : 'UNHEALTHY';
          const lines = [
            `${status} — ${source.name} (${source.id})`,
            `  Type: ${source.type}`,
            `  Latency: ${health.latencyMs}ms`,
          ];
          if (health.error) lines.push(`  Error: ${health.error}`);
          return { content: lines.join('\n') };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: `UNREACHABLE — ${source.name} (${source.id})\n  Error: ${msg}`,
          };
        }
      }

      // All sources check
      const sources = dataSourceRegistry.getSources();
      if (sources.length === 0) {
        return { content: 'No data sources registered.' };
      }

      const healthResults = await dataSourceRegistry.healthCheckAll();
      const lines: string[] = ['# Data Source Health Report', ''];

      let healthy = 0;
      let unhealthy = 0;

      for (const source of sources) {
        const health = healthResults.get(source.id);
        const isHealthy = health?.healthy ?? false;

        if (isHealthy) healthy++;
        else unhealthy++;

        const status = isHealthy ? 'OK' : 'FAIL';
        const latency = health ? `${health.latencyMs}ms` : 'N/A';
        lines.push(`[${status}] ${source.name} (${source.id}) — ${latency}`);
        if (health?.error) lines.push(`      Error: ${health.error}`);
      }

      lines.push('');
      lines.push(`---`);
      lines.push(`Total: ${sources.length} | Healthy: ${healthy} | Unhealthy: ${unhealthy}`);

      return { content: lines.join('\n') };
    },
  };

  return [checkHealth];
}
