/**
 * Data Source Plugin types — pluggable data feeds for the Research Analyst.
 *
 * Three integration tiers:
 *   - CLI: local command-line tools (spawn subprocess, parse JSON/CSV)
 *   - MCP: Model Context Protocol servers (tools + resources)
 *   - API: REST/GraphQL endpoints with API key auth
 *
 * Two execution patterns:
 *   - Synchronous: query() → immediate DataResult
 *   - Async job: startJob() → poll getJobStatus() → getJobResult()
 *
 * Designed to work with any data source — CLI tools, REST APIs, or custom plugins.
 */

import { z } from 'zod';

import { DateTimeField } from '../types/base.js';

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
// Query — uniform request for all data sources
// ---------------------------------------------------------------------------

export interface DataQuery {
  capability: string;
  symbol?: string;
  url?: string;
  urls?: string[];
  prompt?: string;
  schema?: unknown;
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Result — uniform response from all data sources
// ---------------------------------------------------------------------------

export const DataResultMetadataSchema = z.object({
  fetchedAt: DateTimeField,
  latencyMs: z.number(),
  cached: z.boolean(),
  cost: z.number().optional(),
  creditsUsed: z.number().optional(),
});

export const DataResultSchema = z.object({
  sourceId: z.string(),
  capability: z.string(),
  data: z.unknown(),
  metadata: DataResultMetadataSchema,
});

export type DataResult = z.infer<typeof DataResultSchema>;

// ---------------------------------------------------------------------------
// Async job types — for long-running operations (crawls, dataset collection)
// ---------------------------------------------------------------------------

export interface JobHandle {
  jobId: string;
  sourceId: string;
  estimatedDuration?: number;
}

export type JobStatus =
  | { state: 'running'; progress?: number }
  | { state: 'completed'; resultCount?: number }
  | { state: 'failed'; error: string };

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

  /** Lifecycle: set up connections, validate credentials. */
  initialize(config: DataSourceConfig): Promise<void>;

  /** Synchronous query — immediate result. */
  query(request: DataQuery): Promise<DataResult>;

  /** Start an async job (crawl, dataset, actor). Optional — sync-only sources skip this. */
  startJob?(request: DataQuery): Promise<JobHandle>;

  /** Poll async job status. */
  getJobStatus?(jobId: string): Promise<JobStatus>;

  /** Retrieve async job results. */
  getJobResult?(jobId: string): Promise<DataResult>;

  /** Health check — validates connectivity and credentials. */
  healthCheck(): Promise<HealthCheckResult>;

  /** Lifecycle: clean up connections. */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Config — persisted in config/data-sources.json (relative to data root)
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
  supportsAsync: z.boolean().default(false),
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
  builtin: z.boolean().default(false),
  config: z.discriminatedUnion('type', [CliConfigSchema, McpConfigSchema, ApiConfigSchema]),
});

export type DataSourceConfig = z.infer<typeof DataSourceConfigSchema>;

export const DataSourceConfigArraySchema = z.array(DataSourceConfigSchema);
