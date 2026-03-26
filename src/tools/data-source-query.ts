/**
 * query_data_source tool — lets agents query data sources (CLI + API).
 *
 * Reads the data-sources.json config, resolves API keys from the vault,
 * runs CLI commands or makes HTTP requests, and returns results to the agent.
 * Results are also ingested as signals when an ingestor is configured.
 */

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { runCli } from '../core/run-cli.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import type { RawSignalInput, SignalIngestor } from '../signals/ingestor.js';
import type { EncryptedVault } from '../trust/vault/vault.js';

interface DataSourceConfig {
  id: string;
  name: string;
  type: 'CLI' | 'MCP' | 'API';
  capabilities: string[];
  enabled: boolean;
  command?: string;
  args?: string[];
  baseUrl?: string;
  secretRef?: string;
}

export interface DataSourceQueryOptions {
  configPath: string;
  vault?: EncryptedVault;
  ingestor?: SignalIngestor;
  registry?: DataSourceRegistry;
}

/** Convert CLI output to RawSignalInput items for ingestion. */
function outputToSignals(output: string, config: DataSourceConfig): RawSignalInput[] {
  try {
    const data = JSON.parse(output);
    // Unwrap common response wrappers (e.g. Nimble's { results: [...] })
    const items: Record<string, unknown>[] = Array.isArray(data)
      ? data
      : Array.isArray(data.results)
        ? data.results
        : [data];

    return items
      .filter((item) => item.title || item.headline || item.name)
      .map((item) => ({
        sourceId: config.id,
        sourceName: config.name,
        sourceType: 'API' as const,
        reliability: 0.7,
        title: String(item.title ?? item.headline ?? item.name ?? ''),
        content: item.content ? String(item.content) : item.description ? String(item.description) : undefined,
        link: item.url ? String(item.url) : item.link ? String(item.link) : undefined,
        publishedAt: item.publishedAt
          ? String(item.publishedAt)
          : item.date
            ? String(item.date)
            : new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

export function createDataSourceQueryTools(options: DataSourceQueryOptions): ToolDefinition[] {
  const { configPath, vault, ingestor, registry } = options;

  // Shared: resolve API key from vault
  async function resolveApiKey(config: DataSourceConfig): Promise<{ key: string } | { error: string }> {
    if (!config.secretRef) return { key: '' };
    if (!vault?.isUnlocked) {
      return { error: `Vault is locked. Unlock it first — "${config.name}" requires API key "${config.secretRef}".` };
    }
    try {
      const secret = await vault.get(config.secretRef);
      if (secret) return { key: secret };
      return { error: `API key "${config.secretRef}" not found in vault. Ask the user to add it in Settings → Vault.` };
    } catch {
      return { error: `Failed to read "${config.secretRef}" from vault.` };
    }
  }

  // Shared: ingest output and return formatted result
  async function formatAndIngest(output: string, config: DataSourceConfig): Promise<ToolResult> {
    let ingestNote = '';
    if (ingestor) {
      try {
        const signals = outputToSignals(output, config);
        if (signals.length > 0) {
          const result = await ingestor.ingest(signals);
          ingestNote = `\n\n[Ingested ${result.ingested} signal(s), ${result.duplicates} duplicate(s)]`;
        }
      } catch {
        // Best-effort — don't fail the tool if ingestion fails
      }
    }

    try {
      const parsed = JSON.parse(output);
      return { content: JSON.stringify(parsed, null, 2) + ingestNote };
    } catch {
      return { content: output + ingestNote };
    }
  }

  // Execute a CLI data source
  async function executeCli(config: DataSourceConfig, params: { query?: string; url?: string }): Promise<ToolResult> {
    if (!config.command) {
      return { content: `Data source "${config.name}" has no command configured.`, isError: true };
    }

    const cmdArgs = [...(config.args ?? [])];
    if (params.query && cmdArgs.includes('search')) {
      cmdArgs.push('--query', params.query);
    } else if (params.url) {
      cmdArgs.push(params.url);
    } else if (!params.query && !params.url) {
      return { content: 'Please provide a "query" or "url".', isError: true };
    }

    const keyResult = await resolveApiKey(config);
    if ('error' in keyResult) return { content: keyResult.error, isError: true };

    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (config.secretRef && keyResult.key) {
      env[config.secretRef] = keyResult.key;
    }

    try {
      const { stdout, stderr } = await runCli(config.command, cmdArgs, {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        env,
      });

      const output = stdout.trim();
      if (!output) {
        const hint = stderr?.trim() ? `\nStderr: ${stderr.trim()}` : '';
        return { content: `Command returned empty output.${hint}`, isError: true };
      }

      return formatAndIngest(output, config);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const stderr = (err as { stderr?: string }).stderr?.trim();
      let message = raw;
      if (raw.includes('ENOENT')) {
        message = `"${config.command}" is not installed. Ask the user to install it.`;
      } else if (raw.includes('401') || stderr?.includes('401')) {
        message = `API key "${config.secretRef}" is invalid or expired. Ask the user to update it in Settings → Vault.`;
      } else if (raw.includes('Command failed')) {
        message =
          stderr ||
          raw
            .split('\n')
            .filter((l) => !l.startsWith('Command failed:'))
            .join(' ')
            .trim() ||
          raw;
      }
      return { content: `Fetch failed: ${message}`, isError: true };
    }
  }

  // Execute an API data source via HTTP
  async function executeApi(config: DataSourceConfig, params: { query?: string; url?: string }): Promise<ToolResult> {
    if (!config.baseUrl) {
      return { content: `Data source "${config.name}" has no baseUrl configured.`, isError: true };
    }
    if (!params.query && !params.url) {
      return { content: 'Please provide a "query" or "url".', isError: true };
    }

    const keyResult = await resolveApiKey(config);
    if ('error' in keyResult) return { content: keyResult.error, isError: true };

    try {
      // POST to /search endpoint with Bearer auth (works for Exa, Firecrawl, etc.)
      const endpoint = `${config.baseUrl}/search`;
      const body: Record<string, unknown> = {};
      if (params.query) body.query = params.query;
      if (params.url) body.url = params.url;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (keyResult.key) {
        headers['Authorization'] = `Bearer ${keyResult.key}`;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        if (response.status === 401 || response.status === 403) {
          return {
            content: `API key "${config.secretRef}" is invalid or expired. Update it in Settings → Vault.`,
            isError: true,
          };
        }
        return { content: `API returned ${response.status}: ${text.slice(0, 200)}`, isError: true };
      }

      const output = await response.text();
      if (!output.trim()) {
        return { content: 'API returned empty response.', isError: true };
      }

      return formatAndIngest(output.trim(), config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `API request failed: ${message}`, isError: true };
    }
  }

  const queryDataSource: ToolDefinition = {
    name: 'query_data_source',
    description:
      'Query a connected data source (CLI tool or REST API). ' +
      'Supports search sources (Nimble, Exa), RSS feeds (curl), and more. ' +
      'For search-capable sources, provide a search query. ' +
      'For URL-based sources, provide a URL. ' +
      'Results are automatically ingested as signals.',
    parameters: z.object({
      sourceId: z.string().describe('The data source ID (e.g. "nimble-cli", "exa-search", "curl-rss")'),
      query: z.string().optional().describe('Search query for search-capable sources'),
      url: z.string().optional().describe('URL to fetch for URL-based sources'),
    }),
    async execute(params: { sourceId: string; query?: string; url?: string }): Promise<ToolResult> {
      // Try registry first (generic path with priority fallback)
      if (registry) {
        const plugin = registry.getSource(params.sourceId);
        if (plugin) {
          if (!plugin.enabled) {
            return { content: `Data source "${plugin.name}" is disabled.`, isError: true };
          }
          try {
            const result = await plugin.query({
              capability: 'query',
              prompt: params.query,
              url: params.url,
              params: {},
            });
            const output = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);

            // Best-effort signal ingestion
            if (ingestor) {
              try {
                const signals = outputToSignals(output, {
                  id: plugin.id,
                  name: plugin.name,
                  type: plugin.type.toUpperCase() as 'CLI' | 'MCP' | 'API',
                  capabilities: plugin.capabilities.map((c) => c.id),
                  enabled: plugin.enabled,
                });
                if (signals.length > 0) {
                  const ingestResult = await ingestor.ingest(signals);
                  return {
                    content:
                      output +
                      `\n\n[Ingested ${ingestResult.ingested} signal(s), ${ingestResult.duplicates} duplicate(s)]`,
                  };
                }
              } catch {
                // Best-effort
              }
            }

            return { content: output };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: `Query failed: ${message}`, isError: true };
          }
        }

        // Source not in registry — list available ones
        const available = registry
          .getSources()
          .map((s) => `${s.id} (${s.name})`)
          .join(', ');
        return {
          content: `Data source "${params.sourceId}" not found. Available sources: ${available || 'none'}`,
          isError: true,
        };
      }

      // Fallback: load from config file directly
      let configs: DataSourceConfig[];
      try {
        const content = await readFile(configPath, 'utf-8');
        configs = JSON.parse(content) as DataSourceConfig[];
      } catch {
        return { content: 'Failed to load data source configs.', isError: true };
      }

      const config = configs.find((c) => c.id === params.sourceId);
      if (!config) {
        const available = configs.map((c) => `${c.id} (${c.name})`).join(', ');
        return {
          content: `Data source "${params.sourceId}" not found. Available sources: ${available}`,
          isError: true,
        };
      }

      if (!config.enabled) {
        return { content: `Data source "${config.name}" is disabled.`, isError: true };
      }

      if (config.type === 'CLI') {
        return executeCli(config, params);
      } else if (config.type === 'API') {
        return executeApi(config, params);
      } else {
        return {
          content: `Data source type "${config.type}" is not yet supported.`,
          isError: true,
        };
      }
    },
  };

  const listDataSources: ToolDefinition = {
    name: 'list_data_sources',
    description:
      'List all configured data sources and their capabilities. ' +
      'Shows which sources are available, enabled, and what they can do.',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      // Use registry when available
      if (registry) {
        const sources = registry.getSources();
        if (sources.length === 0) {
          return { content: 'No data sources configured.' };
        }

        const lines = ['# Configured Data Sources', ''];
        for (const s of sources) {
          const status = s.enabled ? 'ENABLED' : 'DISABLED';
          const caps = s.capabilities.map((c) => c.id).join(', ');
          lines.push(`- **${s.name}** (${s.id}) [${status}]`);
          lines.push(`  Type: ${s.type.toUpperCase()} | Capabilities: ${caps}`);
        }

        return { content: lines.join('\n') };
      }

      // Fallback: load from config file
      let configs: DataSourceConfig[];
      try {
        const content = await readFile(configPath, 'utf-8');
        configs = JSON.parse(content) as DataSourceConfig[];
      } catch {
        return { content: 'Failed to load data source configs.', isError: true };
      }

      if (configs.length === 0) {
        return { content: 'No data sources configured.' };
      }

      const lines = ['# Configured Data Sources', ''];
      for (const c of configs) {
        const status = c.enabled ? 'ENABLED' : 'DISABLED';
        const caps = c.capabilities.join(', ');
        const auth = c.secretRef ? `(requires ${c.secretRef})` : '';
        lines.push(`- **${c.name}** (${c.id}) [${status}]`);
        lines.push(`  Type: ${c.type} | Capabilities: ${caps} ${auth}`);
        if (c.command) lines.push(`  Command: ${c.command}`);
      }

      return { content: lines.join('\n') };
    },
  };

  return [queryDataSource, listDataSources];
}
