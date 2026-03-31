/**
 * DataSourceRegistry — manages data source plugins and resolves capability queries.
 *
 * When the Research Analyst needs data, it queries by capability (e.g. "web-search").
 * The registry finds all enabled sources that provide that capability, sorted by priority,
 * and tries them in order with fallback on failure.
 *
 * Supports both synchronous queries and async jobs (crawls, dataset collection).
 */

import type {
  DataQuery,
  DataResult,
  DataSourceConfig,
  DataSourcePlugin,
  HealthCheckResult,
  JobHandle,
  JobStatus,
} from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('data-source-registry');

export class DataSourceRegistry {
  private sources = new Map<string, DataSourcePlugin>();

  /** Register a data source plugin. */
  register(plugin: DataSourcePlugin): void {
    if (this.sources.has(plugin.id)) {
      throw new Error(`Data source "${plugin.id}" is already registered`);
    }
    this.sources.set(plugin.id, plugin);
    logger.info('Data source registered', {
      id: plugin.id,
      type: plugin.type,
      capabilities: plugin.capabilities.map((c) => c.id),
    });
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
   * Synchronous query — tries sources in priority order with fallback.
   *
   * @returns DataResult from the first source that succeeds
   * @throws Error if no source can fulfill the query
   */
  async query(request: DataQuery): Promise<DataResult> {
    const candidates = this.getByCapability(request.capability);

    if (candidates.length === 0) {
      logger.warn('No data source for capability', { capability: request.capability });
      throw new Error(`No data source provides capability "${request.capability}"`);
    }

    const errors: Array<{ sourceId: string; error: string }> = [];

    logger.debug('Querying data sources', { capability: request.capability, candidates: candidates.map((c) => c.id) });
    for (const source of candidates) {
      try {
        const result = await source.query(request);
        logger.debug('Data source query succeeded', { sourceId: source.id, capability: request.capability });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ sourceId: source.id, error: message });
        logger.warn('Data source query failed, trying next', { sourceId: source.id, error: message });
      }
    }

    logger.error('All data sources failed', { capability: request.capability, errors });
    throw new Error(
      `All data sources failed for capability "${request.capability}": ${errors
        .map((e) => `${e.sourceId}: ${e.error}`)
        .join('; ')}`,
    );
  }

  /**
   * Start an async job on the highest-priority source that supports it.
   *
   * @returns JobHandle from the first source that supports async and succeeds
   * @throws Error if no async-capable source is available
   */
  async startJob(request: DataQuery): Promise<JobHandle> {
    const candidates = this.getByCapability(request.capability).filter(
      (s): s is typeof s & { startJob: NonNullable<typeof s.startJob> } => !!s.startJob,
    );

    if (candidates.length === 0) {
      throw new Error(`No async-capable data source provides capability "${request.capability}"`);
    }

    const errors: Array<{ sourceId: string; error: string }> = [];

    for (const source of candidates) {
      try {
        return await source.startJob(request);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ sourceId: source.id, error: message });
      }
    }

    throw new Error(
      `All async sources failed for capability "${request.capability}": ${errors
        .map((e) => `${e.sourceId}: ${e.error}`)
        .join('; ')}`,
    );
  }

  /** Poll job status on the source that owns the job. */
  async getJobStatus(sourceId: string, jobId: string): Promise<JobStatus> {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Source "${sourceId}" not found`);
    }
    if (!source.getJobStatus) {
      throw new Error(`Source "${sourceId}" does not support async jobs`);
    }
    return source.getJobStatus(jobId);
  }

  /** Retrieve job results from the source that owns the job. */
  async getJobResult(sourceId: string, jobId: string): Promise<DataResult> {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Source "${sourceId}" not found`);
    }
    if (!source.getJobResult) {
      throw new Error(`Source "${sourceId}" does not support async jobs`);
    }
    return source.getJobResult(jobId);
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
  async initializeAll(configs: DataSourceConfig[]): Promise<string[]> {
    const skipped: string[] = [];

    for (const source of this.sources.values()) {
      const config = configs.find((c) => c.id === source.id);
      if (config) {
        if (config.config.type !== source.type) {
          throw new Error(
            `Config type mismatch for "${source.id}": plugin is "${source.type}" but config is "${config.config.type}"`,
          );
        }
        await source.initialize(config);
        logger.info('Data source initialized', { id: source.id, type: source.type });
      } else {
        skipped.push(source.id);
      }
    }

    if (skipped.length > 0) {
      logger.debug('Data sources skipped (no config)', { skipped });
    }

    return skipped;
  }

  /** Shut down all registered sources. */
  async shutdownAll(): Promise<void> {
    logger.info('Shutting down all data sources', { count: this.sources.size });
    await Promise.all(
      Array.from(this.sources.values()).map(async (source) => {
        try {
          await source.shutdown();
          logger.debug('Data source shut down', { id: source.id });
        } catch (err) {
          logger.warn('Data source shutdown failed', { id: source.id, error: String(err) });
        }
      }),
    );
  }
}
