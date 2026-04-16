/**
 * Jintel agent tools — search_entities, enrich_entity, market_quotes,
 * sanctions_screen, price_history, economy queries (GDP, inflation, rates, S&P 500).
 *
 * Wraps JintelClient for agent use. When the client is not configured,
 * tools return a helpful error guiding the user to set up their API key.
 */

import {
  type ArraySubGraphOptions,
  type DerivativesData,
  type EconomicDataPoint,
  type EnrichmentField,
  type Entity,
  type EntityType,
  EntityTypeSchema,
  type FactorDataPoint,
  type FamaFrenchSeries,
  FamaFrenchSeriesSchema,
  GDP,
  type GdpType,
  GdpTypeSchema,
  type HackerNewsStory,
  INFLATION,
  INTEREST_RATES,
  type InstitutionalHolding,
  JintelAuthError,
  type JintelClient,
  type JintelResult,
  type MarketQuote,
  type NewsArticle,
  type OwnershipBreakdown,
  type PredictionMarket,
  type ResearchResult,
  type RiskSignal,
  type SP500DataPoint,
  type SP500Series,
  SP500SeriesSchema,
  SP500_MULTIPLES,
  type SanctionsMatch,
  type ShortInterestReport,
  type Social,
  type SocialSentiment,
  type TickerPriceHistory,
  type TopHolder,
  buildEnrichQuery,
} from '@yojinhq/jintel-client';
import { z } from 'zod';

