/**
 * Jintel agent tools — search_entities, enrich_entity, market_quotes,
 * sanctions_screen, price_history, economy queries (GDP, inflation, rates, S&P 500).
 *
 * Wraps JintelClient for agent use. When the client is not configured,
 * tools return a helpful error guiding the user to set up their API key.
 */

import {
  type DerivativesData,
  type EconomicDataPoint,
  type EnrichmentField,
  type Entity,
  type EntityType,
  EntityTypeSchema,
  GDP,
  type GdpType,
  GdpTypeSchema,
  INFLATION,
  INTEREST_RATES,
  JintelAuthError,
  type JintelClient,
  type JintelResult,
  type MarketQuote,
  type NewsArticle,
  type ResearchResult,
  type RiskSignal,
  type SP500DataPoint,
  type SP500Series,
  SP500SeriesSchema,
  SP500_MULTIPLES,
  type SanctionsMatch,
  type SocialSentiment,
  type TickerPriceHistory,
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

const AUTH_ERROR_MSG =
  'Jintel rejected the API key (401 Unauthorized). The stored key may be revoked or mistyped — delete and re-add "jintel-api-key" in Settings → Vault.';

const FALLBACK_SUFFIX = '\n\nJintel unavailable. Use query_data_source with configured sources for fallback data.';

const ENRICHMENT_FIELDS = z.enum([
  'market',
  'risk',
  'regulatory',
  'technicals',
  'derivatives',
  'news',
  'research',
  'sentiment',
]);

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

function authError(): ToolResult {
  return { content: AUTH_ERROR_MSG, isError: true };
}

function failureResult(error: string): ToolResult {
  return { content: error + FALLBACK_SUFFIX, isError: true };
}

type HandleResult<T> = { ok: true; data: T } | { ok: false; toolResult: ToolResult };

function handleResult<T>(result: JintelResult<T>): HandleResult<T> {
  if (!result.success) return { ok: false, toolResult: failureResult(result.error) };
  return { ok: true, data: result.data };
}

/** Wraps an async client call with typed error handling. */
async function safeCall<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; toolResult: ToolResult }> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof JintelAuthError) return { ok: false, toolResult: authError() };
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, toolResult: failureResult(msg) };
  }
}

