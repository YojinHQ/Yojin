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
import { buildBatchEnrichQuery } from '@yojinhq/jintel-client';

import type { InsightStore } from './insight-store.js';
import type { InsightReport } from './types.js';
import type { AssetClass, Platform, Position } from '../api/graphql/types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { SignalMemoryStore } from '../memory/memory-store.js';
import type { MemoryEntry } from '../memory/types.js';
import type { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';
import type { TickerProfileStore } from '../profiles/profile-store.js';
import type { TickerProfileBrief } from '../profiles/types.js';
import type { SignalArchive } from '../signals/archive.js';
import { filterSignals } from '../signals/signal-filter.js';
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
  description: string | null;
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
  // Enrichment — technicals
  technicals: TechnicalsBrief | null;
  // Social sentiment
  socialSentiment: SocialSentimentBrief | null;
  // Signals
  signalCount: number;
  signals: SignalBrief[];
  sentimentDirection: SignalSentiment;
  // Memory
  memories: MemoryBrief[];
  // News articles (from Jintel)
  newsArticles: NewsArticleBrief[];
  // Research reports (from Jintel)
  researchReports: ResearchBrief[];
  // Ticker profile (per-asset institutional knowledge)
  profile: TickerProfileBrief | null;
}

interface FilingBrief {
  type: string;
  date: string;
  description: string | null;
  url: string;
}

interface SignalBrief {
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

interface TechnicalsBrief {
  rsi: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  bollingerBands: { upper: number; middle: number; lower: number } | null;
  ema: number | null;
  sma: number | null;
  atr: number | null;
  vwma: number | null;
  mfi: number | null;
}

interface SocialSentimentBrief {
  rank: number;
  mentions: number;
  upvotes: number;
  rank24hAgo: number;
  mentions24hAgo: number;
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

interface NewsArticleBrief {
  title: string;
  source: string;
  snippet: string;
  date: string | null;
}

interface ResearchBrief {
  title: string;
  author: string | null;
  text: string;
  date: string | null;
  score: number;
}

interface GatherResult {
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
  memoryStores: Map<string, SignalMemoryStore>;
  /** Per-asset persistent knowledge store — provides historical context per ticker. */
  profileStore?: TickerProfileStore;
}

// ---------------------------------------------------------------------------
// Gatherer
// ---------------------------------------------------------------------------

export async function gatherDataBriefs(options: DataGathererOptions): Promise<GatherResult> {
  const start = Date.now();
  const { snapshotStore, signalArchive, insightStore, getJintelClient, memoryStores, profileStore } = options;
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

  // 2. Parallel lookups — quotes, enrichments, curated signals, memories, previous report
  // Signal ingestion & curation happen on the scheduler / post-ingest hook — no need to
  // re-fetch or re-ingest here. We just read what's already curated.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [quotes, enrichmentByTicker, curatedSignals, memories, previousReport] = await Promise.all([
    // Quotes (1 API call)
    jintelClient
      ? jintelClient.quotes(tickers).catch(() => ({ success: false as const, error: 'quotes failed' }))
      : Promise.resolve(null),
    // Unified enrichment + news (1 API call per 20 tickers)
    // Returns Map<inputTicker, entity> — preserves portfolio ticker → entity association
    jintelClient ? batchEnrichAllChunked(jintelClient, tickers) : Promise.resolve(new Map<string, Entity>()),
    // Signals from archive, filtered for quality (no curation store needed)
    signalArchive
      .query({ tickers, since: sevenDaysAgo, limit: 100 * tickers.length })
      .then((raw) => filterSignals(raw, { relevantTickers: new Set(tickers) })),
    // Memories (local, fast)
    recallAllMemories(memoryStores, tickers),
    // Previous report (local, fast)
    insightStore.getLatest(),
  ]);
  const signals = curatedSignals;

  // 3. Index data by ticker for O(1) lookup
  const signalsByTicker = groupSignalsByTicker(signals, tickers);
  const quotesByTicker = indexQuotes(quotes);
  // enrichmentByTicker is already keyed by portfolio ticker from batchEnrichAllChunked
  const memoriesByTicker = indexMemories(memories, tickers);

