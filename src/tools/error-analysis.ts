/**
 * Error analysis tool — diagnose data pipeline failures.
 *
 * Queries the DataSourceRegistry for health status, identifies failed or
 * degraded sources, and returns a structured diagnosis with remediation steps.
 */

import { z } from 'zod';

import type { ToolDefinition, ToolResult } from '../core/types.js';
import type { DataSourceRegistry } from '../data-sources/registry.js';

export interface ErrorAnalysisOptions {
  dataSourceRegistry: DataSourceRegistry;
}

export function createErrorAnalysisTools(options: ErrorAnalysisOptions): ToolDefinition[] {
  const { dataSourceRegistry } = options;

  const diagnoseError: ToolDefinition = {
    name: 'diagnose_data_error',
    description:
      'Diagnose data pipeline failures — stale data, API errors, missing feeds. ' +
      'Checks source health, identifies failures, and suggests remediation.',
    parameters: z.object({
      sourceId: z.string().optional().describe('Specific source to diagnose (omit for all)'),
      capability: z.string().optional().describe('Capability that failed (e.g. "equity-fundamentals")'),
      errorMessage: z.string().optional().describe('Error message from the failed operation'),
    }),
    async execute(params: { sourceId?: string; capability?: string; errorMessage?: string }): Promise<ToolResult> {
      const lines: string[] = ['# Data Pipeline Diagnosis', ''];

      // If a specific source was requested, check just that one
      if (params.sourceId) {
        const source = dataSourceRegistry.getSource(params.sourceId);
        if (!source) {
          return {
            content: `Source "${params.sourceId}" not found in registry.`,
            isError: true,
          };
        }

        try {
          const health = await source.healthCheck();
          lines.push(`## Source: ${source.name} (${source.id})`);
          lines.push(`- Type: ${source.type}`);
          lines.push(`- Enabled: ${source.enabled}`);
          lines.push(`- Healthy: ${health.healthy}`);
          lines.push(`- Latency: ${health.latencyMs}ms`);
          if (health.error) lines.push(`- Error: ${health.error}`);
          lines.push('');
          lines.push(diagnoseSource(health.healthy, health.error, params.errorMessage));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lines.push(`## Source: ${source.name} (${source.id})`);
          lines.push(`- Health check failed: ${msg}`);
          lines.push('');
          lines.push('### Remediation');
          lines.push('- Source is unreachable. Check network connectivity and credentials.');
        }

        return { content: lines.join('\n') };
      }

      // Check all sources, optionally filtered by capability
      const sources = params.capability
        ? dataSourceRegistry.getByCapability(params.capability)
        : dataSourceRegistry.getSources();

      if (sources.length === 0) {
        const reason = params.capability
          ? `No sources provide capability "${params.capability}".`
          : 'No data sources registered.';
        return { content: reason, isError: true };
      }

      const healthResults = await dataSourceRegistry.healthCheckAll();
      let unhealthyCount = 0;

      for (const source of sources) {
        const health = healthResults.get(source.id);
        const healthy = health?.healthy ?? false;
        if (!healthy) unhealthyCount++;

        lines.push(`## ${source.name} (${source.id})`);
        lines.push(`- Type: ${source.type} | Enabled: ${source.enabled} | Priority: ${source.priority}`);
        lines.push(`- Capabilities: ${source.capabilities.map((c) => c.id).join(', ')}`);
        lines.push(`- Healthy: ${healthy}`);
        if (health) {
          lines.push(`- Latency: ${health.latencyMs}ms`);
          if (health.error) lines.push(`- Error: ${health.error}`);
        }
        lines.push('');
      }

      lines.push('---');
      lines.push(`Summary: ${sources.length} sources checked, ${unhealthyCount} unhealthy.`);

      if (unhealthyCount > 0) {
        lines.push('');
        lines.push('### Remediation');
        lines.push('- Check credentials for failing sources (use `list_credentials`).');
        lines.push('- Verify network connectivity to external APIs.');
        lines.push('- Check rate limits — source may be temporarily throttled.');
      }

      return { content: lines.join('\n') };
    },
  };

  return [diagnoseError];
}

function diagnoseSource(healthy: boolean, healthError?: string, operationError?: string): string {
  const lines: string[] = ['### Diagnosis'];

  if (healthy && !operationError) {
    lines.push('Source is healthy. No issues detected.');
    return lines.join('\n');
  }

  if (!healthy) {
    lines.push('Source health check failed.');
    if (healthError?.includes('ECONNREFUSED') || healthError?.includes('ETIMEDOUT')) {
      lines.push('- **Network issue**: Source is unreachable.');
      lines.push('- Check if the service is running and accessible.');
    } else if (healthError?.includes('401') || healthError?.includes('403')) {
      lines.push('- **Authentication issue**: Credentials may be expired or invalid.');
      lines.push('- Re-store the API key using `store_credential`.');
    } else if (healthError?.includes('429')) {
      lines.push('- **Rate limited**: Too many requests.');
      lines.push('- Wait before retrying. Consider reducing query frequency.');
    } else {
      lines.push(`- Error: ${healthError}`);
    }
  }

  if (operationError) {
    lines.push('');
    lines.push('### Operation Error');
    lines.push(`- ${operationError}`);
  }

  lines.push('');
  lines.push('### Remediation');
  lines.push('- Verify credentials with `check_credential`.');
  lines.push('- Check if alternative sources provide the same capability.');
  lines.push('- If persistent, disable the source and rely on fallback.');

  return lines.join('\n');
}
