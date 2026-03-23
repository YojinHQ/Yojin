import {
  BATCH_QUOTES,
  NEWS_SEARCH,
  SANCTIONS_SCREEN,
  SEARCH_ENTITIES,
  WEB_SEARCH,
  buildEnrichQuery,
} from './queries.js';
import type {
  EnrichmentField,
  Entity,
  GraphQLResponse,
  JintelClientConfig,
  MarketQuote,
  NewsArticle,
  SanctionsMatch,
  WebResult,
} from './types.js';
import { ALL_ENRICHMENT_FIELDS, GraphQLResponseSchema } from './types.js';
import { createSubsystemLogger } from '../logging/index.js';

// ── Error Classes ─────────────────────────────────────────────────────────

export class JintelError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'JintelError';
    this.code = code;
  }
}

export class JintelAuthError extends JintelError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR');
    this.name = 'JintelAuthError';
  }
}

export class JintelUnreachableError extends JintelError {
  constructor(message: string) {
    super(message, 'UNREACHABLE');
    this.name = 'JintelUnreachableError';
  }
}

// ── Result Type ───────────────────────────────────────────────────────────

export type JintelResult<T> = { success: true; data: T } | { success: false; error: string };

// ── Client ────────────────────────────────────────────────────────────────

const logger = createSubsystemLogger('jintel-client');

export class JintelClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly debug: boolean;

  constructor(config: JintelClientConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30_000;
    this.debug = config.debug ?? false;
  }

  // ── Private Methods ───────────────────────────────────────────────────

  private async execute(query: string, variables?: Record<string, unknown>): Promise<GraphQLResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.debug) {
      headers['X-Debug'] = 'true';
    }

    const response = await fetch(`${this.baseUrl}/graphql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (response.status === 401) {
      throw new JintelAuthError('Authentication failed: invalid or expired API key');
    }

    if (!response.ok) {
      throw new JintelError(`HTTP ${response.status}: ${response.statusText}`, `HTTP_${response.status}`);
    }

    const json: unknown = await response.json();
    const parsed = GraphQLResponseSchema.parse(json);

    if (parsed.errors?.length) {
      const firstError = parsed.errors[0];
      const code = firstError.extensions?.code;
      if (code === 'UNAUTHENTICATED') {
        throw new JintelAuthError(firstError.message);
      }
      throw new JintelError(firstError.message, code ?? undefined);
    }

    return parsed;
  }

  private extractData<T>(response: GraphQLResponse, key: string): T | null {
    const data = response.data as Record<string, unknown> | null;
    if (!data || !(key in data)) {
      return null;
    }
    return data[key] as T;
  }

  private handleError<T>(err: unknown): JintelResult<T> {
    if (err instanceof JintelAuthError) {
      logger.warn('Jintel auth error', { error: err.message });
      return { success: false, error: err.message };
    }
    if (err instanceof JintelError) {
      logger.error('Jintel error', { error: err.message, code: err.code });
      return { success: false, error: err.message };
    }
    if (err instanceof TypeError) {
      const msg = `Jintel API unreachable: ${err.message}`;
      logger.error(msg);
      return { success: false, error: msg };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Unexpected Jintel error', { error: msg });
    return { success: false, error: msg };
  }

  // ── Public Methods ────────────────────────────────────────────────────

  async searchEntities(query: string, options?: { type?: string; limit?: number }): Promise<JintelResult<Entity[]>> {
    try {
      const variables: Record<string, unknown> = { query };
      if (options?.type) variables.type = options.type;
      if (options?.limit != null) variables.limit = options.limit;

      const response = await this.execute(SEARCH_ENTITIES, variables);
      const entities = this.extractData<Entity[]>(response, 'searchEntities');
      return { success: true, data: entities ?? [] };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async enrichEntity(ticker: string, fields?: EnrichmentField[]): Promise<JintelResult<Entity>> {
    try {
      const selectedFields = fields ?? ALL_ENRICHMENT_FIELDS;
      const query = buildEnrichQuery(selectedFields);
      const response = await this.execute(query, { id: ticker });
      const entity = this.extractData<Entity>(response, 'entity');
      if (!entity) {
        return { success: false, error: `Entity not found: ${ticker}` };
      }
      return { success: true, data: entity };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async quotes(tickers: string[]): Promise<JintelResult<MarketQuote[]>> {
    try {
      const response = await this.execute(BATCH_QUOTES, { tickers });
      const quotes = this.extractData<MarketQuote[]>(response, 'batchQuotes');
      return { success: true, data: quotes ?? [] };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async newsSearch(query: string, limit?: number): Promise<JintelResult<NewsArticle[]>> {
    try {
      const variables: Record<string, unknown> = { query };
      if (limit != null) variables.limit = limit;

      const response = await this.execute(NEWS_SEARCH, variables);
      const articles = this.extractData<NewsArticle[]>(response, 'newsSearch');
      return { success: true, data: articles ?? [] };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async sanctionsScreen(name: string, country?: string): Promise<JintelResult<SanctionsMatch[]>> {
    try {
      const variables: Record<string, unknown> = { name };
      if (country) variables.country = country;

      const response = await this.execute(SANCTIONS_SCREEN, variables);
      const matches = this.extractData<SanctionsMatch[]>(response, 'sanctionsScreen');
      return { success: true, data: matches ?? [] };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async webSearch(query: string, limit?: number): Promise<JintelResult<WebResult[]>> {
    try {
      const variables: Record<string, unknown> = { query };
      if (limit != null) variables.limit = limit;

      const response = await this.execute(WEB_SEARCH, variables);
      const results = this.extractData<WebResult[]>(response, 'webSearch');
      return { success: true, data: results ?? [] };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.execute('{ __typename }');
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { healthy: false, latencyMs: Date.now() - start, error: msg };
    }
  }
}
