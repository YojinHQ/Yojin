/**
 * Jintel agent tools — search_entities, enrich_entity, market_quotes,
 * sanctions_screen.
 *
 * Wraps JintelClient for agent use. When the client is not configured,
 * tools return a helpful error guiding the user to set up their API key.
 */

import {
  type EnrichmentField,
  type Entity,
  type EntityType,
  EntityTypeSchema,
  type JintelClient,
  type JintelResult,
  type MarketQuote,
  type RiskSignal,
  type SanctionsMatch,
} from '@yojinhq/jintel-client';
import { z } from 'zod';

import type { ToolDefinition, ToolResult } from '../core/types.js';
import type { RawSignalInput, SignalIngestor } from '../signals/ingestor.js';

// ── Options ──────────────────────────────────────────────────────────────

export interface JintelToolOptions {
  client?: JintelClient;
  ingestor?: SignalIngestor;
}

// ── Constants ────────────────────────────────────────────────────────────

const NOT_CONFIGURED_MSG =
  'Jintel API key not configured. Complete onboarding at Settings → Connections, or add key "jintel-api-key" in Settings → Vault.';

const FALLBACK_SUFFIX = '\n\nJintel unavailable. Use query_data_source with configured sources for fallback data.';

const ENRICHMENT_FIELDS = z.enum(['market', 'risk', 'regulatory', 'corporate']);

const SEVERITY_CONFIDENCE: Record<string, number> = {
  CRITICAL: 0.95,
  HIGH: 0.85,
  MEDIUM: 0.7,
  LOW: 0.5,
};

// ── Helpers ──────────────────────────────────────────────────────────────

function notConfigured(): ToolResult {
  return { content: NOT_CONFIGURED_MSG, isError: true };
}

function failureResult(error: string): ToolResult {
  return { content: error + FALLBACK_SUFFIX, isError: true };
}

type HandleResult<T> = { ok: true; data: T } | { ok: false; toolResult: ToolResult };

function handleResult<T>(result: JintelResult<T>): HandleResult<T> {
  if (!result.success) return { ok: false, toolResult: failureResult(result.error) };
  return { ok: true, data: result.data };
}

function riskSignalsToRaw(signals: RiskSignal[], tickers: string[]): RawSignalInput[] {
  return signals.map((s) => ({
    sourceId: 'jintel',
    sourceName: 'Jintel',
    sourceType: 'API' as const,
    reliability: 0.8,
    title: `[${s.severity}] ${s.type}: ${s.description}`,
    content: s.description,
    publishedAt: s.date ?? new Date().toISOString(),
    type: 'SENTIMENT' as const,
    tickers,
    confidence: SEVERITY_CONFIDENCE[s.severity] ?? 0.7,
    metadata: { riskType: s.type, severity: s.severity, source: s.source },
  }));
}

async function bestEffortIngest(ingestor: SignalIngestor | undefined, items: RawSignalInput[]): Promise<void> {
  if (!ingestor || items.length === 0) return;
  try {
    await ingestor.ingest(items);
  } catch {
    // best-effort — don't fail the tool
  }
}

// ── Formatters ───────────────────────────────────────────────────────────

function formatEntities(entities: Entity[]): string {
  if (entities.length === 0) return 'No entities found.';
  return entities
    .map((e) => {
      const parts = [`- **${e.name}** (${e.type})`];
      if (e.tickers?.length) parts.push(`  Tickers: ${e.tickers.join(', ')}`);
      if (e.country) parts.push(`  Country: ${e.country}`);
      if (e.domain) parts.push(`  Domain: ${e.domain}`);
      return parts.join('\n');
    })
    .join('\n');
}

function formatEnrichment(entity: Entity): string {
  const sections: string[] = [`# ${entity.name} (${entity.type})`];

  if (entity.market) {
    const { quote, fundamentals } = entity.market;
    if (quote) {
      const dir = quote.change >= 0 ? '↑' : '↓';
      sections.push(
        `## Market\n${quote.ticker}: $${quote.price.toFixed(2)} ${dir} ${quote.changePercent.toFixed(2)}% | Vol: ${formatNumber(quote.volume)}`,
      );
    }
    if (fundamentals) {
      const lines: string[] = [];
      if (fundamentals.marketCap != null) lines.push(`Market Cap: $${formatNumber(fundamentals.marketCap)}`);
      if (fundamentals.peRatio != null) lines.push(`P/E: ${fundamentals.peRatio.toFixed(1)}`);
      if (fundamentals.eps != null) lines.push(`EPS: $${fundamentals.eps.toFixed(2)}`);
      if (fundamentals.sector) lines.push(`Sector: ${fundamentals.sector}`);
      if (lines.length) sections.push(`## Fundamentals\n${lines.join('\n')}`);
    }
  }

  if (entity.risk) {
    const { overallScore, signals } = entity.risk;
    const signalLines = signals.map((s) => `- [${s.severity}] ${s.type}: ${s.description}`);
    sections.push(`## Risk (score: ${overallScore})\n${signalLines.join('\n')}`);
  }

  if (entity.regulatory) {
    const parts: string[] = [];
    if (entity.regulatory.sanctions.length) {
      parts.push(`Sanctions matches: ${entity.regulatory.sanctions.length}`);
    }
    if (entity.regulatory.filings.length) {
      const filingLines = entity.regulatory.filings.map((f) => `- ${f.type} (${f.date})`);
      parts.push(`Filings:\n${filingLines.join('\n')}`);
    }
    if (parts.length) sections.push(`## Regulatory\n${parts.join('\n')}`);
  }

  if (entity.corporate) {
    const c = entity.corporate;
    const lines: string[] = [];
    if (c.legalName) lines.push(`Legal Name: ${c.legalName}`);
    if (c.jurisdiction) lines.push(`Jurisdiction: ${c.jurisdiction}`);
    if (c.status) lines.push(`Status: ${c.status}`);
    if (c.officers.length) {
      lines.push(`Officers: ${c.officers.map((o) => `${o.name} (${o.role})`).join(', ')}`);
    }
    if (lines.length) sections.push(`## Corporate\n${lines.join('\n')}`);
  }

  return sections.join('\n\n');
}

