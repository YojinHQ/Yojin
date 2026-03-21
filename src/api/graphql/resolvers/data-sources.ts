/**
 * Data source resolvers — listDataSources, addDataSource, removeDataSource,
 * toggleDataSource.
 *
 * Module-level state pattern: setDataSourceConfig is called once during
 * server startup to inject the config path and registry.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createSubsystemLogger } from '../../../logging/logger.js';

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
}

interface DataSourceConfig {
  id: string;
  name: string;
  type: 'CLI' | 'MCP' | 'API';
  capabilities: string[];
  enabled: boolean;
  priority: number;
  baseUrl?: string;
  secretRef?: string;
  command?: string;
  args?: string[];
}

interface DataSourceResult {
  success: boolean;
  dataSource?: DataSource;
  error?: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let configPath = 'data/config/data-sources.json';

export function setDataSourceConfigPath(path: string): void {
  configPath = path;
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

async function loadConfigs(): Promise<DataSourceConfig[]> {
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as DataSourceConfig[];
  } catch {
    return [];
  }
}

async function saveConfigs(configs: DataSourceConfig[]): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(configs, null, 2) + '\n', 'utf-8');
}

function configToDataSource(config: DataSourceConfig): DataSource {
  return {
    id: config.id,
    name: config.name,
    type: config.type,
    capabilities: config.capabilities.map((id) => ({ id })),
    enabled: config.enabled,
    status: config.enabled ? 'ACTIVE' : 'DISABLED',
    priority: config.priority,
  };
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function listDataSourcesResolver(): Promise<DataSource[]> {
  const configs = await loadConfigs();
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

  const config: DataSourceConfig = {
    id: input.id,
    name: input.name,
    type: input.type,
    capabilities: input.capabilities,
    enabled: input.enabled ?? true,
    priority: input.priority ?? 10,
    baseUrl: input.baseUrl,
    secretRef: input.secretRef,
    command: input.command,
    args: input.args,
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

  config.enabled = args.enabled;
  await saveConfigs(configs);
  logger.info(`${args.enabled ? 'Enabled' : 'Disabled'} data source: ${args.id}`);

  return { success: true, dataSource: configToDataSource(config) };
}
