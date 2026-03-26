/**
 * CLI adapter — implements DataSourcePlugin for command-line data sources.
 *
 * Spawns a subprocess, captures JSON/CSV output, and returns standardized
 * DataResult envelopes.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { runCli } from '../../core/run-cli.js';
import type { EncryptedVault } from '../../trust/vault/vault.js';
import type {
  DataQuery,
  DataResult,
  DataSourceCapability,
  DataSourceConfig,
  DataSourcePlugin,
  DataSourceType,
  HealthCheckResult,
} from '../types.js';

const which = promisify(execFile);

export interface CliAdapterOptions {
  vault?: EncryptedVault;
}

export class CliAdapter implements DataSourcePlugin {
  readonly id: string;
  readonly name: string;
  readonly type: DataSourceType = 'cli';
  readonly capabilities: DataSourceCapability[];
  enabled: boolean;
  priority: number;

  private command = '';
  private args: string[] = [];
  private timeout = 30_000;
  private envOverrides: Record<string, string> = {};
  private secretRef?: string;
  private readonly vault?: EncryptedVault;

  constructor(config: DataSourceConfig, options: CliAdapterOptions = {}) {
    this.id = config.id;
    this.name = config.name;
    this.capabilities = config.capabilities;
    this.enabled = config.enabled;
    this.priority = config.priority;
    this.vault = options.vault;
  }

  async initialize(config: DataSourceConfig): Promise<void> {
    if (config.config.type !== 'cli') {
      throw new Error(`CliAdapter requires CLI config, got "${config.config.type}"`);
    }
    this.command = config.config.command;
    this.args = config.config.args;
    this.timeout = config.config.timeout;
    this.envOverrides = config.config.env;
  }

  async query(request: DataQuery): Promise<DataResult> {
    if (!this.command) {
      throw new Error(`Data source "${this.name}" has no command configured`);
    }

    const start = Date.now();
    const cmdArgs = [...this.args];

    if (request.prompt) {
      cmdArgs.push('--query', request.prompt);
    } else if (request.url) {
      cmdArgs.push(request.url);
    }

    const env: Record<string, string> = { ...(process.env as Record<string, string>), ...this.envOverrides };

    // Resolve API key from vault if needed
    if (this.secretRef) {
      const key = await this.resolveApiKey();
      if (key) env[this.secretRef] = key;
    }

    const { stdout } = await runCli(this.command, cmdArgs, {
      timeout: this.timeout,
      maxBuffer: 10 * 1024 * 1024,
      env,
    });

    const output = stdout.trim();
    if (!output) {
      throw new Error('Command returned empty output');
    }

    let data: unknown;
    try {
      data = JSON.parse(output);
    } catch {
      data = output;
    }

    const latencyMs = Date.now() - start;

    return {
      sourceId: this.id,
      capability: request.capability,
      data,
      metadata: {
        fetchedAt: new Date().toISOString(),
        latencyMs,
        cached: false,
      },
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.command) {
      return { healthy: false, latencyMs: 0, error: 'No command configured' };
    }

    const start = Date.now();
    try {
      await which('which', [this.command]);
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: `"${this.command}" is not installed`,
      };
    }
  }

  async shutdown(): Promise<void> {
    // No persistent state to clean up
  }

  private async resolveApiKey(): Promise<string | undefined> {
    if (!this.secretRef) return undefined;
    if (!this.vault?.isUnlocked) return undefined;
    try {
      return (await this.vault.get(this.secretRef)) ?? undefined;
    } catch {
      return undefined;
    }
  }
}
