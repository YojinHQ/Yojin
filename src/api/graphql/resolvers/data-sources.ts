/**
 * Data source resolvers — listDataSources, addDataSource, removeDataSource,
 * toggleDataSource.
 *
 * Module-level state pattern: setDataSourceConfig is called once during
 * server startup to inject the config path and registry.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import type { JintelClient } from '@yojinhq/jintel-client';
import { z } from 'zod';

import type { DataSourceRegistry } from '../../../data-sources/registry.js';
import { createSubsystemLogger } from '../../../logging/logger.js';

const runExec = promisify(execFile);

const logger = createSubsystemLogger('data-source-resolvers');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DataSourceCapability {
  id: string;
  description?: string;
}

interface DataSource {
  id: string;
  name: string;
  type: 'CLI' | 'MCP' | 'API';
  capabilities: DataSourceCapability[];
  enabled: boolean;
  status: 'ACTIVE' | 'ERROR' | 'DISABLED';
  lastError?: string;
  lastFetchedAt?: string;
  priority: number;
  builtin: boolean;
}

const DataSourceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['CLI', 'MCP', 'API']),
  capabilities: z.array(z.string()),
  enabled: z.boolean(),
  priority: z.number(),
  builtin: z.boolean().default(false),
  baseUrl: z.string().optional(),
  secretRef: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  feeds: z.array(z.string().url()).optional(),
});

type DataSourceConfig = z.infer<typeof DataSourceConfigSchema>;

interface DataSourceResult {
  success: boolean;
  dataSource?: DataSource;
  error?: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let configPath = 'data/config/data-sources.json';

/** Optional getter for the Jintel client — used for API health checks. */
let getJintelClient: (() => JintelClient | undefined) | null = null;

export function setDataSourceConfigPath(path: string): void {
  configPath = path;
}

export function setDataSourceJintelClient(getter: () => JintelClient | undefined): void {
  getJintelClient = getter;
}

/** Optional registry — used for generic health checks when available. */
let dataSourceRegistry: DataSourceRegistry | null = null;

export function setDataSourceRegistry(registry: DataSourceRegistry): void {
  dataSourceRegistry = registry;
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

async function loadConfigs(): Promise<DataSourceConfig[]> {
  try {
    const content = await readFile(configPath, 'utf-8');
    const raw: unknown = JSON.parse(content);
    const result = z.array(DataSourceConfigSchema).safeParse(raw);
    if (!result.success) {
      logger.warn(`Invalid data-sources.json: ${result.error.message}`);
      return [];
    }
    return result.data;
  } catch {
    return [];
  }
}

async function saveConfigs(configs: DataSourceConfig[]): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(configs, null, 2) + '\n', 'utf-8');
}

/** In-memory health status — populated by runHealthChecks on startup. */
const healthStatus = new Map<string, { status: 'ACTIVE' | 'ERROR'; lastError?: string }>();

