/**
 * Jintel Signal Fetcher — fetches enrichment data from Jintel and ingests as signals.
 *
 * Shared utility used by the full-curation workflow to pull Jintel data
 * (news, risk, fundamentals, technicals, filings) into the signal pipeline.
 */

import type { JintelClient } from '@yojinhq/jintel-client';
import { ALL_ENRICHMENT_FIELDS, buildBatchEnrichQuery } from '@yojinhq/jintel-client';

import { riskSignalsToRaw } from './tools.js';
import type { ExtendedEntity } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { RawSignalInput, SignalIngestor } from '../signals/ingestor.js';

const logger = createSubsystemLogger('jintel-signal-fetcher');

const BATCH_ENRICH_QUERY = buildBatchEnrichQuery(ALL_ENRICHMENT_FIELDS);
const CHUNK_SIZE = 20;

export interface JintelFetchResult {
  ingested: number;
  duplicates: number;
  tickers: number;
}

/**
 * Fetch enrichment data from Jintel for the given tickers and ingest
 * all signal types (news, risk, fundamentals, technicals, filings, price moves).
 */
export async function fetchJintelSignals(
  client: JintelClient,
  ingestor: SignalIngestor,
  tickers: string[],
): Promise<JintelFetchResult> {
  if (tickers.length === 0) return { ingested: 0, duplicates: 0, tickers: 0 };

  let totalIngested = 0;
  let totalDuplicates = 0;

  for (let i = 0; i < tickers.length; i += CHUNK_SIZE) {
    const chunk = tickers.slice(i, i + CHUNK_SIZE);
    try {
      const entities = await client.request<ExtendedEntity[]>(BATCH_ENRICH_QUERY, { tickers: chunk });

      // Build ticker → entity map
      const entityByTicker = new Map<string, ExtendedEntity>();
      for (const entity of entities) {
        for (const t of entity.tickers ?? []) {
          entityByTicker.set(t.toUpperCase(), entity);
        }
      }

      // Convert each entity's data to signals
      const rawSignals: RawSignalInput[] = [];
      for (const inputTicker of chunk) {
        const entity = entityByTicker.get(inputTicker.toUpperCase());
        if (!entity) continue;

        const entityTickers = entity.tickers ?? [];
        const signalTickers = entityTickers.some((t) => t.toUpperCase() === inputTicker.toUpperCase())
          ? entityTickers
          : [inputTicker, ...entityTickers];

        rawSignals.push(...enrichmentToSignals(entity, signalTickers));
      }

      if (rawSignals.length > 0) {
        const result = await ingestor.ingest(rawSignals);
        totalIngested += result.ingested;
        totalDuplicates += result.duplicates;
      }

      logger.info('Jintel batch fetched', {
        tickers: chunk,
        entities: entities.length,
        signals: rawSignals.length,
      });
    } catch (err) {
      logger.warn('Jintel batch fetch failed', {
        chunk: chunk.slice(0, 3),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Jintel signal fetch complete', { ingested: totalIngested, duplicates: totalDuplicates });
  return { ingested: totalIngested, duplicates: totalDuplicates, tickers: tickers.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n.toLocaleString();
}

function enrichmentToSignals(entity: ExtendedEntity, tickers: string[]): RawSignalInput[] {
  // Day-precision timestamp — stable hash prevents duplicate signals across re-runs
  const now = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const signals: RawSignalInput[] = [];

  // 1. Risk signals
  if (entity.risk?.signals?.length) {
    signals.push(...riskSignalsToRaw(entity.risk.signals, tickers));
  }

  // 2. Fundamentals
  const fund = entity.market?.fundamentals;
  if (fund) {
    const parts: string[] = [];
    if (fund.sector) parts.push(`Sector: ${fund.sector}`);
    if (fund.industry) parts.push(`Industry: ${fund.industry}`);
    if (fund.marketCap) parts.push(`MCap: $${formatLargeNumber(fund.marketCap)}`);
    if (fund.peRatio != null) parts.push(`P/E: ${fund.peRatio.toFixed(1)}`);
    if (fund.eps != null) parts.push(`EPS: $${fund.eps.toFixed(2)}`);
    if (fund.beta != null) parts.push(`Beta: ${fund.beta.toFixed(2)}`);

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
      });
    }
  }

  // 3. SEC filings
  for (const filing of (entity.regulatory?.filings ?? []).slice(0, 5)) {
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
    });
  }

  // 4. Significant price moves (>=2%)
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
    });
  }

  // 5. News articles
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
      metadata: { source: article.source, link: article.link },
    });
  }

  // 6. Technicals summary
  const tech = entity.technicals;
  if (tech) {
    const parts: string[] = [];
    if (tech.rsi != null) parts.push(`RSI: ${tech.rsi.toFixed(1)}`);
    if (tech.macd) parts.push(`MACD hist: ${tech.macd.histogram.toFixed(3)}`);
    if (tech.sma != null) parts.push(`SMA: ${tech.sma.toFixed(2)}`);
    if (tech.ema != null) parts.push(`EMA: ${tech.ema.toFixed(2)}`);

    if (parts.length > 0) {
      signals.push({
        sourceId: 'jintel-technicals',
        sourceName: 'Jintel Technicals',
        sourceType: 'ENRICHMENT',
        reliability: 0.9,
        title: `${entity.name ?? tickers[0]} technicals: ${parts.join(', ')}`,
        content: parts.join('\n'),
        publishedAt: now,
        type: 'TECHNICAL',
        tickers,
        confidence: 0.9,
      });
    }
  }

  return signals;
}
