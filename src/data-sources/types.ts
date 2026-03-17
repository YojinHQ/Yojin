/**
 * Data Source Plugin types — pluggable data feeds for the Research Analyst.
 *
 * Three integration tiers:
 *   - CLI: local command-line tools (spawn subprocess, parse JSON/CSV)
 *   - MCP: Model Context Protocol servers (tools + resources)
 *   - API: REST/GraphQL endpoints with API key auth
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Data source type
// ---------------------------------------------------------------------------

export const DataSourceTypeSchema = z.enum(['cli', 'mcp', 'api']);
export type DataSourceType = z.infer<typeof DataSourceTypeSchema>;

// ---------------------------------------------------------------------------
// Capability — what kind of data a source provides
// ---------------------------------------------------------------------------

export const DataSourceCapabilitySchema = z.object({
  id: z.string(),
  description: z.string().optional(),
});

export type DataSourceCapability = z.infer<typeof DataSourceCapabilitySchema>;

// ---------------------------------------------------------------------------
// Query / Result — uniform interface for all data sources
// ---------------------------------------------------------------------------

export const DataQuerySchema = z.object({
  capability: z.string(),
  symbol: z.string().optional(),
  params: z.record(z.unknown()).default({}),
});

export type DataQuery = z.infer<typeof DataQuerySchema>;

export const DataResultMetadataSchema = z.object({
  fetchedAt: z.string().datetime(),
  latencyMs: z.number(),
  cached: z.boolean(),
});

export const DataResultSchema = z.object({
  sourceId: z.string(),
  capability: z.string(),
  data: z.unknown(),
  metadata: DataResultMetadataSchema,
});

export type DataResult = z.infer<typeof DataResultSchema>;

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Plugin interface — implemented by each adapter (CLI, MCP, API)
// ---------------------------------------------------------------------------

export interface DataSourcePlugin {
  readonly id: string;
  readonly name: string;
  readonly type: DataSourceType;
  readonly capabilities: DataSourceCapability[];
  enabled: boolean;
  priority: number;

  initialize(config: DataSourceConfig): Promise<void>;
  query(request: DataQuery): Promise<DataResult>;
  healthCheck(): Promise<HealthCheckResult>;
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Config — persisted in data/config/data-sources.json
// ---------------------------------------------------------------------------

const CliConfigSchema = z.object({
  type: z.literal('cli'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  outputFormat: z.enum(['json', 'csv', 'ndjson']).default('json'),
  timeout: z.number().default(30_000),
  env: z.record(z.string()).default({}),
});

const McpConfigSchema = z.object({
  type: z.literal('mcp'),
  serverCommand: z.string(),
  serverArgs: z.array(z.string()).default([]),
  transport: z.enum(['stdio', 'sse']).default('stdio'),
  capabilityMapping: z.record(z.string()).default({}),
});

const ApiConfigSchema = z.object({
  type: z.literal('api'),
  baseUrl: z.string().url(),
  secretRef: z.string().optional(),
  authHeader: z.string().default('Authorization'),
  authPrefix: z.string().default('Bearer'),
  rateLimitPerMinute: z.number().default(60),
  endpointMapping: z
    .record(
      z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
        path: z.string(),
        bodyTemplate: z.string().optional(),
      }),
    )
    .default({}),
});

export const DataSourceConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  capabilities: z.array(DataSourceCapabilitySchema),
  enabled: z.boolean().default(true),
  priority: z.number().default(10),
  config: z.discriminatedUnion('type', [CliConfigSchema, McpConfigSchema, ApiConfigSchema]),
});

export type DataSourceConfig = z.infer<typeof DataSourceConfigSchema>;

export const DataSourceConfigArraySchema = z.array(DataSourceConfigSchema);
