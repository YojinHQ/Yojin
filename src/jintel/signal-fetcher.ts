/**
 * Jintel Signal Fetcher — fetches enrichment data from Jintel and ingests as signals.
 *
 * Shared utility used by the full-curation workflow to pull Jintel data
 * (news, risk, fundamentals, technicals, filings) into the signal pipeline.
 */

import type {
  EconomicDataPoint,
  EnrichOptions,
  Entity,
  JintelClient,
  SP500DataPoint,
  Social,
} from '@yojinhq/jintel-client';
import { GDP, INFLATION, INTEREST_RATES, SP500_MULTIPLES, buildBatchEnrichQuery } from '@yojinhq/jintel-client';

import { isShortInterestFresh } from './freshness.js';
import { formatNumber, riskSignalsToRaw } from './tools.js';
import type { FinancialStatements, KeyExecutive, RedditComment } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { RawSignalInput, SignalIngestor } from '../signals/ingestor.js';
import { JUNK_DOMAIN_RE, JUNK_TITLE_RE } from '../signals/quality-patterns.js';
import { SignalSentimentSchema, SignalTypeSchema, SourceTypeSchema } from '../signals/types.js';
import type { SignalSentiment } from '../signals/types.js';

const SignalType = SignalTypeSchema.enum;
const SourceType = SourceTypeSchema.enum;
const SignalSentimentEnum = SignalSentimentSchema.enum;

/** Map a numeric sentiment score in [-1, +1] to the categorical enum used for display. */
function sentimentScoreToEnum(score: number): SignalSentiment {
  if (score >= 0.3) return SignalSentimentEnum.BULLISH;
  if (score <= -0.3) return SignalSentimentEnum.BEARISH;
  if (score > -0.05 && score < 0.05) return SignalSentimentEnum.NEUTRAL;
  return SignalSentimentEnum.MIXED;
}

const logger = createSubsystemLogger('jintel-signal-fetcher');

// Request all fields that produce signals — regulatory enables SEC filing signals.
// social: Reddit posts + comments → SOCIALS signals (dedup by hash).
// discussions: HN stories → NEWS signals (tech/investor community commentary).
// financials/executives: equity-only; server returns null for crypto/ETF.
// predictions intentionally excluded — too niche for automated runs, agent-only.
// research excluded — Exa-backed, returns low-quality web search results (score 0,
// no URLs, duplicate "Market Snapshot" titles). Available on-demand via get_research tool.
const ENRICHMENT_FIELDS = [
  'market',
  'technicals',
  'news',
  'sentiment',
  'regulatory',
  'social',
  'discussions',
  'institutionalHoldings',
  'ownership',
  'topHolders',
] as const;

// Reddit-owned domains — native media/shortlinks, not external articles
const REDDIT_DOMAIN_RE = /\b(reddit\.com|redd\.it|i\.redd\.it|v\.redd\.it|preview\.redd\.it)\b/;

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

  const arrayFilter = { sort: 'DESC' as const, ...(options?.since ? { since: options.since } : {}) };
  const enrichOpts: EnrichOptions = { filter: arrayFilter, topHolders: { limit: 20 } };
  const query = buildBatchEnrichQuery([...ENRICHMENT_FIELDS], enrichOpts);
  // Build filter variable to pass alongside the query — must match $filter: ArrayFilterInput declaration
  const filter: Record<string, unknown> = { sort: arrayFilter.sort };
  if (arrayFilter.since) filter.since = arrayFilter.since;

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

/** Corporate suffixes stripped before matching entity name words against text. */
const CORPORATE_SUFFIX_RE =
  /\b(?:inc\.?|corp\.?|corporation|ltd\.?|limited|llc|plc|co\.?|company|holdings|technologies|technology|aerospace|pharmaceuticals|therapeutics|biosciences|group|partners|capital|ventures|financial|services|solutions|systems|enterprises|international|global|the)\b/gi;

/** Generic words that appear in many entity names and would match too broadly. */
const GENERIC_NAME_WORDS = new Set([
  'new',
  'first',
  'american',
  'national',
  'united',
  'general',
  'digital',
  'energy',
  'power',
  'health',
  'bank',
  'fund',
  'trust',
  'real',
  'gold',
  'silver',
  'iron',
  'steel',
]);