export function riskSignalsToRaw(signals: RiskSignal[], tickers: string[]): RawSignalInput[] {
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

  if (entity.technicals) {
    const t = entity.technicals;
    const lines: string[] = [];
    if (t.rsi != null) lines.push(`RSI(14): ${t.rsi.toFixed(1)}`);
    if (t.macd)
      lines.push(
        `MACD: ${t.macd.macd.toFixed(3)} | Signal: ${t.macd.signal.toFixed(3)} | Histogram: ${t.macd.histogram.toFixed(3)}`,
      );
    if (t.bollingerBands)
      lines.push(
        `Bollinger Bands: Lower ${t.bollingerBands.lower.toFixed(2)} | Middle ${t.bollingerBands.middle.toFixed(2)} | Upper ${t.bollingerBands.upper.toFixed(2)}`,
      );
    if (t.ema != null) lines.push(`EMA(10): ${t.ema.toFixed(2)}`);
    if (t.sma != null) lines.push(`SMA(50): ${t.sma.toFixed(2)}`);
    if (t.atr != null) lines.push(`ATR(14): ${t.atr.toFixed(2)}`);
    if (t.vwma != null) lines.push(`VWMA(20): ${t.vwma.toFixed(2)}`);
    if (t.mfi != null) lines.push(`MFI(14): ${t.mfi.toFixed(1)}`);
    if (lines.length) sections.push(`## Technicals\n${lines.join('\n')}`);
  }

  if (entity.news?.length) {
    const newsLines = entity.news.map((n) => `- [${n.source}] ${n.title} (${n.date})${n.link ? `\n  ${n.link}` : ''}`);
    sections.push(`## News\n${newsLines.join('\n')}`);
  }

  if (entity.research?.length) {
    const resLines = entity.research.map(
      (r) =>
        `- ${r.title}${r.author ? ` — ${r.author}` : ''}${r.publishedDate ? ` (${r.publishedDate})` : ''}${r.url ? `\n  ${r.url}` : ''}`,
    );
    sections.push(`## Research\n${resLines.join('\n')}`);
  }

  if (entity.sentiment) {
    const s = entity.sentiment;
    const rankDelta = s.rank24hAgo - s.rank;
    const rankDir = rankDelta > 0 ? `↑${rankDelta}` : rankDelta < 0 ? `↓${Math.abs(rankDelta)}` : '→';
    const mentionDelta = s.mentions - s.mentions24hAgo;
    const mentionDir = mentionDelta > 0 ? `+${mentionDelta}` : `${mentionDelta}`;
    sections.push(
      `## Social Sentiment\nRank: #${s.rank} (${rankDir} in 24h) | Mentions: ${s.mentions} (${mentionDir}) | Upvotes: ${s.upvotes}`,
    );
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

/** Macro queries are standalone constants — sort defensively to ensure newest-first. */
function formatEconomicData(data: EconomicDataPoint[], label: string): string {
  if (data.length === 0) return `No ${label} data available.`;
  const sorted = [...data].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const recent = sorted.slice(0, 20);
  const lines = recent.map(
    (d) => `${d.date}: ${d.value != null ? d.value.toFixed(2) : 'N/A'}${d.country ? ` (${d.country})` : ''}`,
  );
  return `# ${label}\n${lines.join('\n')}${sorted.length > 20 ? `\n\n... and ${sorted.length - 20} more data points` : ''}`;
}

/** Macro queries are standalone constants — sort defensively to ensure newest-first. */
function formatSP500Data(data: SP500DataPoint[]): string {
  if (data.length === 0) return 'No S&P 500 data available.';
  const sorted = [...data].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const recent = sorted.slice(0, 20);
  const lines = recent.map((d) => `${d.date}: ${d.value.toFixed(2)}`);
  return `# S&P 500 — ${sorted[0]?.name ?? 'Multiples'}\n${lines.join('\n')}${sorted.length > 20 ? `\n\n... and ${sorted.length - 20} more data points` : ''}`;
}

function formatPriceHistory(data: TickerPriceHistory[]): string {
  if (data.length === 0) return 'No price history available.';
  return data
    .map((th) => {
      if (th.history.length === 0) return `## ${th.ticker}\nNo data points.`;
      const lines = th.history.map(
        (h) =>
          `${h.date} | O:${h.open.toFixed(2)} H:${h.high.toFixed(2)} L:${h.low.toFixed(2)} C:${h.close.toFixed(2)} V:${formatNumber(h.volume)}`,
      );
      const first = th.history[0];
      const last = th.history[th.history.length - 1];
      const changePct = first.close !== 0 ? ((last.close - first.close) / first.close) * 100 : 0;
      const dir = changePct >= 0 ? '↑' : '↓';
      return (
        `## ${th.ticker} (${th.history.length} candles)\n` +
        `Period change: ${dir} ${changePct.toFixed(2)}% ($${first.close.toFixed(2)} → $${last.close.toFixed(2)})\n\n` +
        lines.join('\n')
      );
    })
    .join('\n\n');
}

function formatNews(articles: NewsArticle[]): string {
  if (articles.length === 0) return 'No news articles found.';
  return articles
    .map((a) => {
      const parts = [`- **${a.title}**`];
      parts.push(`  Source: ${a.source}${a.date ? ` | ${a.date}` : ''}`);
      if (a.snippet) parts.push(`  ${a.snippet}`);
      if (a.link) parts.push(`  ${a.link}`);
      return parts.join('\n');
    })
    .join('\n');
}

function formatResearch(reports: ResearchResult[]): string {
  if (reports.length === 0) return 'No research reports found.';
  return reports
    .map((r) => {
      const parts = [`- **${r.title}**${r.score ? ` (relevance: ${r.score.toFixed(2)})` : ''}`];
      if (r.author || r.publishedDate) {
        parts.push(`  ${[r.author, r.publishedDate].filter(Boolean).join(' — ')}`);
      }
      if (r.text) {
        const preview = r.text.length > 300 ? r.text.slice(0, 297) + '…' : r.text;
        parts.push(`  ${preview}`);
      }
      if (r.url) parts.push(`  ${r.url}`);
      return parts.join('\n');
    })
    .join('\n');
}

function formatSentiment(s: SocialSentiment): string {
  const rankDelta = s.rank24hAgo - s.rank;
  const rankDir = rankDelta > 0 ? `↑${rankDelta}` : rankDelta < 0 ? `↓${Math.abs(rankDelta)}` : '→';
  const mentionDelta = s.mentions - s.mentions24hAgo;
  const mentionDir = mentionDelta > 0 ? `+${mentionDelta}` : `${mentionDelta}`;

  const lines = [
    `# ${s.name} (${s.ticker}) — Social Sentiment`,
    `Rank: #${s.rank} (${rankDir} in 24h)`,
    `Mentions: ${s.mentions} (${mentionDir} in 24h)`,
    `Upvotes: ${s.upvotes}`,
  ];

  // Momentum interpretation
  if (rankDelta > 5) lines.push('\n📈 Strong upward momentum — rapidly gaining social attention');
  else if (rankDelta > 0) lines.push('\n📈 Positive momentum — gaining social attention');
  else if (rankDelta < -5) lines.push('\n📉 Declining momentum — losing social attention');
  else if (rankDelta < 0) lines.push('\n📉 Slight decline in social attention');

  return lines.join('\n');
}

function formatDerivatives(d: DerivativesData, ticker: string): string {
  const sections: string[] = [`# ${ticker} — Derivatives`];

  if (d.futures.length > 0) {
    const futureLines = d.futures.map(
      (f) => `  ${f.expiration}${f.price != null ? `: $${f.price.toFixed(2)}` : ''}${f.date ? ` (${f.date})` : ''}`,
    );
    sections.push(`## Futures Curve (${d.futures.length} contracts)\n${futureLines.join('\n')}`);
  }

  if (d.options.length > 0) {
    const calls = d.options.filter((o) => o.optionType === 'CALL');
    const puts = d.options.filter((o) => o.optionType === 'PUT');

    const formatOption = (o: DerivativesData['options'][number]) => {
      const parts = [`  $${o.strike.toFixed(2)} ${o.expiration}`];
      if (o.lastTradePrice != null) parts.push(`Last: $${o.lastTradePrice.toFixed(2)}`);
      if (o.bid != null && o.ask != null) parts.push(`Bid/Ask: $${o.bid.toFixed(2)}/$${o.ask.toFixed(2)}`);
      if (o.impliedVolatility != null) parts.push(`IV: ${(o.impliedVolatility * 100).toFixed(1)}%`);
      if (o.openInterest != null) parts.push(`OI: ${formatNumber(o.openInterest)}`);
      if (o.delta != null) parts.push(`Δ:${o.delta.toFixed(3)}`);
      return parts.join(' | ');
    };

    if (calls.length > 0) {
      sections.push(`## Calls (${calls.length})\n${calls.map(formatOption).join('\n')}`);
    }
    if (puts.length > 0) {
      sections.push(`## Puts (${puts.length})\n${puts.map(formatOption).join('\n')}`);
    }
  }

  if (d.futures.length === 0 && d.options.length === 0) {
    sections.push('No derivatives data available.');
  }

  return sections.join('\n\n');
}

export function formatNumber(n: number): string {
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
      return { content: formatEntities(handled.data as Entity[]) };
    },
  };

  const enrichEntity: ToolDefinition = {
    name: 'enrich_entity',
    description:
      'Get detailed enrichment data for an entity by ticker. Includes market data, ' +
      'risk profile, and regulatory filings. Select specific fields or get all.',
    parameters: z.object({
      ticker: z.string().describe('Entity ticker or ID (e.g. AAPL, BTC)'),
      fields: z.array(ENRICHMENT_FIELDS).optional().describe('Specific enrichment fields to fetch (default: all)'),
    }),
    async execute(params: { ticker: string; fields?: EnrichmentField[] }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const result = await options.client.enrichEntity(params.ticker, params.fields);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;

      const entity = handled.data as Entity;
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

      const result = await options.client.batchEnrich(params.tickers, fields);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;

      const entities = handled.data as Entity[];
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

  const runTechnical: ToolDefinition = {
    name: 'run_technical',
    description:
      'Fetch technical indicators for a ticker via Jintel technicals sub-graph. ' +
      'Returns RSI, MACD (with histogram), Bollinger Bands, EMA, SMA, ATR, VWMA, and MFI.\n\n' +
      'Interpretation guide:\n' +
      '- RSI > 70 = overbought, < 30 = oversold, 40-60 = neutral\n' +
      '- MACD histogram > 0 = bullish momentum, < 0 = bearish; crossover of MACD/signal line = trend change\n' +
      '- Price near BB upper = overbought/strong trend, near BB lower = oversold/weak; BB squeeze (narrow bands) = breakout imminent\n' +
      '- Price > SMA = uptrend, < SMA = downtrend; EMA reacts faster than SMA\n' +
      '- ATR rising = increasing volatility; ATR falling = consolidation\n' +
      '- MFI > 80 = overbought (with volume confirmation), < 20 = oversold\n' +
      '- VWMA > SMA = buying pressure, VWMA < SMA = selling pressure',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, BTC, ETH)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const result = await options.client.enrichEntity(params.ticker, ['technicals'] as EnrichmentField[]);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;

      const entity = handled.data as Entity;
      if (!entity.technicals) {
        return { content: `No technical indicators available for ${params.ticker}.` };
      }

      const t = entity.technicals;
      const lines: string[] = [`# ${entity.name ?? params.ticker} — Technical Indicators`];

      if (t.rsi != null) {
        const zone = t.rsi > 70 ? ' (OVERBOUGHT)' : t.rsi < 30 ? ' (OVERSOLD)' : '';
        lines.push(`RSI(14): ${t.rsi.toFixed(1)}${zone}`);
      }
      if (t.macd) {
        const momentum = t.macd.histogram >= 0 ? 'bullish' : 'bearish';
        lines.push(
          `MACD: ${t.macd.macd.toFixed(3)} | Signal: ${t.macd.signal.toFixed(3)} | Histogram: ${t.macd.histogram.toFixed(3)} (${momentum})`,
        );
      }
      if (t.bollingerBands) {
        lines.push(
          `Bollinger Bands: Lower ${t.bollingerBands.lower.toFixed(2)} | Middle ${t.bollingerBands.middle.toFixed(2)} | Upper ${t.bollingerBands.upper.toFixed(2)}`,
        );
      }
      if (t.ema != null) lines.push(`EMA(10): ${t.ema.toFixed(2)}`);
      if (t.sma != null) {
        const trend = entity.market?.quote
          ? entity.market.quote.price > t.sma
            ? 'above (uptrend)'
            : 'below (downtrend)'
          : '';
        lines.push(`SMA(50): ${t.sma.toFixed(2)}${trend ? ` — price ${trend}` : ''}`);
      }
      if (t.atr != null) lines.push(`ATR(14): ${t.atr.toFixed(2)}`);
      if (t.vwma != null) lines.push(`VWMA(20): ${t.vwma.toFixed(2)}`);
      if (t.mfi != null) {
        const zone = t.mfi > 80 ? ' (OVERBOUGHT)' : t.mfi < 20 ? ' (OVERSOLD)' : '';
        lines.push(`MFI(14): ${t.mfi.toFixed(1)}${zone}`);
      }

      return { content: lines.join('\n') };
    },
  };

  // ── Economy tools ──────────────────────────────────────────────────────

  const getGdp: ToolDefinition = {
    name: 'get_gdp',
    description:
      'Get GDP data for a country. Returns time series of GDP values. ' +
      'Useful for macro context when analyzing market conditions or country risk.',
    parameters: z.object({
      country: z.string().describe('Country name or ISO code (e.g. "United States", "US", "Germany")'),
      type: GdpTypeSchema.optional().describe('GDP type: REAL, NOMINAL, or FORECAST (default: REAL)'),
    }),
    async execute(params: { country: string; type?: GdpType }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() =>
        client.request<EconomicDataPoint[]>(GDP, {
          country: params.country,
          type: params.type,
        }),
      );
      if (!result.ok) return result.toolResult;
      return { content: formatEconomicData(result.data, `GDP — ${params.country}`) };
    },
  };

  const getInflation: ToolDefinition = {
    name: 'get_inflation',
    description:
      'Get inflation (CPI) data for a country. Returns time series of inflation values. ' +
      'Critical for understanding real returns and central bank policy direction.',
    parameters: z.object({
      country: z.string().describe('Country name or ISO code (e.g. "United States", "UK")'),
    }),
    async execute(params: { country: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() => client.request<EconomicDataPoint[]>(INFLATION, { country: params.country }));
      if (!result.ok) return result.toolResult;
      return { content: formatEconomicData(result.data, `Inflation — ${params.country}`) };
    },
  };

  const getInterestRates: ToolDefinition = {
    name: 'get_interest_rates',
    description:
      'Get central bank interest rate data for a country. Returns time series of rate decisions. ' +
      'Key for understanding monetary policy and its impact on equity/bond valuations.',
    parameters: z.object({
      country: z.string().describe('Country name or ISO code (e.g. "United States", "EU")'),
    }),
    async execute(params: { country: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() =>
        client.request<EconomicDataPoint[]>(INTEREST_RATES, { country: params.country }),
      );
      if (!result.ok) return result.toolResult;
      return { content: formatEconomicData(result.data, `Interest Rates — ${params.country}`) };
    },
  };

  const getSP500Multiples: ToolDefinition = {
    name: 'get_sp500_multiples',
    description:
      'Get S&P 500 valuation multiples over time. Available series:\n' +
      '- PE_MONTH: trailing P/E ratio\n' +
      '- SHILLER_PE_MONTH: cyclically-adjusted P/E (CAPE/Shiller PE)\n' +
      '- DIVIDEND_YIELD_MONTH: dividend yield\n' +
      '- EARNINGS_YIELD_MONTH: earnings yield (inverse of P/E)\n\n' +
      'Useful for gauging broad market valuation relative to historical norms.',
    parameters: z.object({
      series: SP500SeriesSchema.describe('Which valuation series to fetch'),
    }),
    async execute(params: { series: SP500Series }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() => client.request<SP500DataPoint[]>(SP500_MULTIPLES, { series: params.series }));
      if (!result.ok) return result.toolResult;
      return { content: formatSP500Data(result.data) };
    },
  };

  const priceHistory: ToolDefinition = {
    name: 'price_history',
    description:
      'Get historical OHLCV (open/high/low/close/volume) price data for one or more tickers.\n\n' +
      'Ranges: 1d, 5d, 1m, 3m, 6m, 1y, 2y, 5y, max\n' +
      'Intervals: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1W, 1M, 1Q\n\n' +
      'Use for price trend analysis, chart patterns, support/resistance levels, or comparing ' +
      'price performance across assets over a time period.',
    parameters: z.object({
      tickers: z
        .array(z.string())
        .min(1)
        .max(10)
        .describe('Ticker symbols to fetch history for (e.g. ["AAPL", "NVDA"])'),
      range: z.string().optional().describe('Time range (default "1y"). Options: 1d, 5d, 1m, 3m, 6m, 1y, 2y, 5y, max'),
      interval: z
        .string()
        .optional()
        .describe('Candle interval (default "1d"). Options: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1W, 1M, 1Q'),
    }),
    async execute(params: { tickers: string[]; range?: string; interval?: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() =>
        client.priceHistory(
          params.tickers.map((t) => t.toUpperCase()),
          params.range ?? '1y',
          params.interval,
        ),
      );
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      return { content: formatPriceHistory(handled.data) };
    },
  };

  const getNews: ToolDefinition = {
    name: 'get_news',
    description:
      'Get recent news articles for a ticker. Returns headlines, sources, snippets, and links.\n\n' +
      'Use when the user asks about recent news, events, or headlines for a specific stock or crypto asset.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, BTC, TSLA)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() =>
        client.enrichEntity(params.ticker.toUpperCase(), ['news'] as EnrichmentField[]),
      );
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;

      const entity = handled.data as Entity;
      if (!entity.news?.length) {
        return { content: `No recent news found for ${params.ticker}.` };
      }

      // Best-effort ingest news as signals
      if (options.ingestor) {
        const rawSignals: RawSignalInput[] = entity.news.map((a) => ({
          sourceId: 'jintel',
          sourceName: a.source || 'Jintel',
          sourceType: 'API' as const,
          reliability: 0.75,
          title: a.title,
          content: a.snippet || a.title,
          publishedAt: a.date ?? new Date(new Date().toISOString().slice(0, 10)).toISOString(),
          type: 'NEWS' as const,
          tickers: entity.tickers ?? [params.ticker.toUpperCase()],
          confidence: 0.7,
          metadata: { source: a.source, link: a.link },
        }));
        await bestEffortIngest(options.ingestor, rawSignals);
      }

      return { content: `# ${entity.name ?? params.ticker} — News\n\n${formatNews(entity.news)}` };
    },
  };

  const getResearch: ToolDefinition = {
    name: 'get_research',
    description:
      'Get analyst research reports for a ticker. Returns report titles, authors, publication dates, ' +
      'full text excerpts, relevance scores, and URLs.\n\n' +
      'Use when the user asks about analyst opinions, research coverage, or deep-dive analysis for an asset.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, BTC, NVDA)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() =>
        client.enrichEntity(params.ticker.toUpperCase(), ['research'] as EnrichmentField[]),
      );
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;

      const entity = handled.data as Entity;
      if (!entity.research?.length) {
        return { content: `No research reports found for ${params.ticker}.` };
      }

      return { content: `# ${entity.name ?? params.ticker} — Research\n\n${formatResearch(entity.research)}` };
    },
  };

  const getSentiment: ToolDefinition = {
    name: 'get_sentiment',
    description:
      'Get social sentiment metrics for a ticker. Returns social rank, mention count, upvotes, ' +
      'and 24-hour momentum.\n\n' +
      'Use when the user asks about social buzz, community sentiment, trending status, or ' +
      'retail investor attention for a stock or crypto.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, BTC, GME)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() =>
        client.enrichEntity(params.ticker.toUpperCase(), ['sentiment'] as EnrichmentField[]),
      );
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;

      const entity = handled.data as Entity;
      if (!entity.sentiment) {
        return { content: `No sentiment data available for ${params.ticker}.` };
      }

      return { content: formatSentiment(entity.sentiment) };
    },
  };

  const getDerivatives: ToolDefinition = {
    name: 'get_derivatives',
    description:
      'Get derivatives data (futures curve + options chain) for a ticker. Returns futures ' +
      'expiration/price and options with strike, type, delta, implied volatility, open interest, ' +
      'and bid/ask.\n\n' +
      'Primarily available for crypto assets. Use when the user asks about options flow, ' +
      'futures contango/backwardation, implied volatility, or derivatives positioning.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. BTC, ETH)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() =>
        client.enrichEntity(params.ticker.toUpperCase(), ['derivatives'] as EnrichmentField[]),
      );
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;

      const entity = handled.data as Entity;
      if (!entity.derivatives) {
        return { content: `No derivatives data available for ${params.ticker}.` };
      }

      return { content: formatDerivatives(entity.derivatives, entity.name ?? params.ticker) };
    },
  };

  return [
    searchEntities,
    enrichEntity,
    batchEnrich,
    marketQuotes,
    sanctionsScreen,
    runTechnical,
    priceHistory,
    getNews,
    getResearch,
    getSentiment,
    getDerivatives,
    getGdp,
    getInflation,
    getInterestRates,
    getSP500Multiples,
  ];
}