function configToDataSource(config: DataSourceConfig): DataSource {
  const health = healthStatus.get(config.id);
  let status: 'ACTIVE' | 'ERROR' | 'DISABLED' = health?.status ?? 'ACTIVE';
  if (!config.enabled) {
    status = 'DISABLED';
  } else if (!health) {
    // No health check result yet — treat API sources with a secretRef as unchecked
    // rather than optimistically showing ACTIVE
    if (config.type === 'API' && config.secretRef) {
      status = 'ERROR';
    }
  }
  return {
    id: config.id,
    name: config.name,
    type: config.type,
    capabilities: config.capabilities.map((id) => ({ id })),
    enabled: config.enabled,
    status,
    lastError:
      health?.lastError ??
      (!health && config.type === 'API' && config.secretRef
        ? 'Health check pending — restart server or check vault'
        : undefined),
    priority: config.priority,
    builtin: config.builtin ?? false,
  };
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function listDataSourcesResolver(): Promise<DataSource[]> {
  const configs = await loadConfigs();

  // Re-check API sources live (Jintel status may have changed after vault update)
  for (const config of configs) {
    if (config.type === 'API' && config.enabled) {
      const error = await checkSource(config);
      healthStatus.set(config.id, error ? { status: 'ERROR', lastError: error } : { status: 'ACTIVE' });
    }
  }

  return configs.map(configToDataSource);
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

export async function addDataSourceResolver(
  _parent: unknown,
  args: { input: DataSourceConfig },
): Promise<DataSourceResult> {
  const { input } = args;
  const configs = await loadConfigs();

  if (configs.some((c) => c.id === input.id)) {
    return { success: false, error: `Data source "${input.id}" already exists` };
  }

  // Validate CLI command exists before adding
  if (input.type === 'CLI' && input.command) {
    try {
      await runExec('which', [input.command]);
    } catch {
      return { success: false, error: `"${input.command}" is not installed. Install it first.` };
    }
  }

  const config: DataSourceConfig = {
    id: input.id,
    name: input.name,
    type: input.type,
    capabilities: input.capabilities,
    enabled: input.enabled ?? true,
    priority: input.priority ?? 10,
    builtin: false,
    baseUrl: input.baseUrl,
    secretRef: input.secretRef,
    command: input.command,
    args: input.args,
    feeds: input.feeds,
  };

  configs.push(config);
  await saveConfigs(configs);
  logger.info(`Added data source: ${input.id}`);

  return { success: true, dataSource: configToDataSource(config) };
}

export async function removeDataSourceResolver(_parent: unknown, args: { id: string }): Promise<DataSourceResult> {
  const configs = await loadConfigs();
  const idx = configs.findIndex((c) => c.id === args.id);

  if (idx === -1) {
    return { success: false, error: `Data source "${args.id}" not found` };
  }

  if (configs[idx].builtin) {
    return { success: false, error: `Cannot remove builtin data source "${args.id}"` };
  }

  const [removed] = configs.splice(idx, 1);
  await saveConfigs(configs);
  logger.info(`Removed data source: ${args.id}`);

  return { success: true, dataSource: configToDataSource(removed) };
}

export async function toggleDataSourceResolver(
  _parent: unknown,
  args: { id: string; enabled: boolean },
): Promise<DataSourceResult> {
  const configs = await loadConfigs();
  const config = configs.find((c) => c.id === args.id);

  if (!config) {
    return { success: false, error: `Data source "${args.id}" not found` };
  }

  if (config.builtin && !args.enabled) {
    return { success: false, error: `Cannot disable builtin data source "${args.id}"` };
  }

  config.enabled = args.enabled;
  await saveConfigs(configs);
  logger.info(`${args.enabled ? 'Enabled' : 'Disabled'} data source: ${args.id}`);

  // Re-check health when enabling
  if (args.enabled) {
    const error = await checkSource(config);
    healthStatus.set(config.id, error ? { status: 'ERROR', lastError: error } : { status: 'ACTIVE' });
  }

  return { success: true, dataSource: configToDataSource(config) };
}

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------

/** Check a single data source's prerequisites. Returns error string or null if healthy. */
async function checkSource(config: DataSourceConfig): Promise<string | null> {
  // Use the registry's plugin health check when available (generic path)
  if (dataSourceRegistry) {
    const plugin = dataSourceRegistry.getSource(config.id);
    if (plugin) {
      try {
        const result = await plugin.healthCheck();
        return result.healthy ? null : (result.error ?? 'Health check failed');
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    }
  }

  // Fallback: legacy per-type checks (when registry not wired)
  if (config.type === 'CLI') {
    if (!config.command) return 'No command configured';
    try {
      await runExec('which', [config.command]);
    } catch {
      return `"${config.command}" is not installed`;
    }
  }

  if (config.type === 'API' && config.id === 'jintel') {
    const client = getJintelClient?.();
    if (!client) {
      return 'API key not configured — add "jintel-api-key" in Settings → Vault';
    }
    try {
      await client.healthCheck();
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  return null;
}

/**
 * Run health checks on all configured data sources.
 * Called on server startup and on-demand via GraphQL.
 * Updates in-memory status — doesn't mutate the config file.
 */
export async function runHealthChecks(): Promise<void> {
  const configs = await loadConfigs();
  let healthy = 0;
  let errors = 0;

  for (const config of configs) {
    if (!config.enabled) {
      healthStatus.set(config.id, { status: 'ACTIVE' });
      continue;
    }

    const error = await checkSource(config);
    if (error) {
      healthStatus.set(config.id, { status: 'ERROR', lastError: error });
      errors++;
    } else {
      healthStatus.set(config.id, { status: 'ACTIVE' });
      healthy++;
    }
  }

  logger.info(`Health check complete: ${healthy} healthy, ${errors} error(s)`);
}

/** GraphQL resolver — re-run health checks on demand. */
export async function checkDataSourceHealthResolver(): Promise<DataSource[]> {
  await runHealthChecks();
  const configs = await loadConfigs();
  return configs.map(configToDataSource);
}

/** GraphQL resolver — check if CLI commands are available on the system. */
export async function checkCliCommandsResolver(
  _parent: unknown,
  args: { commands: string[] },
): Promise<{ command: string; available: boolean }[]> {
  return Promise.all(
    args.commands.map(async (command) => {
      try {
        await runExec('which', [command]);
        return { command, available: true };
      } catch {
        return { command, available: false };
      }
    }),
  );
}
