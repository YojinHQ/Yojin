/**
 * Jintel Signal Fetcher — fetches enrichment data from Jintel and ingests as signals.
 *
 * Shared utility used by the full-curation workflow to pull Jintel data
 * (news, risk, fundamentals, technicals, filings) into the signal pipeline.
 */

import type {
  ArraySubGraphOptions,
  EconomicDataPoint,
  Entity,
  JintelClient,
  SP500DataPoint,
  Social,
} from '@yojinhq/jintel-client';
import { GDP, INFLATION, INTEREST_RATES, SP500_MULTIPLES, buildBatchEnrichQuery } from '@yojinhq/jintel-client';

import { formatNumber, riskSignalsToRaw } from './tools.js';
import type { FinancialStatements, KeyExecutive, RedditComment } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { RawSignalInput, SignalIngestor } from '../signals/ingestor.js';
import { JUNK_DOMAIN_RE, JUNK_TITLE_RE } from '../signals/quality-patterns.js';
import { SignalTypeSchema, SourceTypeSchema } from '../signals/types.js';

const SignalType = SignalTypeSchema.enum;
const SourceType = SourceTypeSchema.enum;

const logger = createSubsystemLogger('jintel-signal-fetcher');

// Request all fields that produce signals — regulatory enables SEC filing signals.
// social: Reddit posts + comments → SOCIALS signals (dedup by hash).
// discussions: HN stories → NEWS signals (tech/investor community commentary).
// financials/executives: equity-only; server returns null for crypto/ETF.
// predictions intentionally excluded — too niche for automated runs, agent-only.
const ENRICHMENT_FIELDS = [
  'market',
  'technicals',
  'news',
  'research',
  'sentiment',
  'regulatory',
  'social',
  'discussions',
] as const;

// Quality thresholds — filter low-engagement social posts to keep signal-to-noise high
const SOCIAL_MIN_REDDIT_SCORE = 5;
const SOCIAL_MIN_REDDIT_COMMENT_SCORE = 3;
const SOCIAL_MIN_HN_POINTS = 5;
const DEFAULT_CHUNK_SIZE = 10;

export interface JintelFetchResult {
  ingested: number;
  duplicates: number;
  tickers: number;
}

export interface JintelFetchOptions {
  /** Only fetch array sub-graph items (news, research) published after this ISO timestamp. */
  since?: string;
  /** Number of tickers to fetch per Jintel API call (default: 10). */
  chunkSize?: number;
}

/**
 * Fetch enrichment data from Jintel for the given tickers and ingest
 * all signal types (news, risk, fundamentals, technicals, filings, price moves).
 */
