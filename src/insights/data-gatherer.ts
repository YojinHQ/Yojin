/**
 * DataBrief gatherer — deterministic data collection for ProcessInsights.
 *
 * Calls service functions directly (no LLM, no agent loop) to pre-aggregate
 * all data needed for insight analysis. This eliminates 70% of LLM iterations
 * that were previously spent on tool calls for data gathering.
 *
 * Each position gets a compact DataBrief (~300-500 chars) suitable for
 * injecting into an agent's context without overflow.
 */

import type { Entity, JintelClient, MarketQuote } from '@yojinhq/jintel-client';
import { ALL_ENRICHMENT_FIELDS, buildBatchEnrichQuery } from '@yojinhq/jintel-client';

import type { InsightStore } from './insight-store.js';
import type { InsightReport } from './types.js';
import { fetchAllEnabledSources } from '../api/graphql/resolvers/fetch-data-source.js';
import type { Position } from '../api/graphql/types.js';
import { riskSignalsToRaw } from '../jintel/tools.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { SignalMemoryStore } from '../memory/memory-store.js';
import type { MemoryEntry } from '../memory/types.js';
import type { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';
import type { SignalArchive } from '../signals/archive.js';
import type { RawSignalInput, SignalIngestor } from '../signals/ingestor.js';
import type { Signal, SignalOutputType, SignalSentiment } from '../signals/types.js';

const logger = createSubsystemLogger('data-gatherer');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataBrief {
  symbol: string;
  name: string;
  // Position data
  quantity: number;
  costBasis: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnlPercent: number;
  sector: string | null;
  assetClass: string;
  // Market quote (live)
  quotePrice: number | null;
  changePercent: number | null;
  volume: number | null;
  // Enrichment — fundamentals
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  beta: number | null;
  dividendYield: number | null;
  debtToEquity: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  enrichmentSector: string | null;
  enrichmentIndustry: string | null;
  // Enrichment — risk
  riskScore: number | null;
  riskSignals: string[];
  // Enrichment — regulatory
  recentFilings: FilingBrief[];
  // Enrichment — corporate
  legalName: string | null;
  jurisdiction: string | null;
  // Enrichment — technicals
  technicals: TechnicalsBrief | null;
  // Signals
  signalCount: number;
  signals: SignalBrief[];
  sentimentDirection: SignalSentiment;
  // Memory
  memories: MemoryBrief[];
}

export interface FilingBrief {
  type: string;
  date: string;
  description: string | null;
  url: string;
}

export interface SignalBrief {
  id: string;
  type: string;
  title: string;
  tier2: string | null;
  sourceCount: number;
  sourceNames: string[];
  sentiment: SignalSentiment | null;
  outputType: SignalOutputType;
  publishedAt: string;
  link: string | null;
  groupId: string | null;
}

export interface TechnicalsBrief {
  rsi: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  bollingerBands: { upper: number; middle: number; lower: number } | null;
  ema: number | null;
  sma: number | null;
  atr: number | null;
  vwma: number | null;
  mfi: number | null;
}

export interface MemoryBrief {
  situation: string;
  recommendation: string;
  confidence: number;
  date: string;
  /** Reflection fields — populated after the entry has been graded. */
  grade: string | null;
  lesson: string | null;
  actualReturn: number | null;
}

export interface GatherResult {
  briefs: DataBrief[];
  snapshotId: string;
  previousReport: InsightReport | null;
  gatherDurationMs: number;
}

export interface DataGathererOptions {
  snapshotStore: PortfolioSnapshotStore;
  signalArchive: SignalArchive;
  insightStore: InsightStore;
  /** Getter to resolve the current Jintel client (may be hot-swapped after vault unlock). */
  getJintelClient?: () => JintelClient | undefined;
  signalIngestor?: SignalIngestor;
  memoryStores: Map<string, SignalMemoryStore>;
}

// ---------------------------------------------------------------------------
// Gatherer
// ---------------------------------------------------------------------------

export async function gatherDataBriefs(options: DataGathererOptions): Promise<GatherResult> {
  const start = Date.now();
  const { snapshotStore, signalArchive, insightStore, getJintelClient, signalIngestor, memoryStores } = options;
  const jintelClient = getJintelClient?.();
  if (!jintelClient) {
    logger.warn('Jintel client not available — skipping enrichment and quotes');
  }

  // 1. Get current portfolio
  const snapshot = await snapshotStore.getLatest();
  if (!snapshot || snapshot.positions.length === 0) {
    return { briefs: [], snapshotId: '', previousReport: null, gatherDurationMs: Date.now() - start };
  }

  const tickers = snapshot.positions.map((p) => p.symbol);
  logger.info('Gathering data briefs', { positionCount: tickers.length });

  // 2. Fetch fresh signals from all enabled data sources
  try {
    const fetchResult = await fetchAllEnabledSources();
    logger.info('Data source fetch complete', {
      ingested: fetchResult.totalIngested,
      duplicates: fetchResult.totalDuplicates,
      sources: fetchResult.sourcesAttempted,
    });
  } catch (err) {
    logger.warn('Data source fetch failed — continuing with existing signals', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Parallel lookups — quotes, enrichments, memories, previous report
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [quotes, enrichmentByTicker, memories, previousReport] = await Promise.all([
    // Quotes (1 API call)
    jintelClient
      ? jintelClient.quotes(tickers).catch(() => ({ success: false as const, error: 'quotes failed' }))
      : Promise.resolve(null),
    // Unified enrichment + news (1 API call per 20 tickers)
    // Returns Map<inputTicker, entity> — preserves portfolio ticker → entity association
    jintelClient ? batchEnrichAllChunked(jintelClient, tickers) : Promise.resolve(new Map<string, Entity>()),
    // Memories (local, fast)
    recallAllMemories(memoryStores, tickers),
    // Previous report (local, fast)
    insightStore.getLatest(),
  ]);

  // 4. Ingest ALL Jintel entity data into the signal archive (fundamentals,
  //    risk, filings, price moves, news — all from the single unified query).
  //    Each signal is tagged with the portfolio ticker that was queried, guaranteeing
  //    downstream association from signal → position.
  if (signalIngestor && enrichmentByTicker.size > 0) {
    const rawSignals = [...enrichmentByTicker.entries()].flatMap(([inputTicker, entity]) =>
      enrichmentToSignals(entity, inputTicker),
    );

    if (rawSignals.length > 0) {
      try {
        const ingestResult = await signalIngestor.ingest(rawSignals);
        logger.info('Jintel signals ingested', {
          ingested: ingestResult.ingested,
          duplicates: ingestResult.duplicates,
          total: rawSignals.length,
        });
      } catch (err) {
        logger.warn('Jintel signal ingestion failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // 5. Query signals AFTER enrichment ingestion so freshly-created signals are included
  const signals = await signalArchive.query({ tickers, since: sevenDaysAgo, limit: 100 * tickers.length });

  // 6. Index data by ticker for O(1) lookup
  const signalsByTicker = groupSignalsByTicker(signals, tickers);
  const quotesByTicker = indexQuotes(quotes);
  // enrichmentByTicker is already keyed by portfolio ticker from batchEnrichAllChunked
  const memoriesByTicker = indexMemories(memories, tickers);

  // 7. Build compact briefs
  const briefs: DataBrief[] = snapshot.positions.map((pos) => {
    const tickerSignals = signalsByTicker.get(pos.symbol) ?? [];
    const quote = quotesByTicker.get(pos.symbol);
    const entity = enrichmentByTicker.get(pos.symbol);
    const mems = memoriesByTicker.get(pos.symbol) ?? [];

    return buildBrief(pos, tickerSignals, quote, entity, mems);
  });

  const durationMs = Date.now() - start;
  logger.info('Data briefs gathered', { positionCount: briefs.length, durationMs });

  return {
    briefs,
    snapshotId: snapshot.id,
    previousReport,
    gatherDurationMs: durationMs,
  };
}

// ---------------------------------------------------------------------------
// Format a DataBrief as compact text for LLM context
// ---------------------------------------------------------------------------

export function formatBriefsForContext(briefs: DataBrief[]): string {
  if (briefs.length === 0) return 'No positions in portfolio.';

  const sections = briefs.map((b) => {
    const lines: string[] = [];
    lines.push(`## ${b.symbol} — ${b.name}`);

    // Position
    const price = b.quotePrice ?? b.currentPrice;
    const change = b.changePercent != null ? ` (${b.changePercent > 0 ? '+' : ''}${b.changePercent.toFixed(2)}%)` : '';
    lines.push(`Price: $${price.toFixed(2)}${change} | P&L: ${b.unrealizedPnlPercent.toFixed(1)}%`);

    // Fundamentals (row 1: sector + valuation)
    const fundParts: string[] = [];
    if (b.enrichmentSector ?? b.sector) fundParts.push(`Sector: ${b.enrichmentSector ?? b.sector}`);
    if (b.enrichmentIndustry) fundParts.push(`Industry: ${b.enrichmentIndustry}`);
    if (b.marketCap) fundParts.push(`MCap: $${formatLargeNumber(b.marketCap)}`);
    if (b.pe) fundParts.push(`P/E: ${b.pe.toFixed(1)}`);
    if (b.eps) fundParts.push(`EPS: $${b.eps.toFixed(2)}`);
    if (fundParts.length > 0) lines.push(fundParts.join(' | '));

    // Fundamentals (row 2: risk metrics)
    const riskParts: string[] = [];
    if (b.beta != null) riskParts.push(`Beta: ${b.beta.toFixed(2)}`);
    if (b.dividendYield != null) riskParts.push(`Div: ${(b.dividendYield * 100).toFixed(2)}%`);
    if (b.debtToEquity != null) riskParts.push(`D/E: ${b.debtToEquity.toFixed(2)}`);
    if (b.fiftyTwoWeekHigh != null && b.fiftyTwoWeekLow != null) {
      const curPrice = b.quotePrice ?? b.currentPrice;
      const range = b.fiftyTwoWeekHigh - b.fiftyTwoWeekLow;
      const pctInRange = range > 0 ? (((curPrice - b.fiftyTwoWeekLow) / range) * 100).toFixed(0) : '–';
      riskParts.push(`52w: $${b.fiftyTwoWeekLow.toFixed(0)}–$${b.fiftyTwoWeekHigh.toFixed(0)} (${pctInRange}%)`);
    }
    if (b.riskScore != null) riskParts.push(`Risk: ${b.riskScore.toFixed(1)}/100`);
    if (riskParts.length > 0) lines.push(riskParts.join(' | '));

    // Technicals
    if (b.technicals) {
      const t = b.technicals;
      const techParts: string[] = [];
      if (t.rsi != null) techParts.push(`RSI: ${t.rsi.toFixed(1)}`);
      if (t.macd) techParts.push(`MACD hist: ${t.macd.histogram.toFixed(3)}`);
      if (t.bollingerBands)
        techParts.push(`BB: ${t.bollingerBands.lower.toFixed(0)}–${t.bollingerBands.upper.toFixed(0)}`);
      if (t.sma != null) techParts.push(`SMA: ${t.sma.toFixed(2)}`);
      if (t.ema != null) techParts.push(`EMA: ${t.ema.toFixed(2)}`);
      if (t.atr != null) techParts.push(`ATR: ${t.atr.toFixed(2)}`);
      if (t.mfi != null) techParts.push(`MFI: ${t.mfi.toFixed(1)}`);
      if (techParts.length > 0) lines.push(`Technicals: ${techParts.join(' | ')}`);
    }

    // Risk signals
    if (b.riskSignals.length > 0) {
      lines.push(`Risk flags: ${b.riskSignals.slice(0, 3).join('; ')}`);
    }

    // Recent SEC filings
    if (b.recentFilings.length > 0) {
      lines.push(`Recent filings:`);
      for (const f of b.recentFilings.slice(0, 3)) {
        const desc = f.description ? ` — ${f.description}` : '';
        lines.push(`  - [${f.type}] ${f.date}${desc}`);
      }
    }

    // Signals
    lines.push(`Signals (7d): ${b.signalCount} — sentiment: ${b.sentimentDirection}`);
    for (const sig of b.signals.slice(0, 5)) {
      const sources =
        sig.sourceCount > 1
          ? ` (${sig.sourceCount} sources: ${sig.sourceNames.join(', ')})`
          : ` (${sig.sourceNames[0] ?? 'unknown'})`;
      lines.push(`  - [${sig.outputType}] ${sig.title}${sources} (id:${sig.id})`);
    }

    // Memories (prioritize reflected memories with lessons)
    if (b.memories.length > 0) {
      lines.push(`Past analysis:`);
      // Show reflected (graded) memories first, then ungraded
      const sorted = [...b.memories].sort((ma, mb) => (mb.grade ? 1 : 0) - (ma.grade ? 1 : 0));
      for (const m of sorted.slice(0, 3)) {
        if (m.grade && m.actualReturn != null) {
          const returnStr = `${m.actualReturn > 0 ? '+' : ''}${m.actualReturn.toFixed(1)}%`;
          lines.push(`  - ${m.date}: ${m.recommendation.slice(0, 80)} (grade: ${m.grade}, ${returnStr})`);
          if (m.lesson) lines.push(`    Lesson: ${m.lesson.slice(0, 120)}`);
        } else {
          lines.push(`  - ${m.date}: ${m.recommendation.slice(0, 100)}`);
        }
      }
    }

    return lines.join('\n');
  });

  return sections.join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Pre-computed risk metrics (eliminates RM's 12+ calculate calls)
// ---------------------------------------------------------------------------

export function formatRiskMetrics(briefs: DataBrief[]): string {
  if (briefs.length === 0) return 'No positions.';

  const totalValue = briefs.reduce((s, b) => s + b.marketValue, 0);
  if (totalValue === 0) return 'Portfolio value is zero.';

  // Position weights
  const weights = briefs.map((b) => ({
    symbol: b.symbol,
    weight: b.marketValue / totalValue,
    marketValue: b.marketValue,
    sector: b.enrichmentSector ?? b.sector ?? 'Unknown',
    beta: b.beta,
  }));

  // Sector exposure
  const sectorMap = new Map<string, number>();
  for (const w of weights) {
    sectorMap.set(w.sector, (sectorMap.get(w.sector) ?? 0) + w.weight);
  }
  const sectors = [...sectorMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, w]) => `${s}: ${(w * 100).toFixed(1)}%`);

  // HHI (concentration)
  const hhi = weights.reduce((s, w) => s + w.weight ** 2, 0);
  const effectivePositions = 1 / hhi;

  // Top concentrations
  const sorted = [...weights].sort((a, b) => b.weight - a.weight);
  const topConc = sorted.slice(0, 5).map((w) => `${w.symbol}: ${(w.weight * 100).toFixed(1)}%`);

  // Flags
  const flags: string[] = [];
  for (const w of weights) {
    if (w.weight > 0.25) flags.push(`CRITICAL: ${w.symbol} at ${(w.weight * 100).toFixed(1)}% (>25%)`);
    else if (w.weight > 0.1) flags.push(`WARNING: ${w.symbol} at ${(w.weight * 100).toFixed(1)}% (>10%)`);
  }
  for (const [sector, weight] of sectorMap) {
    if (weight > 0.4) flags.push(`WARNING: ${sector} sector at ${(weight * 100).toFixed(1)}% (>40%)`);
  }

  const lines = [
    `## Pre-Computed Risk Metrics`,
    `Total portfolio value: $${formatLargeNumber(totalValue)}`,
    `Positions: ${briefs.length} | Effective positions (1/HHI): ${effectivePositions.toFixed(1)}`,
    `HHI: ${(hhi * 10000).toFixed(0)} (${hhi < 0.15 ? 'diversified' : hhi < 0.25 ? 'moderate' : 'concentrated'})`,
    ``,
    `### Position Weights`,
    ...topConc.map((c) => `- ${c}`),
    ``,
    `### Sector Exposure`,
    ...sectors.map((s) => `- ${s}`),
  ];

  // Weighted portfolio beta
  const betaWeights = weights.filter((w) => w.beta != null);
  if (betaWeights.length > 0) {
    const weightedBeta = betaWeights.reduce((s, w) => s + w.weight * (w.beta ?? 0), 0);
    const coverage = betaWeights.reduce((s, w) => s + w.weight, 0);
    lines.push(``, `### Portfolio Beta`);
    lines.push(`Weighted beta: ${weightedBeta.toFixed(2)} (${(coverage * 100).toFixed(0)}% coverage)`);
    // Flag high-beta positions
    for (const w of weights) {
      if (w.beta != null && w.beta > 1.5) {
        flags.push(`WARNING: ${w.symbol} beta ${w.beta.toFixed(2)} (high volatility)`);
      }
    }
  }

  if (flags.length > 0) {
    lines.push(``, `### Concentration Flags`, ...flags.map((f) => `- ${f}`));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Jintel Entity enrichment into RawSignalInput items.
 * Extracts ALL signal types: fundamentals, risk, regulatory filings, market data, and news.
 *
 * @param entity  — Jintel enrichment response
 * @param inputTicker — the portfolio ticker that was queried; always included in
 *   the signal's tickers so downstream association (signal → position) is guaranteed.
 */
function enrichmentToSignals(entity: Entity, inputTicker: string): RawSignalInput[] {
  const entityTickers = entity.tickers ?? [];
  // Guarantee the portfolio ticker is in the tickers list (case-insensitive dedup)
  const tickers = entityTickers.some((t) => t.toUpperCase() === inputTicker.toUpperCase())
    ? entityTickers
    : [inputTicker, ...entityTickers];
  const now = new Date().toISOString();
  const signals: RawSignalInput[] = [];

  // 1. Risk signals (OFAC, adverse media, etc.)
  if (entity.risk?.signals?.length) {
    signals.push(...riskSignalsToRaw(entity.risk.signals, tickers));
  }

  // 2. Fundamentals snapshot → FUNDAMENTAL signal
  const fund = entity.market?.fundamentals;
  if (fund) {
    const parts: string[] = [];
    if (fund.sector) parts.push(`Sector: ${fund.sector}`);
    if (fund.industry) parts.push(`Industry: ${fund.industry}`);
    if (fund.marketCap) parts.push(`MCap: $${formatLargeNumber(fund.marketCap)}`);
    if (fund.peRatio != null) parts.push(`P/E: ${fund.peRatio.toFixed(1)}`);
    if (fund.eps != null) parts.push(`EPS: $${fund.eps.toFixed(2)}`);
    if (fund.beta != null) parts.push(`Beta: ${fund.beta.toFixed(2)}`);
    if (fund.dividendYield != null) parts.push(`Div yield: ${(fund.dividendYield * 100).toFixed(2)}%`);
    if (fund.debtToEquity != null) parts.push(`D/E: ${fund.debtToEquity.toFixed(2)}`);
    if (fund.fiftyTwoWeekHigh != null) parts.push(`52w high: $${fund.fiftyTwoWeekHigh.toFixed(2)}`);
    if (fund.fiftyTwoWeekLow != null) parts.push(`52w low: $${fund.fiftyTwoWeekLow.toFixed(2)}`);

    if (parts.length > 0) {
      signals.push({
        sourceId: 'jintel-fundamentals',
        sourceName: 'Jintel Fundamentals',
        sourceType: 'ENRICHMENT',
        reliability: 0.9,
        title: `${entity.name ?? tickers[0]} fundamentals: ${parts.slice(0, 4).join(', ')}`,
        content: parts.join('\n'),
        publishedAt: now,
        type: 'FUNDAMENTAL',
        tickers,
        confidence: 0.9,
        metadata: {
          source: fund.source,
          marketCap: fund.marketCap,
          peRatio: fund.peRatio,
          eps: fund.eps,
          beta: fund.beta,
          dividendYield: fund.dividendYield,
          debtToEquity: fund.debtToEquity,
          fiftyTwoWeekHigh: fund.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: fund.fiftyTwoWeekLow,
          sector: fund.sector,
          industry: fund.industry,
        },
      });
    }
  }

  // 3. Regulatory filings → FUNDAMENTAL signals
  const filings = entity.regulatory?.filings ?? [];
  for (const filing of filings.slice(0, 5)) {
    signals.push({
      sourceId: 'jintel-sec',
      sourceName: 'Jintel SEC',
      sourceType: 'ENRICHMENT',
      reliability: 0.95,
      title: `${entity.name ?? tickers[0]}: ${filing.type} filed ${filing.date}`,
      content: filing.description ?? undefined,
      link: filing.url,
      publishedAt: filing.date.includes('T') ? filing.date : `${filing.date}T00:00:00Z`,
      type: 'FUNDAMENTAL',
      tickers,
      confidence: 0.95,
      metadata: { filingType: filing.type },
    });
  }

  // 4. Market quote → price-change signal (only if significant)
  const quote = entity.market?.quote;
  if (quote && Math.abs(quote.changePercent) >= 2) {
    const direction = quote.changePercent > 0 ? 'up' : 'down';
    signals.push({
      sourceId: 'jintel-market',
      sourceName: 'Jintel Market',
      sourceType: 'ENRICHMENT',
      reliability: 0.95,
      title: `${quote.ticker} ${direction} ${Math.abs(quote.changePercent).toFixed(1)}% to $${quote.price.toFixed(2)}`,
      publishedAt: quote.timestamp,
      type: 'TECHNICAL',
      tickers,
      confidence: 0.95,
      metadata: {
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        volume: quote.volume,
      },
    });
  }

  // 5. News articles — tickers come from the entity structure, not content parsing
  for (const article of entity.news ?? []) {
    if (!article.title) continue;
    signals.push({
      sourceId: `jintel-news-${article.source.toLowerCase().replace(/\s+/g, '-')}`,
      sourceName: `Jintel News (${article.source})`,
      sourceType: 'API',
      reliability: 0.8,
      title: article.title,
      content: article.snippet ?? undefined,
      link: article.link,
      publishedAt: article.date ?? now,
      tickers,
      confidence: 0.8,
      metadata: {
        source: article.source,
        link: article.link,
      },
    });
  }

  // 6. Technical indicators → TECHNICAL signal (summary of all available indicators)
  const tech = entity.technicals;
  if (tech) {
    const parts: string[] = [];
    if (tech.rsi != null) parts.push(`RSI: ${tech.rsi.toFixed(1)}`);
    if (tech.macd)
      parts.push(`MACD: ${tech.macd.histogram.toFixed(3)} (${tech.macd.histogram >= 0 ? 'bullish' : 'bearish'})`);
    if (tech.bollingerBands)
      parts.push(`BB: ${tech.bollingerBands.lower.toFixed(2)}–${tech.bollingerBands.upper.toFixed(2)}`);
    if (tech.ema != null) parts.push(`EMA: ${tech.ema.toFixed(2)}`);
    if (tech.sma != null) parts.push(`SMA: ${tech.sma.toFixed(2)}`);
    if (tech.atr != null) parts.push(`ATR: ${tech.atr.toFixed(2)}`);
    if (tech.mfi != null) parts.push(`MFI: ${tech.mfi.toFixed(1)}`);

    if (parts.length > 0) {
      signals.push({
        sourceId: 'jintel-technicals',
        sourceName: 'Jintel Technicals',
        sourceType: 'ENRICHMENT',
        reliability: 0.9,
        title: `${entity.name ?? tickers[0]} technicals: ${parts.slice(0, 4).join(', ')}`,
        content: parts.join('\n'),
        publishedAt: now,
        type: 'TECHNICAL',
        tickers,
        confidence: 0.9,
        metadata: {
          rsi: tech.rsi,
          macdHistogram: tech.macd?.histogram,
          bbUpper: tech.bollingerBands?.upper,
          bbLower: tech.bollingerBands?.lower,
          ema: tech.ema,
          sma: tech.sma,
          atr: tech.atr,
          mfi: tech.mfi,
        },
      });
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Unified Jintel enrichment — single query for ALL signal types
// ---------------------------------------------------------------------------

/** Batch enrich query including all fields (market, risk, regulatory, corporate, news, etc.) */
const BATCH_ENRICH_QUERY = buildBatchEnrichQuery(ALL_ENRICHMENT_FIELDS);

/**
 * Batch enrich tickers with ALL fields (market, risk, regulatory, corporate, news)
 * in a single GraphQL call per chunk.
 *
 * Returns a Map keyed by the **input** portfolio ticker → entity. This guarantees
 * that downstream code always knows which portfolio position an entity belongs to,
 * even if the entity's own `tickers` field has a different format or ordering.
 */
async function batchEnrichAllChunked(client: JintelClient, tickers: string[]): Promise<Map<string, Entity>> {
  const CHUNK_SIZE = 20;
  const result = new Map<string, Entity>();
  for (let i = 0; i < tickers.length; i += CHUNK_SIZE) {
    const chunk = tickers.slice(i, i + CHUNK_SIZE);
    try {
      const data = await client.request<Entity[]>(BATCH_ENRICH_QUERY, { tickers: chunk });

      // Build a case-insensitive lookup: entity ticker → entity
      const entityByTicker = new Map<string, Entity>();
      for (const entity of data) {
        for (const t of entity.tickers ?? []) {
          entityByTicker.set(t.toUpperCase(), entity);
        }
      }

      // Map each input ticker to its entity — preserves the portfolio ticker as key
      for (const inputTicker of chunk) {
        const entity = entityByTicker.get(inputTicker.toUpperCase());
        if (entity) {
          result.set(inputTicker, entity);
        } else {
          logger.warn('No entity returned for ticker', { ticker: inputTicker });
        }
      }

      const riskCount = data.reduce((n, e) => n + (e.risk?.signals?.length ?? 0), 0);
      const filingCount = data.reduce((n, e) => n + (e.regulatory?.filings?.length ?? 0), 0);
      const hasMarket = data.filter((e) => e.market?.quote).length;
      const hasFundamentals = data.filter((e) => e.market?.fundamentals).length;
      const newsCount = data.reduce((n, e) => n + (e.news?.length ?? 0), 0);
      logger.info('Batch enrich succeeded', {
        tickers: chunk,
        entities: data.length,
        mapped: chunk.filter((t) => result.has(t)).length,
        withQuotes: hasMarket,
        withFundamentals: hasFundamentals,
        riskSignals: riskCount,
        filings: filingCount,
        newsArticles: newsCount,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Batch enrich chunk failed', { chunk: chunk.slice(0, 3), error: msg });
    }
  }

  return result;
}

async function recallAllMemories(
  stores: Map<string, SignalMemoryStore>,
  tickers: string[],
): Promise<Array<{ entry: MemoryEntry; score: number }>> {
  const analystStore = stores.get('analyst');
  if (!analystStore) return [];

  try {
    return await analystStore.recall('portfolio analysis and market conditions', {
      tickers,
      topN: 10,
    });
  } catch {
    return [];
  }
}

function groupSignalsByTicker(signals: Signal[], tickers: string[]): Map<string, Signal[]> {
  const tickerSet = new Set(tickers);
  const map = new Map<string, Signal[]>();

  for (const signal of signals) {
    for (const asset of signal.assets) {
      if (tickerSet.has(asset.ticker)) {
        const group = map.get(asset.ticker) ?? [];
        group.push(signal);
        map.set(asset.ticker, group);
      }
    }
  }

  return map;
}

function indexQuotes(result: { success: boolean; data?: MarketQuote[] } | null): Map<string, MarketQuote> {
  const map = new Map<string, MarketQuote>();
  if (!result || !('data' in result) || !result.data) return map;
  for (const q of result.data) {
    if (q?.ticker) map.set(q.ticker, q);
  }
  return map;
}

function indexMemories(
  memories: Array<{ entry: MemoryEntry; score: number }>,
  tickers: string[],
): Map<string, MemoryBrief[]> {
  const tickerSet = new Set(tickers);
  const map = new Map<string, MemoryBrief[]>();

  for (const { entry } of memories) {
    const brief: MemoryBrief = {
      situation: entry.situation,
      recommendation: entry.recommendation,
      confidence: entry.confidence,
      date: entry.createdAt.slice(0, 10),
      grade: entry.grade,
      lesson: entry.lesson,
      actualReturn: entry.actualReturn,
    };
    for (const t of entry.tickers) {
      if (tickerSet.has(t)) {
        const group = map.get(t) ?? [];
        group.push(brief);
        map.set(t, group);
      }
    }
  }

  return map;
}

function buildBrief(
  pos: Position,
  signals: Signal[],
  quote: MarketQuote | undefined,
  entity: Entity | undefined,
  memories: MemoryBrief[],
): DataBrief {
  // Compute sentiment direction from signal-level sentiment (with keyword fallback)
  let positive = 0;
  let negative = 0;
  for (const s of signals) {
    if (s.sentiment) {
      // Use LLM-classified sentiment when available
      if (s.sentiment === 'BULLISH') positive++;
      else if (s.sentiment === 'BEARISH') negative++;
      else if (s.sentiment === 'MIXED') {
        positive++;
        negative++;
      }
    } else {
      // Fallback: keyword heuristic for pre-enhancement signals
      const title = s.title.toLowerCase();
      if (
        title.includes('beat') ||
        title.includes('upgrade') ||
        title.includes('bullish') ||
        title.includes('record')
      ) {
        positive++;
      } else if (
        title.includes('miss') ||
        title.includes('downgrade') ||
        title.includes('bearish') ||
        title.includes('decline')
      ) {
        negative++;
      }
    }
  }
  let sentimentDirection: DataBrief['sentimentDirection'] = 'NEUTRAL';
  if (positive > 0 && negative > 0) sentimentDirection = 'MIXED';
  else if (positive > negative) sentimentDirection = 'BULLISH';
  else if (negative > positive) sentimentDirection = 'BEARISH';

  return {
    symbol: pos.symbol,
    name: pos.name,
    quantity: pos.quantity,
    costBasis: pos.costBasis,
    currentPrice: pos.currentPrice,
    marketValue: pos.marketValue,
    unrealizedPnlPercent: pos.unrealizedPnlPercent,
    sector: pos.sector ?? null,
    assetClass: pos.assetClass,
    quotePrice: quote?.price ?? null,
    changePercent: quote?.changePercent ?? null,
    volume: quote?.volume ?? null,
    marketCap: entity?.market?.fundamentals?.marketCap ?? null,
    pe: entity?.market?.fundamentals?.peRatio ?? null,
    eps: entity?.market?.fundamentals?.eps ?? null,
    beta: entity?.market?.fundamentals?.beta ?? null,
    dividendYield: entity?.market?.fundamentals?.dividendYield ?? null,
    debtToEquity: entity?.market?.fundamentals?.debtToEquity ?? null,
    fiftyTwoWeekHigh: entity?.market?.fundamentals?.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: entity?.market?.fundamentals?.fiftyTwoWeekLow ?? null,
    enrichmentSector: entity?.market?.fundamentals?.sector ?? null,
    enrichmentIndustry: entity?.market?.fundamentals?.industry ?? null,
    riskScore: entity?.risk?.overallScore ?? null,
    riskSignals: (entity?.risk?.signals ?? []).map((s) => `${s.severity}: ${s.description}`),
    recentFilings: (entity?.regulatory?.filings ?? []).slice(0, 5).map((f) => ({
      type: f.type,
      date: f.date,
      description: f.description ?? null,
      url: f.url,
    })),
    legalName: entity?.corporate?.legalName ?? null,
    jurisdiction: entity?.corporate?.jurisdiction ?? null,
    technicals: entity?.technicals
      ? {
          rsi: entity.technicals.rsi ?? null,
          macd: entity.technicals.macd ?? null,
          bollingerBands: entity.technicals.bollingerBands ?? null,
          ema: entity.technicals.ema ?? null,
          sma: entity.technicals.sma ?? null,
          atr: entity.technicals.atr ?? null,
          vwma: entity.technicals.vwma ?? null,
          mfi: entity.technicals.mfi ?? null,
        }
      : null,
    signalCount: signals.length,
    signals: signals.slice(0, 10).map((s) => ({
      id: s.id,
      type: s.type,
      title: s.tier1 ?? s.title,
      tier2: s.tier2 ?? null,
      sourceCount: s.sources.length,
      sourceNames: s.sources.map((src) => src.name),
      sentiment: s.sentiment ?? null,
      outputType: s.outputType ?? 'INSIGHT',
      publishedAt: s.publishedAt,
      link: typeof s.metadata?.link === 'string' ? s.metadata.link : null,
      groupId: s.groupId ?? null,
    })),
    sentimentDirection,
    memories,
  };
}

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n.toLocaleString();
}