import { isShortInterestFresh } from './freshness.js';
import type { FinancialStatements, KeyExecutive, RedditComment } from './types.js';
import type { Position } from '../api/graphql/types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';
import type { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';
import type { RawSignalInput, SignalIngestor } from '../signals/ingestor.js';
import { SignalTypeSchema, SourceTypeSchema } from '../signals/types.js';

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

// ── Options ──────────────────────────────────────────────────────────────

export interface JintelToolOptions {
  client?: JintelClient;
  ingestor?: SignalIngestor;
  snapshotStore?: PortfolioSnapshotStore;
}

// ── Enum aliases ─────────────────────────────────────────────────────────

const SignalType = SignalTypeSchema.enum;
const SourceType = SourceTypeSchema.enum;

// ── Constants ────────────────────────────────────────────────────────────

const NOT_CONFIGURED_MSG =
  'Jintel API key not configured. Complete onboarding at Settings → Connections, or add key "jintel-api-key" in Settings → Vault.';

const AUTH_ERROR_MSG =
  'Jintel rejected the API key (401 Unauthorized). The stored key may be revoked or mistyped — delete and re-add "jintel-api-key" in Settings → Vault.';

const FALLBACK_SUFFIX =
  '\n\nJintel unavailable. Use cached signals or another connected source if fallback data is explicitly needed.';

const JINTEL_QUERY_KIND = z.enum([
  'quote',
  'market',
  'fundamentals',
  'history',
  'news',
  'research',
  'sentiment',
  'technicals',
  'derivatives',
  'risk',
  'regulatory',
  'short_interest',
  'financials',
  'executives',
  'institutional_holdings',
  'ownership',
  'top_holders',
]);

type JintelQueryKind = z.infer<typeof JINTEL_QUERY_KIND>;

const ENRICHMENT_FIELDS = z.enum([
  'market',
  'risk',
  'regulatory',
  'technicals',
  'derivatives',
  'news',
  'research',
  'sentiment',
  // Costly fields — only request when explicitly needed
  'social',
  'predictions',
  'discussions',
  'institutionalHoldings',
  'ownership',
  'topHolders',
]);

const SEVERITY_CONFIDENCE: Record<string, number> = {
  CRITICAL: 0.95,
  HIGH: 0.85,
  MEDIUM: 0.7,
  LOW: 0.5,
};

const DEFAULT_PORTFOLIO_FIELDS: EnrichmentField[] = ['market', 'risk'];

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

function snapshotStoreUnavailable(): ToolResult {
  return { content: 'Portfolio snapshot store is not configured.', isError: true };
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

/** Minimum severity required for SANCTIONS risk signals. Filters out fuzzy false positives. */
const MIN_SANCTIONS_SEVERITY: Set<string> = new Set(['HIGH', 'CRITICAL']);

/** Map Jintel RiskSignal.type → Yojin SignalType. */
const RISK_TYPE_TO_SIGNAL_TYPE: Record<string, z.infer<typeof SignalTypeSchema>> = {
  SANCTIONS: SignalType.REGULATORY,
  REGULATORY_ACTION: SignalType.REGULATORY,
  LITIGATION: SignalType.REGULATORY,
  PEP: SignalType.REGULATORY,
  ADVERSE_MEDIA: SignalType.SENTIMENT,
};

export function riskSignalsToRaw(signals: RiskSignal[], tickers: string[]): RawSignalInput[] {
  return signals
    .filter((s) => {
      // Filter out low-severity SANCTIONS matches — these are typically fuzzy false positives
      // (e.g. "SPECIAL MATERIALS CORPORATION" matching "MP Materials Corp" on a shared noun).
      if (s.type === 'SANCTIONS' && !MIN_SANCTIONS_SEVERITY.has(s.severity)) return false;
      return true;
    })
    .map((s) => ({
      sourceId: 'jintel',
      sourceName: 'Risk Screening',
      sourceType: SourceType.API,
      reliability: 0.8,
      title: `[${s.severity}] ${s.type}: ${s.description}`,
      content: s.description,
      publishedAt: s.date ?? new Date().toISOString(),
      type: RISK_TYPE_TO_SIGNAL_TYPE[s.type] ?? SignalType.SENTIMENT,
      tickers,
      confidence: SEVERITY_CONFIDENCE[s.severity] ?? 0.7,
      metadata: { riskType: s.type, severity: s.severity, source: s.source },
    }));
}

/** Build ArraySubGraphOptions and the matching $filter variable from optional since/limit params. */
function buildFilter(since?: string, limit?: number): { opts: ArraySubGraphOptions; vars: Record<string, unknown> } {
  const opts: ArraySubGraphOptions = { sort: 'DESC', ...(since ? { since } : {}), ...(limit ? { limit } : {}) };
  const vars: Record<string, unknown> = { sort: 'DESC' };
  if (since) vars.since = since;
  if (limit) vars.limit = limit;
  return { opts, vars };
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
    // Filter out low-severity SANCTIONS (fuzzy false positives) from agent-facing output too
    const filtered = signals.filter((s) => !(s.type === 'SANCTIONS' && !MIN_SANCTIONS_SEVERITY.has(s.severity)));
    if (filtered.length) {
      const signalLines = filtered.map((s) => `- [${s.severity}] ${s.type}: ${s.description}`);
      sections.push(`## Risk (score: ${overallScore})\n${signalLines.join('\n')}`);
    }
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
    if (t.ema50 != null) lines.push(`EMA(50): ${t.ema50.toFixed(2)}`);
    if (t.ema200 != null) lines.push(`EMA(200): ${t.ema200.toFixed(2)}`);
    if (t.sma != null) lines.push(`SMA(50): ${t.sma.toFixed(2)}`);
    if (t.sma20 != null) lines.push(`SMA(20): ${t.sma20.toFixed(2)}`);
    if (t.sma200 != null) lines.push(`SMA(200): ${t.sma200.toFixed(2)}`);
    if (t.wma52 != null) lines.push(`52-WMA: ${t.wma52.toFixed(2)}`);
    if (t.atr != null) lines.push(`ATR(14): ${t.atr.toFixed(2)}`);
    if (t.vwma != null) lines.push(`VWMA(20): ${t.vwma.toFixed(2)}`);
    if (t.vwap != null) lines.push(`VWAP: ${t.vwap.toFixed(2)}`);
    if (t.mfi != null) lines.push(`MFI(14): ${t.mfi.toFixed(1)}`);
    if (t.adx != null) lines.push(`ADX: ${t.adx.toFixed(1)}`);
    if (t.stochastic) lines.push(`Stochastic: %K ${t.stochastic.k.toFixed(1)} | %D ${t.stochastic.d.toFixed(1)}`);
    if (t.obv != null) lines.push(`OBV: ${t.obv.toLocaleString()}`);
    if (t.parabolicSar != null) lines.push(`Parabolic SAR: ${t.parabolicSar.toFixed(2)}`);
    if (t.bollingerBandsWidth != null) lines.push(`BB Width: ${t.bollingerBandsWidth.toFixed(4)}`);
    if (t.williamsR != null) lines.push(`Williams %R: ${t.williamsR.toFixed(1)}`);
    if (t.crossovers) {
      const cx = t.crossovers;
      if (cx.goldenCross) lines.push(`⚠ Golden Cross (SMA 50 > SMA 200)`);
      if (cx.deathCross) lines.push(`⚠ Death Cross (SMA 50 < SMA 200)`);
      if (cx.emaCross) lines.push(`EMA Cross: EMA(50) > EMA(200) (bullish)`);
      else if (t.ema50 != null && t.ema200 != null) lines.push(`EMA Cross: EMA(50) < EMA(200) (bearish)`);
    }
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

  if (entity.market?.keyEvents?.length) {
    const lines = entity.market.keyEvents.map(
      (e) =>
        `- [${e.type}] ${e.date}: ${e.description} (${e.changePercent >= 0 ? '+' : ''}${e.changePercent.toFixed(1)}%, close $${e.close.toFixed(2)})`,
    );
    sections.push(`## Key Price Events\n${lines.join('\n')}`);
  }

  if (entity.market?.shortInterest?.length) {
    const si = entity.market.shortInterest[0];
    const parts: string[] = [];
    if (si.shortInterest != null) parts.push(`Shares short: ${formatNumber(si.shortInterest)}`);
    if (si.daysToCover != null) parts.push(`Days to cover: ${si.daysToCover.toFixed(1)}`);
    if (si.change != null) parts.push(`Change: ${si.change >= 0 ? '+' : ''}${formatNumber(si.change)}`);
    if (parts.length) sections.push(`## Short Interest (${si.reportDate})\n${parts.join(' | ')}`);
  }

  if (entity.social) {
    sections.push(`## Social Posts\n${formatSocial(entity.social)}`);
  }

  if (entity.predictions?.length) {
    sections.push(`## Prediction Markets\n${formatPredictions(entity.predictions)}`);
  }

  if (entity.discussions?.length) {
    sections.push(`## Discussions\n${formatDiscussions(entity.discussions)}`);
  }

  if (entity.institutionalHoldings?.length) {
    sections.push(`## Institutional Holdings (13F)\n${formatInstitutionalHoldings(entity.institutionalHoldings)}`);
  }

  if (entity.ownership) {
    sections.push(`## Ownership Breakdown\n${formatOwnership(entity.ownership)}`);
  }

  if (entity.topHolders?.length) {
    sections.push(`## Top Institutional Holders\n${formatTopHolders(entity.topHolders)}`);
  }

  // financials & executives are planned jintel-client fields (not yet in Entity type).
  // Access via cast until the client ships these as first-class enrichment fields.
  const ext = entity as Entity & { financials?: FinancialStatements; executives?: KeyExecutive[] };
  if (ext.financials) {
    sections.push(`## Financial Statements\n${formatFinancials(ext.financials)}`);
  }

  if (ext.executives?.length) {
    sections.push(`## Key Executives\n${formatExecutives(ext.executives)}`);
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

function formatShortInterest(reports: ShortInterestReport[]): string {
  if (reports.length === 0) return 'No short interest data available.';
  return reports
    .map((r) => {
      const parts = [`${r.ticker} (${r.reportDate})`];
      if (r.shortInterest != null) parts.push(`Shares short: ${formatNumber(r.shortInterest)}`);
      if (r.daysToCover != null) parts.push(`Days to cover: ${r.daysToCover.toFixed(1)}`);
      if (r.change != null) parts.push(`Change: ${r.change >= 0 ? '+' : ''}${formatNumber(r.change)}`);
      return parts.join(' | ');
    })
    .join('\n');
}

function formatInstitutionalHoldings(holdings: InstitutionalHolding[]): string {
  if (holdings.length === 0) return 'No institutional holdings data available.';
  return holdings
    .map((h) => {
      const parts = [`${h.issuerName} (${h.titleOfClass})`];
      parts.push(`CUSIP: ${h.cusip}`);
      parts.push(`Value: $${formatNumber(h.value * 1000)}`);
      parts.push(`Shares: ${formatNumber(h.shares)}`);
      parts.push(`Discretion: ${h.investmentDiscretion}`);
      parts.push(`Report: ${h.reportDate} | Filed: ${h.filingDate}`);
      return parts.join(' | ');
    })
    .join('\n');
}

function formatOwnership(o: OwnershipBreakdown): string {
  const lines: string[] = [`Symbol: ${o.symbol}`];
  if (o.insiderOwnership != null) lines.push(`Insider ownership: ${(o.insiderOwnership * 100).toFixed(2)}%`);
  if (o.institutionOwnership != null)
    lines.push(`Institution ownership: ${(o.institutionOwnership * 100).toFixed(2)}%`);
  if (o.institutionFloatOwnership != null)
    lines.push(`Institution float ownership: ${(o.institutionFloatOwnership * 100).toFixed(2)}%`);
  if (o.institutionsCount != null) lines.push(`Institutions: ${o.institutionsCount}`);
  if (o.outstandingShares != null) lines.push(`Outstanding shares: ${formatNumber(o.outstandingShares)}`);
  if (o.floatShares != null) lines.push(`Float shares: ${formatNumber(o.floatShares)}`);
  if (isShortInterestFresh(o.shortInterestDate)) {
    const asOf = ` (as of ${o.shortInterestDate})`;
    if (o.shortInterest != null) lines.push(`Short interest: ${formatNumber(o.shortInterest)}${asOf}`);
    if (o.shortPercentOfFloat != null)
      lines.push(`Short % of float: ${(o.shortPercentOfFloat * 100).toFixed(2)}%${asOf}`);
    if (o.daysToCover != null) lines.push(`Days to cover: ${o.daysToCover.toFixed(1)}${asOf}`);
    if (o.shortInterestPrevMonth != null)
      lines.push(`Short interest prev month: ${formatNumber(o.shortInterestPrevMonth)}${asOf}`);
  }
  return lines.join('\n');
}

function formatTopHolders(holders: TopHolder[]): string {
  if (holders.length === 0) return 'No top holders data available.';
  return holders
    .map((h) => {
      const parts = [h.filerName];
      parts.push(`CIK: ${h.cik}`);
      parts.push(`Value: $${formatNumber(h.value * 1000)}`);
      parts.push(`Shares: ${formatNumber(h.shares)}`);
      parts.push(`Report: ${h.reportDate} | Filed: ${h.filingDate}`);
      return parts.join(' | ');
    })
    .join('\n');
}

function formatFactorData(data: FactorDataPoint[], series: string): string {
  if (data.length === 0) return 'No factor data available.';
  const sorted = [...data].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const recent = sorted.slice(0, 20);
  const lines = recent.map((d) => {
    const parts = [d.date];
    if (d.mktRf != null) parts.push(`Mkt-RF: ${(d.mktRf * 100).toFixed(3)}%`);
    if (d.smb != null) parts.push(`SMB: ${(d.smb * 100).toFixed(3)}%`);
    if (d.hml != null) parts.push(`HML: ${(d.hml * 100).toFixed(3)}%`);
    if (d.rmw != null) parts.push(`RMW: ${(d.rmw * 100).toFixed(3)}%`);
    if (d.cma != null) parts.push(`CMA: ${(d.cma * 100).toFixed(3)}%`);
    if (d.rf != null) parts.push(`RF: ${(d.rf * 100).toFixed(3)}%`);
    return parts.join(' | ');
  });
  return `# Fama-French Factors — ${series}\n${lines.join('\n')}${sorted.length > 20 ? `\n\n... and ${sorted.length - 20} more data points` : ''}`;
}

function formatSocial(s: Social): string {
  const sections: string[] = [];
  if (s.reddit?.length) {
    const lines = s.reddit.map(
      (r) =>
        `r/${r.subreddit} — ${r.title}\n  Score: ${r.score} | ${r.numComments} comments${r.url ? `\n  ${r.url}` : ''}`,
    );
    sections.push(`### Reddit (${s.reddit.length})\n${lines.join('\n')}`);
  }
  // redditComments is a planned jintel-client field (not yet in Social type).
  const extSocial = s as Social & { redditComments?: RedditComment[] };
  if (extSocial.redditComments?.length) {
    const lines = extSocial.redditComments.map(
      (c) => `r/${c.subreddit} — ${c.body.slice(0, 200)}${c.body.length > 200 ? '…' : ''}\n  Score: ${c.score}`,
    );
    sections.push(`### Reddit Comments (${extSocial.redditComments.length})\n${lines.join('\n')}`);
  }
  return sections.length > 0 ? sections.join('\n\n') : 'No social posts found.';
}

function formatFinancials(f: FinancialStatements): string {
  const inc = f.income[0];
  const bs = f.balanceSheet[0];
  const cf = f.cashFlow[0];
  const periodSrc = inc ?? bs ?? cf;
  if (!periodSrc) return 'No financial statement data available.';
  const lines: string[] = [];
  const period = periodSrc.periodType
    ? `${periodSrc.periodType} ending ${periodSrc.periodEnding}`
    : periodSrc.periodEnding;
  lines.push(`Period: ${period}`);
  // Income statement
  if (inc?.totalRevenue != null) lines.push(`Revenue: $${formatNumber(inc.totalRevenue)}`);
  if (inc?.grossProfit != null) lines.push(`Gross Profit: $${formatNumber(inc.grossProfit)}`);
  if (inc?.operatingIncome != null) lines.push(`Operating Income: $${formatNumber(inc.operatingIncome)}`);
  if (inc?.ebitda != null) lines.push(`EBITDA: $${formatNumber(inc.ebitda)}`);
  if (inc?.netIncome != null) lines.push(`Net Income: $${formatNumber(inc.netIncome)}`);
  if (inc?.dilutedEps != null) lines.push(`Diluted EPS: $${inc.dilutedEps.toFixed(2)}`);
  // Cash flow
  if (cf?.freeCashFlow != null) lines.push(`Free Cash Flow: $${formatNumber(cf.freeCashFlow)}`);
  if (cf?.operatingCashFlow != null) lines.push(`Operating Cash Flow: $${formatNumber(cf.operatingCashFlow)}`);
  // Balance sheet
  if (bs?.totalDebt != null) lines.push(`Total Debt: $${formatNumber(bs.totalDebt)}`);
  if (bs?.cashAndEquivalents != null) lines.push(`Cash & Equivalents: $${formatNumber(bs.cashAndEquivalents)}`);
  if (bs?.totalEquity != null) lines.push(`Total Equity: $${formatNumber(bs.totalEquity)}`);
  return lines.join('\n');
}

function formatExecutives(executives: KeyExecutive[]): string {
  if (executives.length === 0) return 'No executive data available.';
  return executives
    .map((e) => {
      let line = `${e.title}: ${e.name}`;
      if (e.age != null) line += ` (age ${e.age})`;
      if (e.pay != null) line += ` | pay: $${formatNumber(e.pay)}`;
      return line;
    })
    .join('\n');
}

function formatPredictions(markets: PredictionMarket[]): string {
  if (markets.length === 0) return 'No prediction markets found.';
  return markets
    .map((m) => {
      const parts = [`**${m.title}**`];
      if (m.outcomes?.length) {
        const outcomeLines = m.outcomes.map((o) => `  ${o.name}: ${(o.probability * 100).toFixed(1)}%`);
        parts.push(outcomeLines.join('\n'));
      }
      if (m.volume24hr != null) parts.push(`  24h volume: $${formatNumber(m.volume24hr)}`);
      if (m.endDate) parts.push(`  Ends: ${m.endDate}`);
      if (m.url) parts.push(`  ${m.url}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

function formatDiscussions(stories: HackerNewsStory[]): string {
  if (stories.length === 0) return 'No discussions found.';
  return stories
    .map((s) => {
      const parts = [`**${s.title}** (${s.points} pts, ${s.numComments} comments)`];
      if (s.url) parts.push(`  ${s.url}`);
      if (s.hnUrl) parts.push(`  HN: ${s.hnUrl}`);
      if (s.topComments?.length) {
        const commentLines = s.topComments
          .slice(0, 2)
          .map((c) => `  > ${c.text.slice(0, 150)}${c.text.length > 150 ? '…' : ''}`);
        parts.push(commentLines.join('\n'));
      }
      return parts.join('\n');
    })
    .join('\n\n');
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

function formatPositionContext(position: Position, snapshotTimestamp: string): string {
  const lines = [
    '## Portfolio Context',
    `Symbol: ${position.symbol}`,
    `Name: ${position.name || position.symbol}`,
    `Asset Class: ${position.assetClass}`,
    `Platform: ${position.platform}`,
    `Quantity: ${position.quantity}`,
    `Position Value: ${formatUsd(position.marketValue)}`,
    `Unrealized P&L: ${position.unrealizedPnlPercent >= 0 ? '+' : ''}${position.unrealizedPnlPercent.toFixed(1)}%`,
    `Snapshot Time: ${snapshotTimestamp}`,
  ];
  if (position.sector) lines.push(`Sector: ${position.sector}`);
  return lines.join('\n');
}

function findEntityForSymbol(entities: Entity[], symbol: string): Entity | undefined {
  const upper = symbol.toUpperCase();
  return entities.find(
    (entity) =>
      entity.id.toUpperCase() === upper || entity.tickers?.some((ticker) => ticker.toUpperCase() === upper) === true,
  );
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
      'Returns RSI, MACD, Bollinger Bands (+ width), EMA (10/50/200), SMA (20/50/200), 52-WMA, ' +
      'ATR, VWMA, VWAP, MFI, ADX, Stochastic, OBV, Parabolic SAR, Williams %R, and crossover flags.\n\n' +
      'Interpretation guide:\n' +
      '- RSI > 70 = overbought, < 30 = oversold, 40-60 = neutral\n' +
      '- MACD histogram > 0 = bullish momentum, < 0 = bearish; crossover of MACD/signal line = trend change\n' +
      '- Price near BB upper = overbought/strong trend, near BB lower = oversold/weak; BB squeeze (narrow width) = breakout imminent\n' +
      '- Price > SMA(200) = long-term uptrend; golden cross (SMA 50 > 200) = bullish, death cross = bearish\n' +
      '- EMA(50)/EMA(200) crossover = faster-reacting trend signal than SMA cross\n' +
      '- 52-WMA = weekly trend filter, smooths daily noise\n' +
      '- ATR rising = increasing volatility; ATR falling = consolidation\n' +
      '- MFI > 80 = overbought (with volume confirmation), < 20 = oversold\n' +
      '- VWMA > SMA = buying pressure, VWMA < SMA = selling pressure\n' +
      '- VWAP = institutional reference price; price above VWAP = bullish intraday bias\n' +
      '- ADX > 25 = strong trend, < 20 = sideways/ranging market\n' +
      '- Stochastic %K > 80 = overbought, < 20 = oversold; %K crossing %D = signal\n' +
      '- OBV rising + price rising = volume-confirmed trend; divergence = warning\n' +
      '- Parabolic SAR below price = uptrend, above = downtrend; flip = reversal signal\n' +
      '- Williams %R > -20 = overbought, < -80 = oversold',
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
      if (t.ema50 != null) lines.push(`EMA(50): ${t.ema50.toFixed(2)}`);
      if (t.ema200 != null) lines.push(`EMA(200): ${t.ema200.toFixed(2)}`);
      if (t.sma != null) {
        const trend = entity.market?.quote
          ? entity.market.quote.price > t.sma
            ? 'above (uptrend)'
            : 'below (downtrend)'
          : '';
        lines.push(`SMA(50): ${t.sma.toFixed(2)}${trend ? ` — price ${trend}` : ''}`);
      }
      if (t.sma20 != null) lines.push(`SMA(20): ${t.sma20.toFixed(2)}`);
      if (t.sma200 != null) {
        const trend = entity.market?.quote
          ? entity.market.quote.price > t.sma200
            ? 'above (long-term uptrend)'
            : 'below (long-term downtrend)'
          : '';
        lines.push(`SMA(200): ${t.sma200.toFixed(2)}${trend ? ` — price ${trend}` : ''}`);
      }
      if (t.wma52 != null) lines.push(`52-WMA: ${t.wma52.toFixed(2)}`);
      if (t.atr != null) lines.push(`ATR(14): ${t.atr.toFixed(2)}`);
      if (t.vwma != null) lines.push(`VWMA(20): ${t.vwma.toFixed(2)}`);
      if (t.vwap != null) {
        const bias = entity.market?.quote
          ? entity.market.quote.price > t.vwap
            ? ' — price above (bullish bias)'
            : ' — price below (bearish bias)'
          : '';
        lines.push(`VWAP: ${t.vwap.toFixed(2)}${bias}`);
      }
      if (t.mfi != null) {
        const zone = t.mfi > 80 ? ' (OVERBOUGHT)' : t.mfi < 20 ? ' (OVERSOLD)' : '';
        lines.push(`MFI(14): ${t.mfi.toFixed(1)}${zone}`);
      }
      if (t.adx != null) {
        const strength = t.adx > 25 ? ' (strong trend)' : t.adx < 20 ? ' (weak/ranging)' : '';
        lines.push(`ADX: ${t.adx.toFixed(1)}${strength}`);
      }
      if (t.stochastic) {
        const zone = t.stochastic.k > 80 ? ' (OVERBOUGHT)' : t.stochastic.k < 20 ? ' (OVERSOLD)' : '';
        lines.push(`Stochastic: %K ${t.stochastic.k.toFixed(1)} | %D ${t.stochastic.d.toFixed(1)}${zone}`);
      }
      if (t.obv != null) lines.push(`OBV: ${t.obv.toLocaleString()}`);
      if (t.parabolicSar != null) {
        const trend = entity.market?.quote
          ? entity.market.quote.price > t.parabolicSar
            ? ' (uptrend — SAR below price)'
            : ' (downtrend — SAR above price)'
          : '';
        lines.push(`Parabolic SAR: ${t.parabolicSar.toFixed(2)}${trend}`);
      }
      if (t.bollingerBandsWidth != null) {
        const squeeze = t.bollingerBandsWidth < 0.05 ? ' (SQUEEZE — breakout imminent)' : '';
        lines.push(`BB Width: ${t.bollingerBandsWidth.toFixed(4)}${squeeze}`);
      }
      if (t.williamsR != null) {
        const zone = t.williamsR > -20 ? ' (OVERBOUGHT)' : t.williamsR < -80 ? ' (OVERSOLD)' : '';
        lines.push(`Williams %R: ${t.williamsR.toFixed(1)}${zone}`);
      }
      if (t.crossovers) {
        const cx = t.crossovers;
        const flags: string[] = [];
        if (cx.goldenCross) flags.push('GOLDEN CROSS (SMA 50 > SMA 200) — bullish');
        if (cx.deathCross) flags.push('DEATH CROSS (SMA 50 < SMA 200) — bearish');
        if (cx.emaCross) flags.push('EMA CROSS: EMA(50) > EMA(200) — bullish');
        else if (t.ema50 != null && t.ema200 != null) flags.push('EMA CROSS: EMA(50) < EMA(200) — bearish');
        if (flags.length) lines.push(`\nCrossovers:\n${flags.map((f) => `  ${f}`).join('\n')}`);
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
      since: z
        .string()
        .optional()
        .describe('ISO timestamp — only return articles published after this date (e.g. "2026-04-01T00:00:00Z")'),
      limit: z.number().int().min(1).max(50).optional().describe('Max articles to return (default 20)'),
    }),
    async execute(params: { ticker: string; since?: string; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const { opts, vars } = buildFilter(params.since, params.limit);
      const query = buildEnrichQuery(['news'] as EnrichmentField[], opts);
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), filter: vars }),
      );
      if (!result.ok) return result.toolResult;

      const entity = result.data;
      if (!entity.news?.length) {
        return { content: `No recent news found for ${params.ticker}.` };
      }

      // Best-effort ingest news as signals
      if (options.ingestor) {
        const rawSignals: RawSignalInput[] = entity.news.map((a) => ({
          sourceId: 'jintel',
          sourceName: a.source || 'News',
          sourceType: SourceType.API,
          reliability: 0.75,
          title: a.title,
          content: a.snippet || a.title,
          publishedAt: a.date ?? new Date(new Date().toISOString().slice(0, 10)).toISOString(),
          type: SignalType.NEWS,
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
      since: z
        .string()
        .optional()
        .describe('ISO timestamp — only return reports published after this date (e.g. "2026-04-01T00:00:00Z")'),
      limit: z.number().int().min(1).max(50).optional().describe('Max reports to return (default 20)'),
    }),
    async execute(params: { ticker: string; since?: string; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const { opts, vars } = buildFilter(params.since, params.limit);
      const query = buildEnrichQuery(['research'] as EnrichmentField[], opts);
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), filter: vars }),
      );
      if (!result.ok) return result.toolResult;

      const entity = result.data;
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

  const getShortInterest: ToolDefinition = {
    name: 'get_short_interest',
    description:
      'Get short interest data for a ticker. Returns shares short, days-to-cover ratio, and change since last report.\n\n' +
      'High short interest + high days-to-cover = potential short squeeze setup. ' +
      'Use when the user asks about short sellers, bearish positioning, or squeeze potential.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. GME, TSLA, AMC)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() => client.shortInterest(params.ticker.toUpperCase()));
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      const reports = handled.data as ShortInterestReport[];
      return { content: `# ${params.ticker.toUpperCase()} — Short Interest\n\n${formatShortInterest(reports)}` };
    },
  };

  const getInstitutionalHoldings: ToolDefinition = {
    name: 'get_institutional_holdings',
    description:
      'Get 13F institutional holdings for a filer by SEC CIK number. Returns the latest 13F-HR filing portfolio ' +
      'showing all equity positions reported to the SEC.\n\n' +
      'Use when the user asks about what a fund/institution holds, e.g. "What does Berkshire Hathaway own?" ' +
      'or "Show me Bridgewater\'s portfolio". Requires the filer\'s CIK (Central Index Key) from SEC EDGAR.',
    parameters: z.object({
      cik: z.string().min(1).describe('SEC CIK number of the filer (e.g. "0001067983" for Berkshire Hathaway)'),
      since: z.string().optional().describe('ISO timestamp — only return holdings from filings after this date'),
      until: z.string().optional().describe('ISO timestamp — only return holdings from filings before this date'),
      limit: z.number().int().min(1).max(200).optional().describe('Max holdings to return (default: all)'),
    }),
    async execute(params: { cik: string; since?: string; until?: string; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const filter: { since?: string; until?: string; limit?: number; sort?: 'ASC' | 'DESC' } = { sort: 'DESC' };
      if (params.since) filter.since = params.since;
      if (params.until) filter.until = params.until;
      if (params.limit) filter.limit = params.limit;
      const result = await safeCall(() => client.institutionalHoldings(params.cik, filter));
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      const holdings = handled.data as InstitutionalHolding[];
      return {
        content: `# Institutional Holdings (13F) — CIK ${params.cik}\n\n${formatInstitutionalHoldings(holdings)}`,
      };
    },
  };

  const getOwnership: ToolDefinition = {
    name: 'get_ownership',
    description:
      'Get ownership breakdown for a ticker — insider vs institutional ownership percentages, shares outstanding, ' +
      'float, short interest, and days to cover.\n\n' +
      'Use when the user asks about who owns a stock, insider ownership, institutional ownership, or float analysis.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, TSLA, NVDA)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const ticker = params.ticker.toUpperCase();
      const result = await safeCall(() => client.enrichEntity(ticker, ['ownership'] as EnrichmentField[]));
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      const entity = handled.data as Entity;
      if (!entity.ownership) {
        return { content: `No ownership data available for ${ticker}.` };
      }
      return { content: `# ${entity.name ?? ticker} — Ownership Breakdown\n\n${formatOwnership(entity.ownership)}` };
    },
  };

  const getTopHolders: ToolDefinition = {
    name: 'get_top_holders',
    description:
      'Get top institutional holders of a ticker from 13F filings. Returns the largest institutional positions ' +
      'with filer name, CIK, value, shares, and filing dates.\n\n' +
      'Use when the user asks "who are the biggest holders of X?", "which institutions own Y?", or ' +
      '"show me the top shareholders".',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, TSLA, NVDA)'),
      limit: z.number().int().min(1).max(100).optional().describe('Max holders to return (default 20)'),
    }),
    async execute(params: { ticker: string; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const ticker = params.ticker.toUpperCase();
      const query = buildEnrichQuery(['topHolders'] as EnrichmentField[], {
        topHolders: params.limit ? { limit: params.limit } : undefined,
      });
      const result = await safeCall(() => client.request<Entity>(query, { id: ticker }));
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.topHolders?.length) {
        return { content: `No top holders data available for ${ticker}.` };
      }
      return {
        content: `# ${entity.name ?? ticker} — Top Institutional Holders\n\n${formatTopHolders(entity.topHolders)}`,
      };
    },
  };

  const getFamaFrench: ToolDefinition = {
    name: 'get_fama_french',
    description:
      'Get Fama-French factor data for risk decomposition and asset pricing analysis.\n\n' +
      'Available series:\n' +
      '- THREE_FACTOR_DAILY / THREE_FACTOR_MONTHLY: market risk premium (Mkt-RF), size (SMB), value (HML)\n' +
      '- FIVE_FACTOR_DAILY / FIVE_FACTOR_MONTHLY: adds profitability (RMW) and investment (CMA)\n\n' +
      'Use when the user asks about factor exposure, risk decomposition, value vs growth tilt, or ' +
      'academic factor-based analysis of a portfolio.',
    parameters: z.object({
      series: FamaFrenchSeriesSchema.describe('Factor series to fetch'),
      range: z.string().optional().describe('Date range filter (e.g. "1y", "6m"). Leave empty for full history.'),
    }),
    async execute(params: { series: FamaFrenchSeries; range?: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() => client.famaFrenchFactors(params.series, params.range));
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      return { content: formatFactorData(handled.data as FactorDataPoint[], params.series) };
    },
  };

  const getSocial: ToolDefinition = {
    name: 'get_social',
    description:
      'Get Reddit posts and comments mentioning a ticker. Returns recent posts with engagement metrics.\n\n' +
      'NOTE: This is a costly query — only use when the user explicitly asks about social media ' +
      'posts, community discussion, or social chatter for a specific asset.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. TSLA, BTC, NVDA)'),
      since: z
        .string()
        .optional()
        .describe('ISO timestamp — only return posts published after this date (e.g. "2026-04-01T00:00:00Z")'),
      limit: z.number().int().min(1).max(50).optional().describe('Max posts to return per sub-feed (default 20)'),
    }),
    async execute(params: { ticker: string; since?: string; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const { opts, vars } = buildFilter(params.since, params.limit);
      const query = buildEnrichQuery(['social'] as EnrichmentField[], opts);
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), filter: vars }),
      );
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.social) {
        return { content: `No social media data available for ${params.ticker}.` };
      }
      return { content: `# ${entity.name ?? params.ticker} — Social Posts\n\n${formatSocial(entity.social)}` };
    },
  };

  const getPredictions: ToolDefinition = {
    name: 'get_predictions',
    description:
      'Get prediction market data related to a ticker (e.g. Polymarket contracts on earnings outcomes, ' +
      'regulatory decisions, price targets).\n\n' +
      'NOTE: This is a costly query — only use when the user explicitly asks about prediction ' +
      'markets, event probabilities, or market-implied odds for a specific asset.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. AAPL, BTC)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const result = await safeCall(() =>
        client.enrichEntity(params.ticker.toUpperCase(), ['predictions'] as EnrichmentField[]),
      );
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      const entity = handled.data as Entity;
      if (!entity.predictions?.length) {
        return { content: `No prediction markets found for ${params.ticker}.` };
      }
      return {
        content: `# ${entity.name ?? params.ticker} — Prediction Markets\n\n${formatPredictions(entity.predictions as PredictionMarket[])}`,
      };
    },
  };

  const getDiscussions: ToolDefinition = {
    name: 'get_discussions',
    description:
      'Get Hacker News discussions related to a ticker or company. Returns top stories with ' +
      'points, comment count, and top comments.\n\n' +
      'NOTE: This is a costly query — only use when the user explicitly asks about tech community ' +
      'discussion, HN sentiment, or developer/investor commentary for a specific asset.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Ticker symbol (e.g. NVDA, MSFT, AAPL)'),
      since: z
        .string()
        .optional()
        .describe('ISO timestamp — only return stories published after this date (e.g. "2026-04-01T00:00:00Z")'),
      limit: z.number().int().min(1).max(50).optional().describe('Max stories to return (default 20)'),
    }),
    async execute(params: { ticker: string; since?: string; limit?: number }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      const { opts, vars } = buildFilter(params.since, params.limit);
      const query = buildEnrichQuery(['discussions'] as EnrichmentField[], opts);
      const result = await safeCall(() =>
        client.request<Entity>(query, { id: params.ticker.toUpperCase(), filter: vars }),
      );
      if (!result.ok) return result.toolResult;
      const entity = result.data;
      if (!entity.discussions?.length) {
        return { content: `No Hacker News discussions found for ${params.ticker}.` };
      }
      return {
        content: `# ${entity.name ?? params.ticker} — Discussions\n\n${formatDiscussions(entity.discussions as HackerNewsStory[])}`,
      };
    },
  };

  const getFinancials: ToolDefinition = {
    name: 'get_financials',
    description:
      'Get financial statements for an equity ticker — income statement, balance sheet, and cash flow. ' +
      'Returns revenue, net income, EPS, EBITDA, free cash flow, debt, equity, and more.\n\n' +
      'Equity-only: returns no data for crypto or ETFs. Use for valuation analysis, earnings quality, ' +
      'balance sheet health, or comparing periods.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Equity ticker symbol (e.g. AAPL, NVDA, MSFT)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      // 'financials' is a planned enrichment field — request 'market' as fallback until client ships it
      const result = await safeCall(() =>
        client.enrichEntity(params.ticker.toUpperCase(), ['market'] as EnrichmentField[]),
      );
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      const entity = handled.data as Entity;
      const ext = entity as Entity & { financials?: FinancialStatements };
      if (!ext.financials) {
        return {
          content: `No financial statement data available for ${params.ticker}. (Equity-only field — not available for crypto or ETFs.)`,
        };
      }
      return {
        content: `# ${entity.name ?? params.ticker} — Financial Statements\n\n${formatFinancials(ext.financials)}`,
      };
    },
  };

  const getExecutives: ToolDefinition = {
    name: 'get_executives',
    description:
      'Get key executives and officers for an equity ticker — names, titles, compensation, and age.\n\n' +
      'Equity-only: returns no data for crypto or ETFs. Use when the user asks about management, ' +
      'leadership, CEO, board composition, or executive compensation.',
    parameters: z.object({
      ticker: z.string().min(1).describe('Equity ticker symbol (e.g. AAPL, TSLA, NVDA)'),
    }),
    async execute(params: { ticker: string }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      const client = options.client;
      // 'executives' is a planned enrichment field — request 'market' as fallback until client ships it
      const result = await safeCall(() =>
        client.enrichEntity(params.ticker.toUpperCase(), ['market'] as EnrichmentField[]),
      );
      if (!result.ok) return result.toolResult;
      const handled = handleResult(result.data);
      if (!handled.ok) return handled.toolResult;
      const entity = handled.data as Entity;
      const ext = entity as Entity & { executives?: KeyExecutive[] };
      if (!ext.executives?.length) {
        return {
          content: `No executive data available for ${params.ticker}. (Equity-only field — not available for crypto or ETFs.)`,
        };
      }
      return {
        content: `# ${entity.name ?? params.ticker} — Key Executives\n\n${formatExecutives(ext.executives)}`,
      };
    },
  };

  const jintelQuery: ToolDefinition = {
    name: 'jintel_query',
    description:
      'Generic Jintel query tool for quotes, fundamentals, market data, history, news, research, sentiment, ' +
      'technicals, derivatives, risk, regulatory, short_interest, financials, executives, institutional_holdings, ' +
      'ownership, or top_holders. Use this when you want one Jintel-backed entry point instead of choosing a more specialized tool.',
    parameters: z.object({
      kind: JINTEL_QUERY_KIND.describe(
        'What to fetch: quote, market, fundamentals, history, news, research, sentiment, technicals, derivatives, risk, regulatory, short_interest, financials, executives, institutional_holdings, ownership, or top_holders',
      ),
      ticker: z
        .string()
        .optional()
        .describe('Single ticker symbol (e.g. AAPL, BTC, NVDA) or CIK for institutional_holdings'),
      tickers: z.array(z.string()).optional().describe('Ticker batch for quote/history queries'),
      range: z.string().optional().describe('History range for history queries (default "1y")'),
      interval: z.string().optional().describe('History interval for history queries (default "1d")'),
    }),
    async execute(params: {
      kind: JintelQueryKind;
      ticker?: string;
      tickers?: string[];
      range?: string;
      interval?: string;
    }): Promise<ToolResult> {
      if (!options.client) return notConfigured();

      const normalizedTickers =
        params.tickers?.map((ticker) => ticker.toUpperCase()) ?? (params.ticker ? [params.ticker.toUpperCase()] : []);
      const singleTicker = normalizedTickers[0];

      if ((params.kind === 'quote' || params.kind === 'history') && normalizedTickers.length === 0) {
        return { content: `jintel_query kind "${params.kind}" requires "ticker" or "tickers".`, isError: true };
      }

      if (params.kind !== 'quote' && params.kind !== 'history' && (!singleTicker || normalizedTickers.length !== 1)) {
        return { content: `jintel_query kind "${params.kind}" requires exactly one ticker.`, isError: true };
      }

      switch (params.kind) {
        case 'quote':
          return marketQuotes.execute({ tickers: normalizedTickers });
        case 'history':
          return priceHistory.execute({
            tickers: normalizedTickers,
            range: params.range,
            interval: params.interval,
          });
        case 'market':
        case 'fundamentals':
          return enrichEntity.execute({ ticker: singleTicker, fields: ['market'] });
        case 'risk':
          return enrichEntity.execute({ ticker: singleTicker, fields: ['risk'] });
        case 'regulatory':
          return enrichEntity.execute({ ticker: singleTicker, fields: ['regulatory'] });
        case 'news':
          return getNews.execute({ ticker: singleTicker });
        case 'research':
          return getResearch.execute({ ticker: singleTicker });
        case 'sentiment':
          return getSentiment.execute({ ticker: singleTicker });
        case 'technicals':
          return runTechnical.execute({ ticker: singleTicker });
        case 'derivatives':
          return getDerivatives.execute({ ticker: singleTicker });
        case 'short_interest':
          return getShortInterest.execute({ ticker: singleTicker });
        case 'financials':
          return getFinancials.execute({ ticker: singleTicker });
        case 'executives':
          return getExecutives.execute({ ticker: singleTicker });
        case 'institutional_holdings':
          return getInstitutionalHoldings.execute({ cik: singleTicker });
        case 'ownership':
          return getOwnership.execute({ ticker: singleTicker });
        case 'top_holders':
          return getTopHolders.execute({ ticker: singleTicker });
      }

      return { content: `Unsupported Jintel query kind: ${params.kind}`, isError: true };
    },
  };

  const enrichPosition: ToolDefinition = {
    name: 'enrich_position',
    description:
      'Enrich a current portfolio position with Jintel market and risk data. Uses the latest portfolio snapshot ' +
      'to attach redacted position context to the Jintel enrichment.',
    parameters: z.object({
      symbol: z.string().min(1).describe('Portfolio symbol to enrich (e.g. AAPL, BTC)'),
      fields: z
        .array(ENRICHMENT_FIELDS)
        .optional()
        .describe("Specific enrichment fields to fetch (default: ['market', 'risk'])"),
    }),
    async execute(params: { symbol: string; fields?: EnrichmentField[] }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      if (!options.snapshotStore) return snapshotStoreUnavailable();

      const symbol = params.symbol.toUpperCase();
      const snapshot = await options.snapshotStore.getLatest();
      if (!snapshot) {
        return {
          content: 'No portfolio snapshot found. Save portfolio positions before calling enrich_position.',
          isError: true,
        };
      }

      const position = snapshot.positions.find((item) => item.symbol.toUpperCase() === symbol);
      if (!position) {
        return {
          content: `Position "${symbol}" was not found in the latest portfolio snapshot.`,
          isError: true,
        };
      }

      const result = await options.client.enrichEntity(symbol, params.fields ?? DEFAULT_PORTFOLIO_FIELDS);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;

      const entity = handled.data as Entity;
      if (entity.risk?.signals?.length) {
        const tickers = entity.tickers ?? [symbol];
        await bestEffortIngest(options.ingestor, riskSignalsToRaw(entity.risk.signals, tickers));
      }

      return {
        content: `${formatPositionContext(position, snapshot.timestamp)}\n\n${formatEnrichment(entity)}`,
      };
    },
  };

  const enrichSnapshot: ToolDefinition = {
    name: 'enrich_snapshot',
    description:
      'Enrich the latest portfolio snapshot with Jintel in one batch. Uses batch enrichment for the portfolio ' +
      'symbols and returns each position with redacted holdings context plus Jintel output.',
    parameters: z.object({
      symbols: z.array(z.string()).optional().describe('Optional subset of portfolio symbols to enrich'),
      fields: z
        .array(ENRICHMENT_FIELDS)
        .optional()
        .describe("Specific enrichment fields to fetch for each symbol (default: ['market', 'risk'])"),
    }),
    async execute(params: { symbols?: string[]; fields?: EnrichmentField[] }): Promise<ToolResult> {
      if (!options.client) return notConfigured();
      if (!options.snapshotStore) return snapshotStoreUnavailable();

      const snapshot = await options.snapshotStore.getLatest();
      if (!snapshot || snapshot.positions.length === 0) {
        return {
          content: 'No portfolio snapshot found. Save portfolio positions before calling enrich_snapshot.',
          isError: true,
        };
      }

      const requestedSymbols = new Set(params.symbols?.map((symbol) => symbol.toUpperCase()) ?? []);
      const positions =
        requestedSymbols.size === 0
          ? snapshot.positions
          : snapshot.positions.filter((position) => requestedSymbols.has(position.symbol.toUpperCase()));

      if (positions.length === 0) {
        return {
          content: 'None of the requested symbols were found in the latest portfolio snapshot.',
          isError: true,
        };
      }

      const tickers = [...new Set(positions.map((position) => position.symbol.toUpperCase()))];
      const result = await options.client.batchEnrich(tickers, params.fields ?? DEFAULT_PORTFOLIO_FIELDS);
      const handled = handleResult(result);
      if (!handled.ok) return handled.toolResult;

      const entities = handled.data as Entity[];
      const sections = positions.map((position) => {
        const entity = findEntityForSymbol(entities, position.symbol);
        const context = formatPositionContext(position, snapshot.timestamp);
        if (!entity) {
          return `${context}\n\nNo Jintel enrichment returned for ${position.symbol}.`;
        }

        return `${context}\n\n${formatEnrichment(entity)}`;
      });

      for (const entity of entities) {
        if (entity.risk?.signals?.length) {
          const tickers = entity.tickers ?? [];
          await bestEffortIngest(options.ingestor, riskSignalsToRaw(entity.risk.signals, tickers));
        }
      }

      return {
        content: `# Portfolio Snapshot Enrichment\n\n${sections.join('\n\n---\n\n')}`,
      };
    },
  };

  return [
    searchEntities,
    jintelQuery,
    enrichEntity,
    enrichPosition,
    enrichSnapshot,
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
    getShortInterest,
    getFamaFrench,
    getSocial,
    getPredictions,
    getDiscussions,
    getFinancials,
    getExecutives,
    getInstitutionalHoldings,
    getOwnership,
    getTopHolders,
  ];
}