/**
 * Deterministic ticker-content relevance check.
 *
 * Returns true when the text (title + snippet) does NOT meaningfully reference
 * the ticker or entity name — i.e. the signal is likely a false-match from
 * Jintel's entity mapping.
 *
 * Catches two failure modes:
 *  1. Short tickers matched as substrings inside product/brand names
 *     (e.g. "Gemini 2.5 Flash Lite" → LITE, "Flock Safety" → FLY)
 *  2. Content about an entirely different company/topic that Jintel
 *     associated via a shared buzzword.
 *
 * Uses word-boundary matching per CLAUDE.md TS rules: "Use word boundaries
 * when matching identifiers in text."
 */
function isTickerContentMismatch(text: string, tickers: string[], entityName: string | undefined): boolean {
  // If we have no entity name and only synthetic tickers, can't validate
  if (!entityName && tickers.length === 0) return false;

  // Check 1: Does the text mention any of the tickers as a standalone symbol?
  // Word boundaries: not preceded/followed by alphanumeric chars.
  for (const ticker of tickers) {
    // Skip crypto pairs like BTC-USD — always match the base
    const base = ticker.includes('-') ? ticker.split('-')[0] : ticker;
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Cashtag format ($LITE, $FLY) is high-confidence — always trust it
    const cashtagRe = new RegExp(`\\$${escaped}\\b`);
    if (cashtagRe.test(text)) return false;

    // Exchange-prefixed format (NASDAQ:LITE) is high-confidence
    const exchangeRe = new RegExp(`\\b(?:NASDAQ|NYSE|AMEX|LSE|TSE|ASX):${escaped}\\b`);
    if (exchangeRe.test(text)) return false;

    // Bare word-boundary match — check if the ticker appears in ALL-CAPS in
    // the original text. "PLTR expands..." is an intentional ticker reference;
    // "Flash Lite" is a product name where "Lite" coincidentally matches LITE.
    const allCapsRe = new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`);
    if (allCapsRe.test(text)) {
      // Long tickers (≥5 chars) — ALL-CAPS is high-confidence
      if (base.length >= 5) return false;

      // Short tickers (≤4 chars) — check product name context.
      // "Flash LITE", "Gemini PRO", "GPT PLUS" are product edition names that
      // collide with real tickers. Count product-context hits vs total ALL-CAPS
      // hits; only trust the match if it appears outside product context too.
      const pWords =
        'flash|gemini|gpt|claude|copilot|bard|llama|mistral|phi|codex|whisper|pixel|galaxy|kindle|echo|alexa|siri|iphone|ipad|macbook|surface|xbox|playstation|model|version|edition|tier';
      const pRe = new RegExp(`\\b(?:${pWords})\\s+${escaped}(?![A-Z0-9])`, 'gi');
      const pHits = [...text.matchAll(pRe)].length;
      const acHits = [...text.matchAll(new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`, 'g'))].length;
      if (acHits > pHits) return false;
    }

    // Case-insensitive match (e.g. "Lite" in "Flash Lite") — for short tickers
    // (≤4 chars), this is unreliable as it catches product names, abbreviations,
    // and common English words. Require entity name corroboration.
    const caseInsensitiveRe = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i');
    if (caseInsensitiveRe.test(text)) {
      if (base.length >= 5) return false; // Long ticker — even mixed-case is likely intentional
      // Short ticker in mixed case — fall through to entity name check for corroboration
    }
  }

  // Check 2: Does the text mention the entity name (company name)?
  // Entity names from Jintel often include corporate suffixes ("NVIDIA Corporation",
  // "Apple Inc", "Firefly Aerospace Inc") but articles typically use just the
  // distinctive part ("Nvidia", "Apple", "Firefly"). Check the full name first,
  // then fall back to individual distinctive words.
  if (entityName) {
    // Full name match — use word boundary to avoid substring matches
    // (e.g. "Open" inside "OpenAI", "Ally" inside "Allyson")
    const nameLower = entityName.toLowerCase();
    if (nameLower.length >= 4) {
      const escapedName = nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const nameRe = new RegExp(`\\b${escapedName}\\b`, 'i');
      if (nameRe.test(text)) {
        return false;
      }
    }

    // Strip corporate suffixes and check distinctive words individually.
    // "NVIDIA Corporation" → ["nvidia"] → check each ≥4-char word
    const nameWords = nameLower
      .replace(CORPORATE_SUFFIX_RE, '')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !GENERIC_NAME_WORDS.has(w));

    for (const word of nameWords) {
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordRe = new RegExp(`\\b${escapedWord}\\b`, 'i');
      if (wordRe.test(text)) return false;
    }
  }

  // Neither a high-confidence ticker reference (cashtag, exchange-prefix, ALL-CAPS)
  // nor entity name found in text — likely a mismatch
  return true;
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
      sourceName: 'Market Data',
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
      sourceName: 'Market Events',
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
        sourceName: 'Short Interest Data',
        sourceType: SourceType.ENRICHMENT,
        reliability: 0.9,
        title: `${entity.name ?? tickers[0]} Short Interest`,
        content: parts.join(' | '),
        publishedAt: now,
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
      sourceName: 'SEC Filings',
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
      sourceName: 'Market Data',
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

  // 7. News articles — Jintel returns articles scoped to the queried entity.
  // Junk/spam filters are deterministic; relevance is left to the quality agent.
  const entityName = entity.name;
  for (const article of entity.news ?? []) {
    if (!article.title) continue;
    if (JUNK_TITLE_RE.test(article.title)) continue;
    if (article.link && JUNK_DOMAIN_RE.test(article.link)) continue;
    if (isEntityNameTitle(article.title, entityName)) continue;
    if (isTickerContentMismatch(`${article.title} ${article.snippet ?? ''}`, tickers, entityName)) continue;
    const { sentimentScore } = article;
    signals.push({
      sourceId: `jintel-news-${article.source.toLowerCase().replace(/\s+/g, '-')}`,
      sourceName: article.source,
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
      ...(sentimentScore != null ? { sentimentScore, sentiment: sentimentScoreToEnum(sentimentScore) } : {}),
    });
  }

  // 8. Research articles — skip junk page titles; relevance handled by quality agent.
  for (const article of entity.research ?? []) {
    if (!article.title) continue;
    if (JUNK_TITLE_RE.test(article.title)) continue;
    if (article.url && JUNK_DOMAIN_RE.test(article.url)) continue;
    if (isEntityNameTitle(article.title, entityName)) continue;
    if (isTickerContentMismatch(`${article.title} ${article.text ?? ''}`, tickers, entityName)) continue;
    signals.push({
      sourceId: 'jintel-research',
      sourceName: 'Research',
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
      parts.push(`SMA(50): $${tech.sma.toFixed(2)}, EMA(10): $${tech.ema.toFixed(2)} — ${crossLabel}`);
    }
    if (tech.sma200 != null) parts.push(`SMA(200): $${tech.sma200.toFixed(2)}`);
    if (tech.crossovers) {
      if (tech.crossovers.goldenCross) parts.push('Golden Cross active (SMA 50 > 200)');
      if (tech.crossovers.deathCross) parts.push('Death Cross active (SMA 50 < 200)');
    }
    if (tech.bollingerBands) {
      const bb = tech.bollingerBands;
      parts.push(`Bollinger Bands: $${bb.lower.toFixed(2)} – $${bb.upper.toFixed(2)}`);
    }
    if (tech.bollingerBandsWidth != null && tech.bollingerBandsWidth < 0.05) {
      parts.push('BB Squeeze detected — breakout imminent');
    }
    if (tech.adx != null && tech.adx > 25) parts.push(`ADX: ${tech.adx.toFixed(1)} (strong trend)`);
    if (tech.vwap != null) parts.push(`VWAP: $${tech.vwap.toFixed(2)}`);
    if (tech.parabolicSar != null) parts.push(`Parabolic SAR: $${tech.parabolicSar.toFixed(2)}`);

    if (parts.length >= 1) {
      signals.push({
        sourceId: 'jintel-technicals',
        sourceName: 'Technical Analysis',
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
      sourceName: 'Social Sentiment',
      sourceType: SourceType.ENRICHMENT,
      reliability: 0.7,
      title: `${entity.name ?? tickers[0]} Social Sentiment`,
      content: `Rank #${s.rank} (${rankDir}) | ${s.mentions} mentions (${mentionDir}), ${s.upvotes} upvotes (24h ago: rank #${s.rank24hAgo}, ${s.mentions24hAgo} mentions)`,
      publishedAt: now,
      type: SignalType.SENTIMENT,
      tickers,
      confidence: 0.7,
      metadata: {
        rank: s.rank,
        rank24hAgo: s.rank24hAgo,
        mentions: s.mentions,
        mentions24hAgo: s.mentions24hAgo,
        upvotes: s.upvotes,
        mentionDelta,
        mentionMomentum: s.mentions24hAgo > 0 ? (s.mentions - s.mentions24hAgo) / s.mentions24hAgo : null,
      },
    });
  }

  // 11. Social media posts — Reddit posts and comments.
  // Quality-filtered: only high-engagement posts/comments to keep signal-to-noise high.
  // Title uses post/comment ID for stable content-hash dedup across runs.
  const social = entity.social;
  if (social) {
    for (const post of social.reddit ?? []) {
      if (post.score < SOCIAL_MIN_REDDIT_SCORE) continue;
      const postText = `${post.title} ${post.text}`;
      if (isTickerContentMismatch(postText, tickers, entityName)) continue;
      // Link posts point to an external article; self-posts point to reddit.com.
      // Attribute link posts to the original source so the user knows where the
      // information actually comes from, with "(via r/...)" for provenance.
      // Reddit-owned domains (i.redd.it, v.redd.it, redd.it) are native media, not external articles.
      const isLinkPost = post.url && !REDDIT_DOMAIN_RE.test(post.url);
      const sourceName = isLinkPost
        ? `${extractDomain(post.url)} (via r/${post.subreddit})`
        : `Reddit (r/${post.subreddit})`;
      signals.push({
        sourceId: `jintel-social-reddit-${post.id}`,
        sourceName,
        sourceType: SourceType.API,
        reliability: isLinkPost ? 0.65 : 0.6,
        title: `${entity.name ?? tickers[0]}: r/${post.subreddit} — ${post.title}`,
        content: post.text.length > 500 ? post.text.slice(0, 497) + '…' : post.text,
        link: post.url,
        publishedAt: post.date ?? now,
        type: isLinkPost ? SignalType.NEWS : SignalType.SOCIALS,
        tickers,
        confidence: Math.min(0.85, 0.5 + post.score / 1000),
        metadata: {
          subreddit: post.subreddit,
          score: post.score,
          numComments: post.numComments,
          ...(isLinkPost && { redditPostId: post.id }),
        },
      });
    }

    // 'redditComments' is a planned jintel-client field — cast until client ships it.
    const extSocial = social as Social & { redditComments?: RedditComment[] };
    for (const comment of extSocial.redditComments ?? []) {
      if (comment.score < SOCIAL_MIN_REDDIT_COMMENT_SCORE) continue;
      if (isTickerContentMismatch(comment.body, tickers, entityName)) continue;
      signals.push({
        sourceId: `jintel-social-reddit-comment-${comment.id}`,
        sourceName: `Reddit (r/${comment.subreddit} comment)`,
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
  // Only high-points stories to avoid noise; ticker-content mismatch filter catches
  // short tickers matched as substrings in product names (e.g. "Flash Lite" → LITE).
  for (const story of entity.discussions ?? []) {
    if (story.points < SOCIAL_MIN_HN_POINTS) continue;
    const storyText = `${story.title} ${story.topComments?.[0]?.text ?? ''}`;
    if (isTickerContentMismatch(storyText, tickers, entityName)) continue;
    signals.push({
      sourceId: `jintel-discussions-hn-${story.objectId}`,
      sourceName: 'Hacker News',
      sourceType: SourceType.API,
      reliability: 0.7,
      title: story.title,
      content: story.topComments?.length
        ? `${story.topComments[0].text.slice(0, 400)}${story.topComments[0].text.length > 400 ? '…' : ''}`
        : `${story.points} pts | ${story.numComments} comments`,
      link: story.hnUrl ?? story.url ?? undefined,
      publishedAt: story.date ?? now,
      type: SignalType.NEWS,
      tickers,
      confidence: Math.min(0.7, 0.4 + story.points / 300),
      metadata: { hnUrl: story.hnUrl, articleUrl: story.url, points: story.points, numComments: story.numComments },
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
        sourceName: 'Financial Statements',
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
      sourceName: 'Company Data',
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

  // 15. Institutional holdings (13F) — equity only; null for crypto/ETF.
  // Stable title for content-hash dedup. 13F filings update quarterly.
  // Value is reported in thousands of USD — multiply for display.
  const holdings = entity.institutionalHoldings;
  if (holdings?.length) {
    const topHoldings = holdings.slice(0, 10);
    const lines = topHoldings.map((h) => {
      return `${h.issuerName} (${h.titleOfClass}): ${formatNumber(h.shares)} shares, $${formatNumber(h.value * 1000)} | Filed: ${h.filingDate}`;
    });
    if (holdings.length > 10) {
      lines.push(`... and ${holdings.length - 10} more holdings`);
    }
    const reportDate = holdings[0].reportDate;
    signals.push({
      sourceId: 'jintel-institutional-holdings',
      sourceName: '13F Filings',
      sourceType: SourceType.ENRICHMENT,
      reliability: 0.95,
      title: `${entity.name ?? tickers[0]} Institutional Holdings (13F)`,
      content: lines.join('\n'),
      publishedAt: now,
      type: SignalType.FUNDAMENTAL,
      tickers,
      confidence: 0.95,
      metadata: { reportDate, filingDate: holdings[0].filingDate, holdingCount: holdings.length },
    });
  }

  // 16. Ownership breakdown — insider/institutional ownership percentages, float, short interest.
  // Stable title for content-hash dedup. Ownership data changes slowly (quarterly filings).
  const ownership = entity.ownership;
  if (ownership) {
    const parts: string[] = [];
    if (ownership.insiderOwnership != null) parts.push(`Insider: ${(ownership.insiderOwnership * 100).toFixed(2)}%`);
    if (ownership.institutionOwnership != null)
      parts.push(`Institutional: ${(ownership.institutionOwnership * 100).toFixed(2)}%`);
    if (ownership.institutionsCount != null) parts.push(`Institutions: ${ownership.institutionsCount}`);
    if (ownership.outstandingShares != null) parts.push(`Outstanding: ${formatNumber(ownership.outstandingShares)}`);
    if (ownership.floatShares != null) parts.push(`Float: ${formatNumber(ownership.floatShares)}`);
    if (ownership.shortPercentOfFloat != null && isShortInterestFresh(ownership.shortInterestDate)) {
      parts.push(
        `Short % of float: ${(ownership.shortPercentOfFloat * 100).toFixed(2)}% (as of ${ownership.shortInterestDate})`,
      );
    }
    if (parts.length > 0) {
      signals.push({
        sourceId: 'jintel-ownership',
        sourceName: 'Ownership Data',
        sourceType: SourceType.ENRICHMENT,
        reliability: 0.9,
        title: `${entity.name ?? tickers[0]} Ownership Breakdown`,
        content: parts.join('\n'),
        publishedAt: now,
        type: SignalType.FUNDAMENTAL,
        tickers,
        confidence: 0.9,
      });
    }
  }

  // 17. Top institutional holders — largest 13F filers holding this ticker.
  // Stable title for content-hash dedup. Top holders change quarterly.
  const topHolders = entity.topHolders;
  if (topHolders?.length) {
    const lines = topHolders
      .slice(0, 10)
      .map((h) => `${h.filerName}: ${formatNumber(h.shares)} shares, $${formatNumber(h.value * 1000)}`);
    if (topHolders.length > 10) {
      lines.push(`... and ${topHolders.length - 10} more holders`);
    }
    signals.push({
      sourceId: 'jintel-top-holders',
      sourceName: 'Institutional Holdings',
      sourceType: SourceType.ENRICHMENT,
      reliability: 0.9,
      title: `${entity.name ?? tickers[0]} Top Institutional Holders`,
      content: lines.join('\n'),
      publishedAt: now,
      type: SignalType.FUNDAMENTAL,
      tickers,
      confidence: 0.9,
      metadata: { holderCount: topHolders.length, reportDate: topHolders[0].reportDate },
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
        sourceName: 'Macro Data',
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
        sourceName: 'Macro Data',
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
        sourceName: 'Macro Data',
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
        sourceName: 'Macro Data',
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
        sourceName: 'Macro Data',
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

/** Extract the domain from a URL, stripping www. prefix. Falls back to the raw URL on parse failure. */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