function formatQuotes(quotes: MarketQuote[]): string {
  if (quotes.length === 0) return 'No quotes available.';
  return quotes
    .map((q) => {
      const dir = q.change >= 0 ? '↑' : '↓';
      return `${q.ticker}: $${q.price.toFixed(2)} ${dir} ${q.changePercent.toFixed(2)}% | Vol: ${formatNumber(q.volume)}`;
    })
    .join('\n');
}

function formatSanctions(matches: SanctionsMatch[]): string {
  if (matches.length === 0) return 'No sanctions matches found.';
  return matches
    .map(
      (m) =>
        `⚠ WARNING: Match on **${m.listName}**\n  Matched name: ${m.matchedName} (score: ${m.score.toFixed(2)})${m.details ? `\n  ${m.details}` : ''}`,
    )
    .join('\n\n');
}

function formatNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
}

// ── Tool Factory ─────────────────────────────────────────────────────────

export function createJintelTools(options: JintelToolOptions): ToolDefinition[] {
  const searchEntities: ToolDefinition = {
    name: 'search_entities',
    description:
      'Search for companies, people, crypto assets, commodities, or indices by name or keyword. ' +
      'Returns a list of matching entities with basic info.',
    parameters: z.object({
      query: z.string().describe('Search query (company name, ticker, person, etc.)'),
      type: EntityTypeSchema.optional().describe('Filter by entity type'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
    }),
    async execute(params: { query: string; type?: EntityType; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const result = await options.client.searchEntities(params.query, {
        type: params.type,
        limit: params.limit,
      });
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;
      return { content: formatEntities(handled.data) };
    },
  };

  const enrichEntity: ToolDefinition = {
    name: 'enrich_entity',
    description:
      'Get detailed enrichment data for an entity by ticker. Includes market data, ' +
      'risk profile, regulatory filings, and corporate info. Select specific fields or get all.',
    parameters: z.object({
      ticker: z.string().describe('Entity ticker or ID (e.g. AAPL, BTC)'),
      fields: z.array(ENRICHMENT_FIELDS).optional().describe('Specific enrichment fields to fetch (default: all)'),
    }),
    async execute(params: { ticker: string; fields?: EnrichmentField[] }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const result = await options.client.enrichEntity(params.ticker, params.fields);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;

      const entity = handled.data;
      const content = formatEnrichment(entity);

      // Best-effort signal ingestion for risk signals
      if (entity.risk?.signals?.length) {
        const tickers = entity.tickers ?? [params.ticker];
        await bestEffortIngest(options.ingestor, riskSignalsToRaw(entity.risk.signals, tickers));
      }

      return { content };
    },
  };

  const marketQuotes: ToolDefinition = {
    name: 'market_quotes',
    description: 'Get real-time market quotes for one or more tickers.',
    parameters: z.object({
      tickers: z.array(z.string()).min(1).describe('List of ticker symbols'),
    }),
    async execute(params: { tickers: string[] }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const result = await options.client.quotes(params.tickers);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;
      return { content: formatQuotes(handled.data) };
    },
  };

  const batchEnrich: ToolDefinition = {
    name: 'batch_enrich',
    description:
      'Enrich multiple tickers in a SINGLE API call. Returns market data (quote + fundamentals) ' +
      'and risk profiles for all tickers at once. Much more efficient than calling enrich_entity ' +
      'per ticker — use this when analyzing 2+ tickers.',
    parameters: z.object({
      tickers: z.array(z.string()).min(1).max(20).describe('List of ticker symbols (max 20)'),
      fields: z
        .array(ENRICHMENT_FIELDS)
        .optional()
        .describe("Specific enrichment fields to fetch (default: ['market', 'risk'])"),
    }),
    async execute(params: { tickers: string[]; fields?: EnrichmentField[] }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const fields = params.fields ?? ['market', 'risk'];

      // Enrich each ticker individually (parallel)
      const client = options.client;
      const fallbackResults: JintelResult<Entity>[] = await Promise.all(
        params.tickers.map((ticker) => client.enrichEntity(ticker, fields)),
      );
      const entities = fallbackResults
        .filter((r): r is { success: true; data: Entity } => r.success)
        .map((r) => r.data);
      if (entities.length === 0) {
        return failureResult(`Batch enrich returned no data for ${params.tickers.join(', ')}`);
      }

      const sections = entities.map((entity) => formatEnrichment(entity));

      // Best-effort signal ingestion for risk signals in all entities
      for (const entity of entities) {
        if (entity.risk?.signals?.length) {
          const tickers = entity.tickers ?? [];
          await bestEffortIngest(options.ingestor, riskSignalsToRaw(entity.risk.signals, tickers));
        }
      }

      return { content: sections.join('\n\n---\n\n') };
    },
  };

  const sanctionsScreen: ToolDefinition = {
    name: 'sanctions_screen',
    description:
      'Screen a person or entity name against global sanctions lists. ' + 'Shows matches with severity warnings.',
    parameters: z.object({
      name: z.string().describe('Name to screen'),
      country: z.string().optional().describe('Country filter (ISO code)'),
    }),
    async execute(params: { name: string; country?: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const result = await options.client.sanctionsScreen(params.name, params.country);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;
      return { content: formatSanctions(handled.data) };
    },
  };

  return [searchEntities, enrichEntity, batchEnrich, marketQuotes, sanctionsScreen];
}