  // 4. Build profile briefs (local, fast — no I/O beyond initial load)
  const profileBriefs = buildAllProfileBriefs(profileStore, tickers);

  // 7. Build compact briefs
  const briefs: DataBrief[] = snapshot.positions.map((pos) => {
    const tickerSignals = signalsByTicker.get(pos.symbol) ?? [];
    const quote = quotesByTicker.get(pos.symbol);
    const entity = enrichmentByTicker.get(pos.symbol);
    const mems = memoriesByTicker.get(pos.symbol) ?? [];
    const profile = profileBriefs.get(pos.symbol) ?? null;

    return buildBrief(pos, tickerSignals, quote, entity, mems, profile);
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
    if (b.description) lines.push(b.description);

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

    // Social sentiment
    if (b.socialSentiment) {
      const ss = b.socialSentiment;
      const rankDelta = ss.rank24hAgo - ss.rank;
      const rankDir = rankDelta > 0 ? `↑${rankDelta}` : rankDelta < 0 ? `↓${Math.abs(rankDelta)}` : '→';
      const mentionDelta = ss.mentions - ss.mentions24hAgo;
      const mentionDir = mentionDelta > 0 ? `+${mentionDelta}` : `${mentionDelta}`;
      lines.push(
        `Social: Rank #${ss.rank} (${rankDir}) | Mentions: ${ss.mentions} (${mentionDir}) | Upvotes: ${ss.upvotes}`,
      );
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

    // News articles (recent headlines with context)
    if (b.newsArticles.length > 0) {
      lines.push(`Recent news:`);
      for (const n of b.newsArticles.slice(0, 5)) {
        const date = n.date ? ` (${n.date})` : '';
        lines.push(`  - ${n.title}${date} via ${n.source}`);
        if (n.snippet) lines.push(`    ${n.snippet.slice(0, 150)}`);
      }
    }

    // Research reports (analyst/web research)
    if (b.researchReports.length > 0) {
      lines.push(`Research:`);
      for (const r of b.researchReports.slice(0, 3)) {
        const author = r.author ? ` by ${r.author}` : '';
        const date = r.date ? ` (${r.date})` : '';
        lines.push(`  - ${r.title}${author}${date}`);
        if (r.text) lines.push(`    ${r.text.slice(0, 200)}`);
      }
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

    // Ticker profile (accumulated per-asset knowledge)
    if (b.profile && b.profile.entryCount > 0) {
      lines.push(`Asset profile (${b.profile.entryCount} observations):`);
      if (b.profile.recentPatterns.length > 0) {
        lines.push(`  Patterns: ${b.profile.recentPatterns.join('; ')}`);
      }
      if (b.profile.recentLessons.length > 0) {
        lines.push(`  Lessons: ${b.profile.recentLessons.join('; ')}`);
      }
      if (b.profile.correlations.length > 0) {
        lines.push(`  Correlations: ${b.profile.correlations.join('; ')}`);
      }
      if (b.profile.sentimentHistory.length > 0) {
        const hist = b.profile.sentimentHistory.map((s) => `${s.rating}(${s.conviction.toFixed(1)})`).join(' → ');
        lines.push(`  Sentiment trend: ${hist}`);
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

// ---------------------------------------------------------------------------
// Unified Jintel enrichment — single query for ALL signal types
// ---------------------------------------------------------------------------

/** Batch enrich query: market + risk + regulatory + technicals + sentiment. */
const BATCH_ENRICH_QUERY = buildBatchEnrichQuery([
  'market',
  'risk',
  'regulatory',
  'technicals',
  'sentiment',
  'news',
  'research',
]);

/**
 * Batch enrich tickers with ALL fields (market, risk, regulatory, news)
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
      const researchCount = data.reduce((n, e) => n + (e.research?.length ?? 0), 0);
      logger.info('Batch enrich succeeded', {
        tickers: chunk,
        entities: data.length,
        mapped: chunk.filter((t) => result.has(t)).length,
        withQuotes: hasMarket,
        withFundamentals: hasFundamentals,
        riskSignals: riskCount,
        filings: filingCount,
        newsArticles: newsCount,
        researchReports: researchCount,
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

export function buildBrief(
  pos: Position,
  signals: Signal[],
  quote: MarketQuote | undefined,
  entity: Entity | undefined,
  memories: MemoryBrief[],
  profile: TickerProfileBrief | null,
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
    description: entity?.market?.fundamentals?.description ?? null,
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
    socialSentiment: entity?.sentiment
      ? {
          rank: entity.sentiment.rank,
          mentions: entity.sentiment.mentions,
          upvotes: entity.sentiment.upvotes,
          rank24hAgo: entity.sentiment.rank24hAgo,
          mentions24hAgo: entity.sentiment.mentions24hAgo,
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
    newsArticles: (entity?.news ?? []).slice(0, 5).map((n) => ({
      title: n.title,
      source: n.source,
      snippet: n.snippet,
      date: n.date ?? null,
    })),
    researchReports: (entity?.research ?? []).slice(0, 3).map((r) => ({
      title: r.title,
      author: r.author ?? null,
      text: r.text.slice(0, 300),
      date: r.publishedDate ?? null,
      score: r.score,
    })),
    memories,
    profile,
  };
}

function buildAllProfileBriefs(
  store: TickerProfileStore | undefined,
  tickers: string[],
): Map<string, TickerProfileBrief> {
  const map = new Map<string, TickerProfileBrief>();
  if (!store) return map;
  for (const ticker of tickers) {
    const brief = store.buildBrief(ticker);
    if (brief.entryCount > 0) {
      map.set(ticker, brief);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Single-ticker brief builder — used by micro research pipeline
// ---------------------------------------------------------------------------

export interface SingleBriefOptions {
  snapshotStore: PortfolioSnapshotStore;
  signalArchive: SignalArchive;
  getJintelClient?: () => JintelClient | undefined;
  memoryStores: Map<string, SignalMemoryStore>;
  profileStore?: TickerProfileStore;
}

/**
 * Build a DataBrief for a single ticker. Used by the micro research pipeline
 * to avoid the overhead of gathering briefs for all positions.
 */
export async function buildSingleBrief(symbol: string, options: SingleBriefOptions): Promise<DataBrief | null> {
  const { snapshotStore, signalArchive, getJintelClient, memoryStores, profileStore } = options;
  const jintelClient = getJintelClient?.();

  // Find the position in the current snapshot
  const snapshot = await snapshotStore.getLatest();
  if (!snapshot) return null;

  const ticker = symbol.toUpperCase();
  const position = snapshot.positions.find((p) => p.symbol.toUpperCase() === ticker);

  // Spread to avoid mutating a cached snapshot position reference
  const pos: Position = position
    ? { ...position }
    : {
        symbol: ticker,
        name: ticker,
        quantity: 0,
        costBasis: 0,
        currentPrice: 0,
        marketValue: 0,
        dayChange: 0,
        dayChangePercent: 0,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        assetClass: 'EQUITY' as AssetClass,
        platform: 'WATCHLIST' as Platform,
      };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Parallel lookups for this single ticker
  const [quotes, enrichmentMap, curatedSignals, memories] = await Promise.all([
    jintelClient
      ? jintelClient.quotes([ticker]).catch(() => ({ success: false as const, error: 'quotes failed' }))
      : Promise.resolve(null),
    jintelClient ? batchEnrichAllChunked(jintelClient, [ticker]) : Promise.resolve(new Map<string, Entity>()),
    signalArchive
      .query({ tickers: [ticker], since: sevenDaysAgo, limit: 100 })
      .then((raw) => filterSignals(raw, { relevantTickers: new Set([ticker]) })),
    recallAllMemories(memoryStores, [ticker]),
  ]);

  const signals = curatedSignals;
  const quoteMap = indexQuotes(quotes);
  const memMap = indexMemories(memories, [ticker]);
  const profile = profileStore ? profileStore.buildBrief(ticker) : null;
  const profileBrief = profile && profile.entryCount > 0 ? profile : null;

  // Update position price from live quote if available
  const quote = quoteMap.get(ticker);
  if (quote && pos.currentPrice === 0) {
    pos.currentPrice = quote.price;
    pos.marketValue = pos.quantity * quote.price;
  }

  return buildBrief(pos, signals, quote, enrichmentMap.get(ticker), memMap.get(ticker) ?? [], profileBrief);
}

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n.toLocaleString();
}
