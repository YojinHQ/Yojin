/**
 * Config loader — bridges the flat JSON format used in data-sources.json
 * to the typed DataSourceConfig with nested discriminated union.
 *
 * The JSON file uses a flat format (type, baseUrl, command at top level)
 * while the typed schema uses a nested config object. This loader
 * handles the conversion.
 */

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import type { DataSourceConfig } from './types.js';

// ---------------------------------------------------------------------------
// Flat JSON schema (matches what's persisted in data-sources.json)
// ---------------------------------------------------------------------------

const FlatDataSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['CLI', 'MCP', 'API']),
  capabilities: z.array(z.string()),
  enabled: z.boolean().default(true),
  priority: z.number().default(10),
  builtin: z.boolean().default(false),
  // API fields
  baseUrl: z.string().optional(),
  secretRef: z.string().optional(),
  authHeader: z.string().optional(),
  authPrefix: z.string().optional(),
  rateLimitPerMinute: z.number().optional(),
  supportsAsync: z.boolean().optional(),
  endpointMapping: z.record(z.string(), z.unknown()).optional(),
  // CLI fields
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  outputFormat: z.enum(['json', 'csv', 'ndjson']).optional(),
  timeout: z.number().optional(),
  env: z.record(z.string(), z.string()).optional(),
  // MCP fields
  serverCommand: z.string().optional(),
  serverArgs: z.array(z.string()).optional(),
  transport: z.enum(['stdio', 'sse']).optional(),
  capabilityMapping: z.record(z.string(), z.string()).optional(),
  // Extra fields (e.g. feeds) — passed through
  feeds: z.array(z.string()).optional(),
});

type FlatDataSource = z.infer<typeof FlatDataSourceSchema>;

const FlatDataSourceArraySchema = z.array(FlatDataSourceSchema);

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

function flatToTyped(flat: FlatDataSource): DataSourceConfig {
  const base = {
    id: flat.id,
    name: flat.name,
    capabilities: flat.capabilities.map((id) => ({ id })),
    enabled: flat.enabled,
    priority: flat.priority,
    builtin: flat.builtin,
  };

  switch (flat.type) {
    case 'API':
      return {
        ...base,
        config: {
          type: 'api' as const,
          baseUrl: flat.baseUrl ?? '',
          secretRef: flat.secretRef,
          authHeader: flat.authHeader ?? 'Authorization',
          authPrefix: flat.authPrefix ?? 'Bearer',
          rateLimitPerMinute: flat.rateLimitPerMinute ?? 60,
          supportsAsync: flat.supportsAsync ?? false,
          endpointMapping: (flat.endpointMapping ?? {}) as Record<
            string,
            { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; bodyTemplate?: string }
          >,
        },
      };
    case 'CLI':
      return {
        ...base,
        config: {
          type: 'cli' as const,
          command: flat.command ?? '',
          args: flat.args ?? [],
          outputFormat: flat.outputFormat ?? 'json',
          timeout: flat.timeout ?? 30_000,
          env: flat.env ?? {},
        },
      };
    case 'MCP':
      return {
        ...base,
        config: {
          type: 'mcp' as const,
          serverCommand: flat.serverCommand ?? '',
          serverArgs: flat.serverArgs ?? [],
          transport: flat.transport ?? 'stdio',
          capabilityMapping: flat.capabilityMapping ?? {},
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load data source configs from the flat JSON file and return typed configs.
 */
export async function loadDataSourceConfigs(configPath: string): Promise<DataSourceConfig[]> {
  const raw = JSON.parse(await readFile(configPath, 'utf-8'));
  const flat = FlatDataSourceArraySchema.parse(raw);
  return flat.map(flatToTyped);
}
