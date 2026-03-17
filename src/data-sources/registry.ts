/**
 * DataSourceRegistry — manages data source plugins and resolves capability queries.
 *
 * When the Research Analyst needs data, it queries by capability (e.g. "equity-fundamentals").
 * The registry finds all enabled sources that provide that capability, sorted by priority,
 * and tries them in order with fallback on failure.
 */

import type {
  DataQuery,
  DataResult,
  DataSourceConfig,
  DataSourcePlugin,
  HealthCheckResult,
} from './types.js';

export class DataSourceRegistry {
  private sources = new Map<string, DataSourcePlugin>();

  /** Register a data source plugin. */
  register(plugin: DataSourcePlugin): void {
    if (this.sources.has(plugin.id)) {
      throw new Error(`Data source "${plugin.id}" is already registered`);
    }
    this.sources.set(plugin.id, plugin);
  }

  /** Unregister a data source plugin by id. */
  unregister(id: string): boolean {
    return this.sources.delete(id);
  }

  /** Get a specific source by id. */
  getSource(id: string): DataSourcePlugin | undefined {
    return this.sources.get(id);
  }

  /** Get all registered sources. */
  getSources(): DataSourcePlugin[] {
    return Array.from(this.sources.values());
  }

  /** Get all enabled sources that provide a given capability, sorted by priority (ascending). */
  getByCapability(capability: string): DataSourcePlugin[] {
    return Array.from(this.sources.values())
      .filter((s) => s.enabled && s.capabilities.some((c) => c.id === capability))
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Query for data by capability. Tries sources in priority order with fallback.
   *
   * @returns DataResult from the first source that succeeds
   * @throws Error if no source can fulfill the query
   */
  async query(request: DataQuery): Promise<DataResult> {
    const candidates = this.getByCapability(request.capability);

    if (candidates.length === 0) {
      throw new Error(`No data source provides capability "${request.capability}"`);
    }

    const errors: Array<{ sourceId: string; error: string }> = [];

    for (const source of candidates) {
      try {
        return await source.query(request);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ sourceId: source.id, error: message });
      }
    }

    throw new Error(
      `All data sources failed for capability "${request.capability}": ${errors
        .map((e) => `${e.sourceId}: ${e.error}`)
        .join('; ')}`,
    );
  }

  /** Run health checks on all registered sources. */
  async healthCheckAll(): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>();

    await Promise.all(
      Array.from(this.sources.values()).map(async (source) => {
        try {
          results.set(source.id, await source.healthCheck());
        } catch (err) {
          results.set(source.id, {
            healthy: false,
            latencyMs: -1,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );

    return results;
  }

  /** Initialize all registered sources with their configs. */
  async initializeAll(configs: DataSourceConfig[]): Promise<void> {
    for (const source of this.sources.values()) {
      const config = configs.find((c) => c.id === source.id);
      if (config) {
        await source.initialize(config);
      }
    }
  }

  /** Shut down all registered sources. */
  async shutdownAll(): Promise<void> {
    await Promise.all(
      Array.from(this.sources.values()).map(async (source) => {
        try {
          await source.shutdown();
        } catch {
          // Best-effort shutdown — don't let one failure block others
        }
      }),
    );
  }
}