export async function fetchJintelSignals(
  client: JintelClient,
  ingestor: SignalIngestor,
  tickers: string[],
  options?: JintelFetchOptions,
): Promise<JintelFetchResult> {
  if (tickers.length === 0) return { ingested: 0, duplicates: 0, tickers: 0 };

  const subGraphOpts: ArraySubGraphOptions = { sort: 'DESC', ...(options?.since ? { since: options.since } : {}) };
  const query = buildBatchEnrichQuery([...ENRICHMENT_FIELDS], subGraphOpts);
  // Build filter variable to pass alongside the query — must match $filter: ArrayFilterInput declaration
  const filter: Record<string, unknown> = { sort: subGraphOpts.sort };
  if (subGraphOpts.since) filter.since = subGraphOpts.since;

  let totalIngested = 0;
  let totalDuplicates = 0;

  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  for (let i = 0; i < tickers.length; i += chunkSize) {
    const chunk = tickers.slice(i, i + chunkSize);
    try {
      const entities = await client.request<Entity[]>(query, { tickers: chunk, filter });

      // Build ticker → entity map
      const entityByTicker = new Map<string, Entity>();
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

/** Check if text mentions any of the entity's tickers or name (word-boundary safe). */
function mentionsEntity(text: string, tickers: string[], entityName: string | undefined): boolean {
  const haystack = text.toUpperCase();
  // Check tickers with word boundaries to avoid false positives (e.g. "A" matching "AI")
  for (const ticker of tickers) {
    const escaped = ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`).test(haystack)) return true;
  }
  // Check entity name (e.g. "NVIDIA", "Tesla", "Apple", "Microsoft")
  if (entityName) {
    const name = entityName.toUpperCase();
    // For short names, use word boundary; for longer names, simple includes is fine
    if (name.length <= 3) {
      if (new RegExp(`(?<![A-Z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Z0-9])`).test(haystack))
        return true;
    } else if (haystack.includes(name)) {
      return true;
    }
  }
  return false;
}

/** Titles that are just entity names with optional ticker suffix (e.g. "Invesco QQQ ETF | ICVT", "Apple Inc (AAPL)") */
function isEntityNameTitle(title: string, entityName: string | undefined): boolean {
  if (!entityName) return false;
  // Strip trailing " | TICKER" or " (TICKER)" and compare to entity name
  const cleaned = title
    .replace(/\s*\|\s*[A-Z0-9.]+$/, '')
    .replace(/\s*\([A-Z0-9.]+\)$/, '')
    .trim();
  return cleaned.toLowerCase() === entityName.toLowerCase();
}

export function enrichmentToSignals(entity: Entity, tickers: string[]): RawSignalInput[] {
  // Day-precision timestamp — stable hash prevents duplicate signals across re-runs
  const now = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const signals: RawSignalInput[] = [];

  // 1. Risk signals
  if (entity.risk?.signals?.length) {
    signals.push(...riskSignalsToRaw(entity.risk.signals, tickers));
  }

  // 2. Snapshot — current price, RSI, and key fundamentals in one signal
  const fund = entity.market?.fundamentals;
  const quote = entity.market?.quote;
  const tech = entity.technicals;
  if (quote) {
    const name = entity.name ?? tickers[0];
    const contentLines: string[] = [];
    const titleParts: string[] = [];

    // Current price + change
    titleParts.push(`$${quote.price.toFixed(2)}`);
    const changeDir = quote.changePercent >= 0 ? '+' : '';
    titleParts.push(`${changeDir}${quote.changePercent.toFixed(1)}%`);
    contentLines.push(`Price: $${quote.price.toFixed(2)} (${changeDir}${quote.changePercent.toFixed(1)}%)`);

    // RSI — the most useful technical indicator for retail investors
    if (tech?.rsi != null) {
      const rsiLabel = tech.rsi >= 70 ? 'Overbought' : tech.rsi <= 30 ? 'Oversold' : 'Neutral';
      titleParts.push(`RSI ${tech.rsi.toFixed(0)} (${rsiLabel})`);
      contentLines.push(`RSI: ${tech.rsi.toFixed(1)} — ${rsiLabel}`);
    }

    // 52-week range with position
    if (fund?.fiftyTwoWeekHigh != null && fund?.fiftyTwoWeekLow != null) {
      const range = fund.fiftyTwoWeekHigh - fund.fiftyTwoWeekLow;
      const position = range > 0 ? (((quote.price - fund.fiftyTwoWeekLow) / range) * 100).toFixed(0) : '–';
      contentLines.push(
        `52-Week Range: $${fund.fiftyTwoWeekLow.toFixed(2)} – $${fund.fiftyTwoWeekHigh.toFixed(2)} (${position}% from low)`,
      );
    }

    // Key fundamentals
    const marketCap = fund?.marketCap ?? quote.marketCap;
    if (marketCap) contentLines.push(`Market Cap: $${formatNumber(marketCap)}`);
    if (fund?.peRatio != null) contentLines.push(`P/E Ratio: ${fund.peRatio.toFixed(1)}`);
    if (fund?.eps != null) contentLines.push(`EPS: $${fund.eps.toFixed(2)}`);
    if (fund?.beta != null) contentLines.push(`Beta: ${fund.beta.toFixed(2)}`);
    if (fund?.dividendYield != null) contentLines.push(`Dividend Yield: ${fund.dividendYield.toFixed(2)}%`);
    if (fund?.sector) contentLines.push(`Sector: ${fund.sector}`);
    if (fund?.industry) contentLines.push(`Industry: ${fund.industry}`);
    if (fund?.description) contentLines.push(`Description: ${fund.description}`);

    signals.push({
      sourceId: 'jintel-snapshot',
      sourceName: 'Jintel',
      sourceType: SourceType.ENRICHMENT,
      reliability: 0.95,
      // Stable title for content-hash dedup — live values go in content only
      title: `${name} Market Snapshot`,
      content: `${titleParts.join(' | ')}\n${contentLines.join('\n')}`,
      publishedAt: now,
      type: SignalType.FUNDAMENTAL,
      tickers,
      confidence: 0.95,
    });
  }

  // 3. Key price events — 52-week highs/lows, volume spikes, gap moves (included in market field)
  //    Only ingest events from the last 7 days — Jintel returns full history which floods the feed.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  for (const event of entity.market?.keyEvents ?? []) {
    const eventDate = new Date(event.date);
    if (eventDate < sevenDaysAgo) continue;
    signals.push({
      sourceId: 'jintel-key-event',
      sourceName: 'Jintel Market Events',
      sourceType: SourceType.ENRICHMENT,
      reliability: 0.95,
      title: `${entity.name ?? tickers[0]}: ${event.type.replace(/_/g, ' ')} on ${event.date}`,
      content: `${event.description} | Close: $${event.close.toFixed(2)} (${event.changePercent >= 0 ? '+' : ''}${event.changePercent.toFixed(1)}%)${event.volume != null ? ` | Volume: ${event.volume.toLocaleString()}` : ''}`,
      publishedAt: eventDate.toISOString(),
      type: SignalType.TECHNICAL,
      tickers,
      confidence: 0.9,
      metadata: {
        eventType: event.type,
        priceChange: event.priceChange,
        changePercent: event.changePercent,
      },
    });
  }

  // 4. Short interest snapshot — included in market field, only emit when meaningful
  const shortInterestReports = entity.market?.shortInterest;
  if (shortInterestReports?.length) {
    // Use most recent report (server returns newest-first)
    const si = shortInterestReports[0];
    if (si.shortInterest != null || si.daysToCover != null) {
      const parts: string[] = [];
      if (si.shortInterest != null) parts.push(`Short interest: ${formatNumber(si.shortInterest)} shares`);
      if (si.daysToCover != null) parts.push(`Days to cover: ${si.daysToCover.toFixed(1)}`);
      if (si.change != null) {
        const dir = si.change >= 0 ? '+' : '';
        parts.push(`Change: ${dir}${formatNumber(si.change)}`);
      }
      signals.push({
        sourceId: 'jintel-short-interest',
        sourceName: 'Jintel Short Interest',
        sourceType: SourceType.ENRICHMENT,
        reliability: 0.9,
        title: `${entity.name ?? tickers[0]} Short Interest`,
        content: parts.join(' | '),
        publishedAt: si.reportDate.includes('T') ? si.reportDate : `${si.reportDate}T00:00:00Z`,
        type: SignalType.FUNDAMENTAL,
        tickers,
        confidence: 0.85,
        metadata: { reportDate: si.reportDate, source: si.source },
      });
    }
  }

  // 5. SEC filings (Jintel returns newest-first, limited by ArraySubGraphOptions)
  for (const filing of entity.regulatory?.filings ?? []) {
    signals.push({
      sourceId: 'jintel-sec',
      sourceName: 'Jintel SEC',
      sourceType: SourceType.ENRICHMENT,
      reliability: 0.95,
      title: `${entity.name ?? tickers[0]}: ${filing.type} filed ${filing.date}`,
      content: filing.description ?? undefined,
      link: filing.url,
      publishedAt: filing.date.includes('T') ? filing.date : `${filing.date}T00:00:00Z`,
      type: SignalType.FILINGS,
      tickers,
      confidence: 0.95,
    });
  }

  // 6. Significant price moves (>=8%) — only flag outliers worth investigating
  if (quote && Math.abs(quote.changePercent) >= 8) {
    const direction = quote.changePercent > 0 ? 'up' : 'down';
    signals.push({
      sourceId: 'jintel-market',
      sourceName: 'Jintel Market',
      sourceType: SourceType.ENRICHMENT,
      reliability: 0.95,
      title: `${entity.name ?? tickers[0]} Significant Price Move`,
      content: `${quote.ticker} ${direction} ${Math.abs(quote.changePercent).toFixed(1)}% to $${quote.price.toFixed(2)}`,
      publishedAt: now,
      type: SignalType.TECHNICAL,
      tickers,
      confidence: 0.95,
    });
  }

  // 7. News articles — only keep articles that actually mention the entity
  const entityName = entity.name;
  for (const article of entity.news ?? []) {
    if (!article.title) continue;
    if (JUNK_TITLE_RE.test(article.title)) continue;
    if (article.link && JUNK_DOMAIN_RE.test(article.link)) continue;
    if (isEntityNameTitle(article.title, entityName)) continue;
    const text = `${article.title} ${article.snippet ?? ''}`;
    if (!mentionsEntity(text, tickers, entityName)) continue;
    signals.push({
      sourceId: `jintel-news-${article.source.toLowerCase().replace(/\s+/g, '-')}`,
      sourceName: `Jintel News (${article.source})`,
      sourceType: SourceType.API,
      reliability: 0.8,
      title: article.title,
      content: article.snippet ?? undefined,
      link: article.link,
      publishedAt: article.date ?? now,
      type: SignalType.NEWS,
      tickers,
      confidence: 0.8,
      metadata: { source: article.source, link: article.link },
    });
  }

  // 8. Research articles — skip junk page titles and irrelevant articles
  for (const article of entity.research ?? []) {
    if (!article.title) continue;
    if (JUNK_TITLE_RE.test(article.title)) continue;
    if (article.url && JUNK_DOMAIN_RE.test(article.url)) continue;
    if (isEntityNameTitle(article.title, entityName)) continue;
    const researchText = `${article.title} ${article.text ?? ''}`;
    if (!mentionsEntity(researchText, tickers, entityName)) continue;
    signals.push({
      sourceId: 'jintel-research',
      sourceName: 'Jintel Research',
      sourceType: SourceType.API,
      reliability: 0.85,
      title: article.title,
      content: article.text ?? undefined,
      link: article.url,
      publishedAt: article.publishedDate ?? now,
      type: SignalType.NEWS,
      tickers,
      confidence: Math.min(0.95, article.score ?? 0.7),
      metadata: { author: article.author, score: article.score },
    });
  }

  // 9. Technicals summary — only emit when there's data beyond RSI (RSI is in the snapshot)
  if (tech) {
    const parts: string[] = [];
    if (tech.macd) parts.push(`MACD histogram: ${tech.macd.histogram.toFixed(3)}`);
    if (tech.sma != null && tech.ema != null) {
      const crossLabel = tech.ema > tech.sma ? 'EMA above SMA (bullish)' : 'EMA below SMA (bearish)';
      parts.push(`SMA: $${tech.sma.toFixed(2)}, EMA: $${tech.ema.toFixed(2)} — ${crossLabel}`);
    }
    if (tech.bollingerBands) {
      const bb = tech.bollingerBands;
      parts.push(`Bollinger Bands: $${bb.lower.toFixed(2)} – $${bb.upper.toFixed(2)}`);
    }

    if (parts.length >= 1) {
      signals.push({
        sourceId: 'jintel-technicals',
        sourceName: 'Jintel Technicals',
        sourceType: SourceType.ENRICHMENT,
        reliability: 0.9,
        // Stable title for content-hash dedup — live indicator values go in content only
        title: `${entity.name ?? tickers[0]} Technical Indicators`,
        content: parts.join('\n'),
        publishedAt: now,
        type: SignalType.TECHNICAL,
        tickers,
        confidence: 0.9,
      });
    }
  }

  // 10. Social sentiment — title must be stable per-day for content-hash dedup.
  // Live-changing values (rank, mention counts) go in content only.
  if (entity.sentiment) {
    const s = entity.sentiment;
    const rankDelta = s.rank24hAgo - s.rank;
    const rankDir = rankDelta > 0 ? `↑${rankDelta}` : rankDelta < 0 ? `↓${Math.abs(rankDelta)}` : '→';
    const mentionDelta = s.mentions - s.mentions24hAgo;
    const mentionDir = mentionDelta > 0 ? `+${mentionDelta}` : `${mentionDelta}`;
    signals.push({
      sourceId: 'jintel-sentiment',
      sourceName: 'Jintel Social Sentiment',
      sourceType: SourceType.ENRICHMENT,
      reliability: 0.7,
      title: `${entity.name ?? tickers[0]} Social Sentiment`,
      content: `Rank #${s.rank} (${rankDir}) | ${s.mentions} mentions (${mentionDir}), ${s.upvotes} upvotes (24h ago: rank #${s.rank24hAgo}, ${s.mentions24hAgo} mentions)`,
      publishedAt: now,
      type: SignalType.SENTIMENT,
      tickers,
      confidence: 0.7,
    });
  }

  // 11. Social media posts — Reddit posts and comments.
  // Quality-filtered: only high-engagement posts/comments to keep signal-to-noise high.
  // Title uses post/comment ID for stable content-hash dedup across runs.
  const social = entity.social;
  if (social) {
    for (const post of social.reddit ?? []) {
      if (post.score < SOCIAL_MIN_REDDIT_SCORE) continue;
      const text = `${post.title} ${post.text}`;
      if (!mentionsEntity(text, tickers, entityName)) continue;
      signals.push({
        sourceId: `jintel-social-reddit-${post.id}`,
        sourceName: `Jintel Social (r/${post.subreddit})`,
        sourceType: SourceType.API,
        reliability: 0.6,
        title: `${entity.name ?? tickers[0]}: r/${post.subreddit} — ${post.title}`,
        content: post.text.length > 500 ? post.text.slice(0, 497) + '…' : post.text,
        link: post.url,
        publishedAt: post.date ?? now,
        type: SignalType.SOCIALS,
        tickers,
        confidence: Math.min(0.85, 0.5 + post.score / 1000),
        metadata: { subreddit: post.subreddit, score: post.score, numComments: post.numComments },
      });
    }

    // 'redditComments' is a planned jintel-client field — cast until client ships it.
    const extSocial = social as Social & { redditComments?: RedditComment[] };
    for (const comment of extSocial.redditComments ?? []) {
      if (comment.score < SOCIAL_MIN_REDDIT_COMMENT_SCORE) continue;
      if (!mentionsEntity(comment.body, tickers, entityName)) continue;
      signals.push({
        sourceId: `jintel-social-reddit-comment-${comment.id}`,
        sourceName: `Jintel Social (r/${comment.subreddit} comment)`,
        sourceType: SourceType.API,
        reliability: 0.55,
        title: `${entity.name ?? tickers[0]}: r/${comment.subreddit} — ${comment.body.slice(0, 60).trim()}`,
        content: comment.body.length > 500 ? comment.body.slice(0, 497) + '…' : comment.body,
        publishedAt: comment.date ?? now,
        type: SignalType.SOCIALS,
        tickers,
        confidence: Math.min(0.75, 0.4 + comment.score / 500),
        metadata: { subreddit: comment.subreddit, score: comment.score, parentId: comment.parentId },
      });
    }
  }

  // 12. Hacker News discussions — tech/investor community commentary.
  // Only high-points stories to avoid noise, and only if the story title
  // actually references the ticker — Jintel may return loosely related HN stories
  // that have nothing to do with the asset.
  for (const story of entity.discussions ?? []) {
    if (story.points < SOCIAL_MIN_HN_POINTS) continue;
    if (!mentionsEntity(story.title, tickers, entityName)) continue;
    signals.push({
      sourceId: `jintel-discussions-hn-${story.objectId}`,
      sourceName: 'Jintel Discussions (HN)',
      sourceType: SourceType.API,
      reliability: 0.7,
      title: story.title,
      content: story.topComments?.length
        ? `${story.topComments[0].text.slice(0, 400)}${story.topComments[0].text.length > 400 ? '…' : ''}`
        : `${story.points} pts | ${story.numComments} comments`,
      link: story.url ?? story.hnUrl ?? undefined,
      publishedAt: story.date ?? now,
      type: SignalType.NEWS,
      tickers,
      confidence: Math.min(0.85, 0.5 + story.points / 200),
      metadata: { hnUrl: story.hnUrl, points: story.points, numComments: story.numComments },
    });
  }

  // 13. Financial statements — most recent period across all three families (equity only; null for crypto/ETF).
  // Stable title for content-hash dedup; period context goes in content + metadata.
  // Reads income, balance sheet, and cash flow independently so no family is silently dropped.
  // 'financials' is a planned jintel-client field — cast until client ships it natively.
  const extEntity = entity as Entity & { financials?: FinancialStatements; executives?: KeyExecutive[] };
  const inc = extEntity.financials?.income?.[0];
  const bs = extEntity.financials?.balanceSheet?.[0];
  const cf = extEntity.financials?.cashFlow?.[0];
  const periodSrc = inc ?? bs ?? cf;
  if (periodSrc) {
    const parts: string[] = [];
    const periodLabel = periodSrc.periodType
      ? `${periodSrc.periodType} ending ${periodSrc.periodEnding}`
      : periodSrc.periodEnding;
    parts.push(`Period: ${periodLabel}`);
    // Income statement fields
    if (inc?.totalRevenue != null) parts.push(`Revenue: $${formatNumber(inc.totalRevenue)}`);
    if (inc?.grossProfit != null) parts.push(`Gross Profit: $${formatNumber(inc.grossProfit)}`);
    if (inc?.netIncome != null) parts.push(`Net Income: $${formatNumber(inc.netIncome)}`);
    if (inc?.ebitda != null) parts.push(`EBITDA: $${formatNumber(inc.ebitda)}`);
    if (inc?.dilutedEps != null) parts.push(`Diluted EPS: $${inc.dilutedEps.toFixed(2)}`);
    // Balance sheet fields
    if (bs?.totalDebt != null) parts.push(`Total Debt: $${formatNumber(bs.totalDebt)}`);
    if (bs?.cashAndEquivalents != null) parts.push(`Cash & Equivalents: $${formatNumber(bs.cashAndEquivalents)}`);
    if (bs?.totalEquity != null) parts.push(`Total Equity: $${formatNumber(bs.totalEquity)}`);
    // Cash flow fields
    if (cf?.freeCashFlow != null) parts.push(`Free Cash Flow: $${formatNumber(cf.freeCashFlow)}`);
    if (cf?.operatingCashFlow != null) parts.push(`Operating Cash Flow: $${formatNumber(cf.operatingCashFlow)}`);
    if (parts.length > 1) {
      signals.push({
        sourceId: 'jintel-financials',
        sourceName: 'Jintel Financial Statements',
        sourceType: SourceType.ENRICHMENT,
        reliability: 0.95,
        title: `${entity.name ?? tickers[0]} Financial Statements`,
        content: parts.join('\n'),
        publishedAt: now,
        type: SignalType.FUNDAMENTAL,
        tickers,
        confidence: 0.95,
        metadata: { periodEnding: periodSrc.periodEnding, periodType: periodSrc.periodType ?? undefined },
      });
    }
  }

  // 14. Key executives (equity only; null for crypto/ETF).
  // Stable title for content-hash dedup. Executive roster changes infrequently.
  // 'executives' is a planned jintel-client field — using cast from section 13.
  const executives = extEntity.executives;
  if (executives?.length) {
    const lines = executives.map((exec) => {
      let line = `${exec.title}: ${exec.name}`;
      if (exec.pay != null) line += ` (pay: $${formatNumber(exec.pay)})`;
      return line;
    });
    signals.push({
      sourceId: 'jintel-executives',
      sourceName: 'Jintel Key Executives',
      sourceType: SourceType.ENRICHMENT,
      reliability: 0.85,
      title: `${entity.name ?? tickers[0]} Key Executives`,
      content: lines.join('\n'),
      publishedAt: now,
      type: SignalType.FUNDAMENTAL,
      tickers,
      confidence: 0.8,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Macro indicators
// ---------------------------------------------------------------------------

export interface MacroFetchResult {
  ingested: number;
  duplicates: number;
}

/**
 * Fetch macro economic indicators from Jintel (GDP, inflation, interest rates,
 * S&P 500 multiples) and ingest them as MACRO-typed signals.
 * These are broad-market signals with no specific ticker.
 */
export async function fetchMacroIndicators(client: JintelClient, ingestor: SignalIngestor): Promise<MacroFetchResult> {
  const signals: RawSignalInput[] = [];

  // Fire all macro queries in parallel
  const [gdpResult, inflationResult, ratesResult, peResult, shillerResult] = await Promise.allSettled([
    client.request<EconomicDataPoint[]>(GDP, { country: 'US', type: 'REAL' }),
    client.request<EconomicDataPoint[]>(INFLATION, { country: 'US' }),
    client.request<EconomicDataPoint[]>(INTEREST_RATES, { country: 'US' }),
    client.request<SP500DataPoint[]>(SP500_MULTIPLES, { series: 'PE_MONTH' }),
    client.request<SP500DataPoint[]>(SP500_MULTIPLES, { series: 'SHILLER_PE_MONTH' }),
  ]);

  // GDP
  if (gdpResult.status === 'fulfilled' && gdpResult.value.length > 0) {
    const latest = latestEconomic(gdpResult.value);
    if (latest?.value != null) {
      signals.push({
        sourceId: 'jintel-macro-gdp',
        sourceName: 'Jintel Macro',
        sourceType: SourceType.API,
        reliability: 0.95,
        title: `US Real GDP: ${latest.value.toFixed(1)}% (${latest.date})`,
        content: `US Real GDP growth rate: ${latest.value.toFixed(2)}% as of ${latest.date}`,
        publishedAt: toPublishedAt(latest.date),
        type: SignalType.MACRO,
        confidence: 0.95,
      });
    }
  } else if (gdpResult.status === 'rejected') {
    logger.warn('Macro GDP fetch failed', { error: String(gdpResult.reason) });
  }

  // Inflation
  if (inflationResult.status === 'fulfilled' && inflationResult.value.length > 0) {
    const latest = latestEconomic(inflationResult.value);
    if (latest?.value != null) {
      signals.push({
        sourceId: 'jintel-macro-inflation',
        sourceName: 'Jintel Macro',
        sourceType: SourceType.API,
        reliability: 0.95,
        title: `US Inflation (CPI): ${latest.value.toFixed(1)}% (${latest.date})`,
        content: `US Consumer Price Index: ${latest.value.toFixed(2)}% year-over-year as of ${latest.date}`,
        publishedAt: toPublishedAt(latest.date),
        type: SignalType.MACRO,
        confidence: 0.95,
      });
    }
  } else if (inflationResult.status === 'rejected') {
    logger.warn('Macro inflation fetch failed', { error: String(inflationResult.reason) });
  }

  // Interest rates
  if (ratesResult.status === 'fulfilled' && ratesResult.value.length > 0) {
    const latest = latestEconomic(ratesResult.value);
    if (latest?.value != null) {
      signals.push({
        sourceId: 'jintel-macro-rates',
        sourceName: 'Jintel Macro',
        sourceType: SourceType.API,
        reliability: 0.95,
        title: `US Interest Rate: ${latest.value.toFixed(2)}% (${latest.date})`,
        content: `US Federal Funds Rate: ${latest.value.toFixed(2)}% as of ${latest.date}`,
        publishedAt: toPublishedAt(latest.date),
        type: SignalType.MACRO,
        confidence: 0.95,
      });
    }
  } else if (ratesResult.status === 'rejected') {
    logger.warn('Macro interest rates fetch failed', { error: String(ratesResult.reason) });
  }

  // S&P 500 P/E
  if (peResult.status === 'fulfilled' && peResult.value.length > 0) {
    const latest = latestSP500(peResult.value);
    if (latest) {
      signals.push({
        sourceId: 'jintel-macro-sp500-pe',
        sourceName: 'Jintel Macro',
        sourceType: SourceType.API,
        reliability: 0.95,
        title: `S&P 500 P/E Ratio: ${latest.value.toFixed(1)} (${latest.date})`,
        content: `S&P 500 trailing P/E ratio: ${latest.value.toFixed(2)} as of ${latest.date}`,
        publishedAt: toPublishedAt(latest.date),
        type: SignalType.MACRO,
        confidence: 0.95,
      });
    }
  } else if (peResult.status === 'rejected') {
    logger.warn('Macro S&P 500 P/E fetch failed', { error: String(peResult.reason) });
  }

  // Shiller P/E (CAPE)
  if (shillerResult.status === 'fulfilled' && shillerResult.value.length > 0) {
    const latest = latestSP500(shillerResult.value);
    if (latest) {
      signals.push({
        sourceId: 'jintel-macro-sp500-cape',
        sourceName: 'Jintel Macro',
        sourceType: SourceType.API,
        reliability: 0.95,
        title: `S&P 500 Shiller P/E (CAPE): ${latest.value.toFixed(1)} (${latest.date})`,
        content: `S&P 500 cyclically-adjusted P/E ratio (Shiller CAPE): ${latest.value.toFixed(2)} as of ${latest.date}`,
        publishedAt: toPublishedAt(latest.date),
        type: SignalType.MACRO,
        confidence: 0.95,
      });
    }
  } else if (shillerResult.status === 'rejected') {
    logger.warn('Macro S&P 500 CAPE fetch failed', { error: String(shillerResult.reason) });
  }

  if (signals.length === 0) {
    logger.warn('No macro indicators fetched from Jintel');
    return { ingested: 0, duplicates: 0 };
  }

  const result = await ingestor.ingest(signals);
  logger.info('Macro indicators ingested', { ingested: result.ingested, duplicates: result.duplicates });
  return { ingested: result.ingested, duplicates: result.duplicates };
}

/** Return the most recent data point. Macro queries (GDP, INFLATION, etc.) are
 *  standalone constants without ArraySubGraphOptions, so we sort defensively. */
function latestEconomic(data: EconomicDataPoint[]): EconomicDataPoint | undefined {
  if (data.length <= 1) return data[0];
  return data.reduce((a, b) => (a.date >= b.date ? a : b));
}

/** Return the most recent data point (defensive sort — see latestEconomic). */
function latestSP500(data: SP500DataPoint[]): SP500DataPoint | undefined {
  if (data.length <= 1) return data[0];
  return data.reduce((a, b) => (a.date >= b.date ? a : b));
}

/** Convert a YYYY-MM-DD date string to a stable publishedAt timestamp for dedup. */
function toPublishedAt(dateStr: string): string {
  const ms = new Date(dateStr).getTime();
  return ms ? new Date(dateStr).toISOString() : `${dateStr}T00:00:00.000Z`;
}
