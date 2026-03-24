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

import type { InsightStore } from './insight-store.js';
import type { InsightReport } from './types.js';
import type { Position } from '../api/graphql/types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { SignalMemoryStore } from '../memory/memory-store.js';
import type { MemoryEntry } from '../memory/types.js';
import type { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';
import type { SignalArchive } from '../signals/archive.js';
import type { Signal } from '../signals/types.js';

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
  // Enrichment
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  enrichmentSector: string | null;
  riskScore: number | null;
  riskSignals: string[];
  // Signals
  signalCount: number;
  signals: SignalBrief[];
  sentimentDirection: 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL';
  // Memory
  memories: MemoryBrief[];
}

export interface SignalBrief {
  id: string;
  type: string;
  title: string;
  publishedAt: string;
  link: string | null;
}

export interface MemoryBrief {
  situation: string;
  recommendation: string;
  confidence: number;
  date: string;
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
  jintelClient?: JintelClient;
  memoryStores: Map<string, SignalMemoryStore>;
}

// ---------------------------------------------------------------------------
// Gatherer
// ---------------------------------------------------------------------------

export async function gatherDataBriefs(options: DataGathererOptions): Promise<GatherResult> {
  const start = Date.now();
  const { snapshotStore, signalArchive, insightStore, jintelClient, memoryStores } = options;

  // 1. Get current portfolio
  const snapshot = await snapshotStore.getLatest();
  if (!snapshot || snapshot.positions.length === 0) {
    return { briefs: [], snapshotId: '', previousReport: null, gatherDurationMs: Date.now() - start };
  }

  const tickers = snapshot.positions.map((p) => p.symbol);
  logger.info('Gathering data briefs', { positionCount: tickers.length });

  // 2. Parallel data fetching — all independent calls at once
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [signals, quotes, enrichments, memories, previousReport] = await Promise.all([
    // Signals (local, fast)
    signalArchive.query({ tickers, since: sevenDaysAgo, limit: 100 * tickers.length }),
    // Quotes (1 API call)
    jintelClient
      ? jintelClient.quotes(tickers).catch(() => ({ success: false as const, error: 'quotes failed' }))
      : Promise.resolve(null),
    // Enrichment (1 API call per 20 tickers)
    jintelClient ? batchEnrichChunked(jintelClient, tickers) : Promise.resolve([]),
    // Memories (local, fast)
    recallAllMemories(memoryStores, tickers),
    // Previous report (local, fast)
    insightStore.getLatest(),
  ]);

  // 3. Index data by ticker for O(1) lookup
  const signalsByTicker = groupSignalsByTicker(signals, tickers);
  const quotesByTicker = indexQuotes(quotes);
  const enrichmentByTicker = indexEnrichments(enrichments);
  const memoriesByTicker = indexMemories(memories, tickers);

  // 4. Build compact briefs
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

    // Fundamentals
    const fundParts: string[] = [];
    if (b.enrichmentSector ?? b.sector) fundParts.push(`Sector: ${b.enrichmentSector ?? b.sector}`);
    if (b.marketCap) fundParts.push(`MCap: $${formatLargeNumber(b.marketCap)}`);
    if (b.pe) fundParts.push(`P/E: ${b.pe.toFixed(1)}`);
    if (b.riskScore != null) fundParts.push(`Risk: ${b.riskScore.toFixed(1)}/10`);
    if (fundParts.length > 0) lines.push(fundParts.join(' | '));

    // Risk signals
    if (b.riskSignals.length > 0) {
      lines.push(`Risk flags: ${b.riskSignals.slice(0, 3).join('; ')}`);
    }

    // Signals
    lines.push(`Signals (7d): ${b.signalCount} — sentiment: ${b.sentimentDirection}`);
    for (const sig of b.signals.slice(0, 5)) {
      const link = sig.link ? ` ${sig.link}` : '';
      lines.push(`  - [${sig.type}] ${sig.title} (${sig.id})${link}`);
    }

    // Memories
    if (b.memories.length > 0) {
      lines.push(`Past analysis:`);
      for (const m of b.memories.slice(0, 2)) {
        lines.push(`  - ${m.date}: ${m.recommendation.slice(0, 100)}`);
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

  if (flags.length > 0) {
    lines.push(``, `### Concentration Flags`, ...flags.map((f) => `- ${f}`));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function batchEnrichChunked(client: JintelClient, tickers: string[]): Promise<Entity[]> {
  const CHUNK_SIZE = 20;
  const entities: Entity[] = [];

  for (let i = 0; i < tickers.length; i += CHUNK_SIZE) {
    const chunk = tickers.slice(i, i + CHUNK_SIZE);
    try {
      const result = await client.batchEnrich(chunk, ['market', 'risk']);
      if (result.success) {
        entities.push(...result.data);
      }
    } catch (err) {
      logger.warn('Batch enrich chunk failed', { chunk: chunk.slice(0, 3), error: err });
    }
  }

  return entities;
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
    map.set(q.ticker, q);
  }
  return map;
}

function indexEnrichments(entities: Entity[]): Map<string, Entity> {
  const map = new Map<string, Entity>();
  for (const e of entities) {
    const ticker = e.tickers?.[0];
    if (ticker) map.set(ticker, e);
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
  // Compute sentiment direction from signals
  let positive = 0;
  let negative = 0;
  for (const s of signals) {
    const title = s.title.toLowerCase();
    if (title.includes('beat') || title.includes('upgrade') || title.includes('bullish') || title.includes('record')) {
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
    enrichmentSector: entity?.market?.fundamentals?.sector ?? null,
    riskScore: entity?.risk?.overallScore ?? null,
    riskSignals: (entity?.risk?.signals ?? []).map((s) => `${s.severity}: ${s.description}`),
    signalCount: signals.length,
    signals: signals.slice(0, 10).map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      publishedAt: s.publishedAt,
      link: typeof s.metadata?.link === 'string' ? s.metadata.link : null,
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
