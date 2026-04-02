/**
 * API adapter — implements DataSourcePlugin for REST/GraphQL API data sources.
 *
 * Handles authentication via vault secret refs, makes HTTP requests,
 * and returns standardized DataResult envelopes.
 */

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

interface ApiAdapterOptions {
  vault?: EncryptedVault;
  /** Optional custom health check — used for Jintel to delegate to JintelClient. */
  healthCheckFn?: () => Promise<HealthCheckResult>;
}

export class ApiAdapter implements DataSourcePlugin {
  readonly id: string;
  readonly name: string;
  readonly type: DataSourceType = 'api';
  readonly capabilities: DataSourceCapability[];
  enabled: boolean;
  priority: number;

  private baseUrl = '';
  private secretRef?: string;
  private authHeader = 'Authorization';
  private authPrefix = 'Bearer';
  private readonly vault?: EncryptedVault;
  private readonly customHealthCheck?: () => Promise<HealthCheckResult>;

  constructor(config: DataSourceConfig, options: ApiAdapterOptions = {}) {
    this.id = config.id;
    this.name = config.name;
    this.capabilities = config.capabilities;
    this.enabled = config.enabled;
    this.priority = config.priority;
    this.vault = options.vault;
    this.customHealthCheck = options.healthCheckFn;
  }

  async initialize(config: DataSourceConfig): Promise<void> {
    if (config.config.type !== 'api') {
      throw new Error(`ApiAdapter requires API config, got "${config.config.type}"`);
    }
    this.baseUrl = config.config.baseUrl;
    this.secretRef = config.config.secretRef;
    this.authHeader = config.config.authHeader;
    this.authPrefix = config.config.authPrefix;
  }

  async query(request: DataQuery): Promise<DataResult> {
    const start = Date.now();
    const apiKey = await this.resolveApiKey();

    const endpoint = `${this.baseUrl}/search`;
    const body: Record<string, unknown> = { ...request.params };
    if (request.symbol) body.symbol = request.symbol;
    if (request.prompt) body.query = request.prompt;
    if (request.url) body.url = request.url;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (apiKey) {
      headers[this.authHeader] = `${this.authPrefix} ${apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`API returned ${response.status}: ${text.slice(0, 200)}`);
    }

    const data: unknown = await response.json();
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
    if (this.customHealthCheck) {
      return this.customHealthCheck();
    }

    const start = Date.now();
    try {
      const apiKey = await this.resolveApiKey();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) {
        headers[this.authHeader] = `${this.authPrefix} ${apiKey}`;
      }

      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return { healthy: false, latencyMs, error: `HTTP ${response.status}` };
      }

      return { healthy: true, latencyMs };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async shutdown(): Promise<void> {
    // No persistent connections to clean up
  }

  private async resolveApiKey(): Promise<string | undefined> {
    if (!this.secretRef) return undefined;
    if (!this.vault?.isUnlocked) {
      throw new Error(`Vault is locked — "${this.name}" requires API key "${this.secretRef}"`);
    }
    const secret = await this.vault.get(this.secretRef);
    if (!secret) {
      throw new Error(`API key "${this.secretRef}" not found in vault`);
    }
    return secret;
  }
}
